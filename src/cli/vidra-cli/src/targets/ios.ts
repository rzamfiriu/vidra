import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { spawnSync } from "node:child_process";
import { artifactFileName, type AppMeta, type BuildTarget } from "./types.js";
import {
  assertBuildNumberIsNew,
  recordBuildNumber,
  type BuildNumberGuard,
} from "./build-number.js";
import { escapeMsBuildProperty } from "./android.js";

export interface IosSigningConfig {
  /** A signing identity, e.g. `Apple Distribution: Example Ltd (TEAMID)`. */
  codesignKey: string;
  /** The App Store provisioning profile's name or UUID, installed on this Mac. */
  provisioningProfile: string;
}

export const resolveIosSigningConfig = (
  env: NodeJS.ProcessEnv = process.env,
): IosSigningConfig | null => {
  const codesignKey = env.VIDRA_IOS_CODESIGN_KEY?.trim();
  const provisioningProfile = env.VIDRA_IOS_PROVISIONING_PROFILE?.trim();
  if (!codesignKey && !provisioningProfile) return null;
  if (!codesignKey || !provisioningProfile) {
    throw new Error(
      "iOS signing is incomplete — set both VIDRA_IOS_CODESIGN_KEY and VIDRA_IOS_PROVISIONING_PROFILE",
    );
  }
  return { codesignKey, provisioningProfile };
};

export const iosPublishArgs = (signing: IosSigningConfig): string[] => [
  "-r",
  "ios-arm64",
  `-p:CodesignKey=${escapeMsBuildProperty(signing.codesignKey)}`,
  `-p:CodesignProvision=${escapeMsBuildProperty(signing.provisioningProfile)}`,
];

export const iosSimulatorRuntimeIdentifier = (arch: string = process.arch): string =>
  arch === "arm64" ? "iossimulator-arm64" : "iossimulator-x64";

const BUILD_NUMBER: BuildNumberGuard = {
  label: "iOS build number",
  sidecar: "build-number",
};

/** The signed App Store IPA. Signing arguments come from `iosPublishArgs`. */
export const iosTarget: BuildTarget = {
  name: "ios",
  framework: "net10.0-ios",
  artifactExtensions: [".ipa"],
  packageLabel: "package IPA",
  supportsNativeUpdates: false,
  discardIntermediates: "ios-arm64",

  findBundle(publishDir: string): string | null {
    return findEntries(path.join(publishDir, "ios-arm64"), (name, isDirectory) =>
      !isDirectory && name.endsWith(".ipa"))[0] ?? null;
  },

  async package(ipa: string, outputDir: string, meta: AppMeta): Promise<string[]> {
    fs.ensureDirSync(outputDir);
    const out = path.join(outputDir, artifactFileName(iosTarget, meta));
    assertBuildNumberIsNew(BUILD_NUMBER, path.join(meta.projectRoot, "dist"), out, meta.buildNumber);
    fs.copySync(ipa, out, { overwrite: true });
    recordBuildNumber(BUILD_NUMBER, out, meta.buildNumber);
    return [out];
  },
};

/**
 * An unsigned Simulator build, for CI and for trying a Release build without an
 * Apple account. `dotnet build` because the iOS SDK refuses to publish for a
 * simulator runtime. Local networking is on so the app can reach a dev server
 * or a feed on the host's loopback, as a Debug build can.
 */
export const iosSimulatorTarget: BuildTarget = {
  name: "ios",
  framework: "net10.0-ios",
  artifactExtensions: [".app"],
  artifactSuffix: "ios-simulator",
  packageLabel: "package .app",
  supportsNativeUpdates: false,
  dotnetVerb: "build",
  extraPublishArgs: [
    "-r",
    iosSimulatorRuntimeIdentifier(),
    "-p:VidraAllowLocalNetworking=true",
  ],
  discardIntermediates: iosSimulatorRuntimeIdentifier(),

  findBundle(publishDir: string): string | null {
    return findEntries(
      path.join(publishDir, iosSimulatorRuntimeIdentifier()),
      (name, isDirectory) => isDirectory && name.endsWith(".app"),
    )[0] ?? null;
  },

  async package(app: string, outputDir: string, meta: AppMeta): Promise<string[]> {
    fs.ensureDirSync(outputDir);
    const out = path.join(outputDir, artifactFileName(iosSimulatorTarget, meta));
    fs.removeSync(out);
    fs.copySync(app, out);
    return [out];
  },
};

/** Top-level matches only: an `.app` holds frameworks that must not count. */
const findEntries = (
  root: string,
  matches: (name: string, isDirectory: boolean) => boolean,
): string[] => {
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (matches(entry.name, entry.isDirectory())) found.push(fullPath);
      else if (entry.isDirectory()) visit(fullPath);
    }
  };
  visit(root);
  return found;
};

export type ProvisioningProfileKind = "app-store" | "ad-hoc" | "development" | "enterprise";

export interface ProvisioningProfile {
  name: string;
  kind: ProvisioningProfileKind;
  expires: Date;
}

/** The fields of a decoded profile that decide what it can ship. */
export interface ProvisioningProfileFields {
  Name?: string;
  ExpirationDate?: string;
  /** How many devices the profile names, not the devices themselves. */
  ProvisionedDevices?: number;
  ProvisionsAllDevices?: boolean;
  getTaskAllow?: boolean;
  /** `TEAMID.com.example.app`, or a wildcard such as `TEAMID.*`. */
  applicationIdentifier?: string;
}

export const describeProvisioningProfile = (
  fields: ProvisioningProfileFields,
): ProvisioningProfile => ({
  name: fields.Name ?? "unnamed profile",
  kind: fields.ProvisionsAllDevices
    ? "enterprise"
    : fields.getTaskAllow
      ? "development"
      : (fields.ProvisionedDevices ?? 0) > 0
        ? "ad-hoc"
        : "app-store",
  expires: new Date(fields.ExpirationDate ?? 0),
});

/** Why App Store Connect would refuse an IPA carrying this profile. */
export const provisioningProfileProblems = (
  profile: ProvisioningProfile,
  now: Date = new Date(),
): string[] => [
  ...(profile.kind === "app-store"
    ? []
    : [`"${profile.name}" is a ${profile.kind} profile, not an App Store one`]),
  ...(profile.expires.getTime() > now.getTime()
    ? []
    : [`"${profile.name}" expired ${profile.expires.toISOString().slice(0, 10)}`]),
];

/** Reads a decoded (`security cms -D`) provisioning profile plist. */
export const readProvisioningProfile = (plistPath: string): ProvisioningProfileFields => {
  const extract = (keyPath: string): string | undefined => {
    const result = spawnSync("plutil", ["-extract", keyPath, "raw", "-o", "-", plistPath], {
      encoding: "utf8",
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
  };
  const devices = extract("ProvisionedDevices");
  return {
    Name: extract("Name"),
    ExpirationDate: extract("ExpirationDate"),
    ProvisionedDevices: devices === undefined ? undefined : Number(devices),
    ProvisionsAllDevices: extract("ProvisionsAllDevices") === "true",
    getTaskAllow: extract("Entitlements.get-task-allow") === "true",
    applicationIdentifier: extract("Entitlements.application-identifier"),
  };
};

/** Whether a profile's application identifier (team prefix and all) covers this bundle ID. */
export const profileCoversBundleId = (applicationIdentifier: string, bundleId: string): boolean => {
  const appId = applicationIdentifier.slice(applicationIdentifier.indexOf(".") + 1);
  return appId.endsWith("*")
    ? bundleId.startsWith(appId.slice(0, -1))
    : appId === bundleId;
};

/** Where Xcode 16+ and earlier keep downloaded provisioning profiles. */
const PROFILE_DIRECTORIES = [
  path.join(os.homedir(), "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"),
  path.join(os.homedir(), "Library", "MobileDevice", "Provisioning Profiles"),
];

/**
 * An installed, unexpired development profile that can sign `bundleId` for a
 * device, which is what a Debug build for `ios-arm64` picks automatically.
 */
export const findDevelopmentProfile = (bundleId: string): ProvisioningProfile | null => {
  const files = PROFILE_DIRECTORIES.flatMap((directory) =>
    fs.existsSync(directory)
      ? fs.readdirSync(directory)
          .filter((name) => name.endsWith(".mobileprovision"))
          .map((name) => path.join(directory, name))
      : []);
  if (files.length === 0) return null;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vidra-profiles-"));
  try {
    for (const file of files) {
      const decoded = path.join(scratch, `${path.basename(file)}.plist`);
      const cms = spawnSync("security", ["cms", "-D", "-i", file, "-o", decoded], { stdio: "ignore" });
      if (cms.status !== 0) continue;
      const fields = readProvisioningProfile(decoded);
      const profile = describeProvisioningProfile(fields);
      if (
        profile.kind === "development"
        && profile.expires.getTime() > Date.now()
        && fields.applicationIdentifier
        && profileCoversBundleId(fields.applicationIdentifier, bundleId)
      ) {
        return profile;
      }
    }
    return null;
  } finally {
    fs.removeSync(scratch);
  }
};

export interface IosVerification {
  ok: boolean;
  /** One line per finding, in the order they were checked. */
  findings: { ok: boolean; label: string; detail: string }[];
  output: string;
}

/**
 * Checks what App Store Connect checks first: the app inside the IPA is
 * signed, and the profile it carries is an unexpired App Store profile.
 */
export const verifyIosPackage = (ipa: string): IosVerification => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vidra-ipa-"));
  try {
    const unzip = spawnSync("ditto", ["-x", "-k", ipa, scratch], { encoding: "utf8" });
    const payload = path.join(scratch, "Payload");
    const app = fs.existsSync(payload)
      ? fs.readdirSync(payload).find((name) => name.endsWith(".app"))
      : undefined;
    if (unzip.status !== 0 || !app) {
      return {
        ok: false,
        findings: [{ ok: false, label: "verify sig", detail: "no Payload/*.app inside the IPA" }],
        output: unzip.stderr ?? "",
      };
    }
    const appPath = path.join(payload, app);

    const codesign = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
      encoding: "utf8",
    });
    const findings: IosVerification["findings"] = [
      {
        ok: codesign.status === 0,
        label: "verify sig",
        detail: codesign.status === 0
          ? `codesign accepted ${app}`
          : `codesign rejected ${app}`,
      },
    ];

    const embedded = path.join(appPath, "embedded.mobileprovision");
    const decoded = path.join(scratch, "profile.plist");
    const cms = fs.existsSync(embedded)
      ? spawnSync("security", ["cms", "-D", "-i", embedded, "-o", decoded], { encoding: "utf8" })
      : null;
    if (!cms || cms.status !== 0) {
      findings.push({
        ok: false,
        label: "profile",
        detail: cms ? "embedded.mobileprovision could not be decoded" : "no embedded.mobileprovision",
      });
    } else {
      const profile = describeProvisioningProfile(readProvisioningProfile(decoded));
      const problems = provisioningProfileProblems(profile);
      findings.push({
        ok: problems.length === 0,
        label: "profile",
        detail: problems.length === 0
          ? `"${profile.name}" · App Store · expires ${profile.expires.toISOString().slice(0, 10)}`
          : problems.join("; "),
      });
    }

    return {
      ok: findings.every((finding) => finding.ok),
      findings,
      output: [codesign.stderr, cms?.stderr].filter(Boolean).join("\n"),
    };
  } finally {
    fs.removeSync(scratch);
  }
};

export interface AppStoreConnectKey {
  keyId: string;
  issuerId: string;
  keyPath: string;
}

export const resolveAppStoreConnectKey = (
  env: NodeJS.ProcessEnv = process.env,
): AppStoreConnectKey | null => {
  const keyId = env.VIDRA_ASC_KEY_ID?.trim();
  const issuerId = env.VIDRA_ASC_ISSUER_ID?.trim();
  const keyPath = env.VIDRA_ASC_KEY_PATH?.trim();
  if (!keyId && !issuerId && !keyPath) return null;
  if (!keyId || !issuerId || !keyPath) {
    throw new Error(
      "App Store Connect key is incomplete — set VIDRA_ASC_KEY_ID, VIDRA_ASC_ISSUER_ID, and VIDRA_ASC_KEY_PATH",
    );
  }
  if (!fs.existsSync(keyPath)) {
    throw new Error(`App Store Connect key not found: ${keyPath}`);
  }
  return { keyId, issuerId, keyPath: path.resolve(keyPath) };
};

/**
 * Uploads to App Store Connect, from where TestFlight and review take over.
 *
 * altool only finds a key named `AuthKey_<id>.p8` in a handful of directories,
 * so the key is copied into a private temporary one for the length of the call
 * rather than asking the developer to name and place it to suit altool.
 */
export const uploadToAppStoreConnect = (
  ipa: string,
  key: AppStoreConnectKey,
  verbose: boolean,
): { ok: boolean; output: string } => {
  const keysDir = fs.mkdtempSync(path.join(os.tmpdir(), "vidra-asc-"));
  try {
    const keyFile = path.join(keysDir, `AuthKey_${key.keyId}.p8`);
    fs.copyFileSync(key.keyPath, keyFile);
    fs.chmodSync(keyFile, 0o600);
    const result = spawnSync(
      "xcrun",
      ["altool", "--upload-package", ipa, "--api-key", key.keyId, "--api-issuer", key.issuerId],
      {
        encoding: "utf8",
        env: { ...process.env, API_PRIVATE_KEYS_DIR: keysDir },
        stdio: verbose ? "inherit" : "pipe",
      },
    );
    return {
      ok: result.status === 0,
      output: [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n"),
    };
  } finally {
    fs.removeSync(keysDir);
  }
};
