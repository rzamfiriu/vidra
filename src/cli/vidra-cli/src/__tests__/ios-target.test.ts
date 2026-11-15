import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeProvisioningProfile,
  iosPublishArgs,
  iosSimulatorRuntimeIdentifier,
  iosSimulatorTarget,
  iosTarget,
  profileCoversBundleId,
  provisioningProfileProblems,
  readProvisioningProfile,
  resolveAppStoreConnectKey,
  resolveIosSigningConfig,
} from "../targets/ios.js";

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    fs.removeSync(directory);
  }
});

const tempDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vidra-ios-"));
  scratch.push(directory);
  return directory;
};

describe("iOS signing", () => {
  it("needs both the identity and the profile once either is present", () => {
    expect(resolveIosSigningConfig({})).toBeNull();
    expect(() =>
      resolveIosSigningConfig({ VIDRA_IOS_CODESIGN_KEY: "Apple Distribution: Acme (TEAM)" }),
    ).toThrow(/incomplete/i);
  });

  it("publishes for devices and escapes the identity for MSBuild", () => {
    const args = iosPublishArgs({
      codesignKey: "Apple Distribution: Acme Ltd (TEAM123)",
      provisioningProfile: "Acme App Store",
    });
    expect(args.slice(0, 2)).toEqual(["-r", "ios-arm64"]);
    expect(args).toContain("-p:CodesignKey=Apple Distribution: Acme Ltd %28TEAM123%29");
    expect(args).toContain("-p:CodesignProvision=Acme App Store");
  });
});

describe("App Store Connect key", () => {
  it("is off when nothing is set and incomplete when only some is", () => {
    expect(resolveAppStoreConnectKey({})).toBeNull();
    expect(() => resolveAppStoreConnectKey({ VIDRA_ASC_KEY_ID: "ABC" })).toThrow(/incomplete/);
  });

  it("refuses a key file that is not there", () => {
    expect(() =>
      resolveAppStoreConnectKey({
        VIDRA_ASC_KEY_ID: "ABC",
        VIDRA_ASC_ISSUER_ID: "issuer",
        VIDRA_ASC_KEY_PATH: "/nonexistent/AuthKey.p8",
      }),
    ).toThrow(/not found/);
  });
});

describe("provisioning profiles", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const appStore = {
    Name: "Acme App Store",
    ExpirationDate: "2027-01-01T00:00:00Z",
    getTaskAllow: false,
  };

  it("accepts an unexpired App Store profile", () => {
    const profile = describeProvisioningProfile(appStore);
    expect(profile.kind).toBe("app-store");
    expect(provisioningProfileProblems(profile, now)).toEqual([]);
  });

  it.each([
    [{ ProvisionedDevices: 3 }, "ad-hoc"],
    [{ ProvisionedDevices: 3, getTaskAllow: true }, "development"],
    [{ ProvisionsAllDevices: true }, "enterprise"],
  ] as const)("names a %o profile %s, and rejects it", (fields, kind) => {
    const profile = describeProvisioningProfile({ ...appStore, ...fields });
    expect(profile.kind).toBe(kind);
    expect(provisioningProfileProblems(profile, now)).toEqual([
      `"Acme App Store" is a ${kind} profile, not an App Store one`,
    ]);
  });

  it("rejects an expired one", () => {
    const profile = describeProvisioningProfile({
      ...appStore,
      ExpirationDate: "2026-05-01T00:00:00Z",
    });
    expect(provisioningProfileProblems(profile, now)).toEqual([
      '"Acme App Store" expired 2026-05-01',
    ]);
  });

  it.runIf(process.platform === "darwin")("reads the fields from a decoded profile", () => {
    const plist = path.join(tempDirectory(), "profile.plist");
    fs.writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Name</key><string>Acme Ad Hoc</string>
  <key>ExpirationDate</key><date>2027-01-01T00:00:00Z</date>
  <key>ProvisionedDevices</key><array><string>00008110-A</string><string>00008110-B</string></array>
  <key>Entitlements</key><dict><key>get-task-allow</key><false/></dict>
</dict></plist>`,
    );
    expect(readProvisioningProfile(plist)).toEqual({
      Name: "Acme Ad Hoc",
      ExpirationDate: "2027-01-01T00:00:00Z",
      ProvisionedDevices: 2,
      ProvisionsAllDevices: false,
      getTaskAllow: false,
      applicationIdentifier: undefined,
    });
  });

  it.each([
    ["TEAM123.com.acme.notes", "com.acme.notes", true],
    ["TEAM123.com.acme.notes", "com.acme.notes2", false],
    ["TEAM123.*", "com.acme.notes", true],
    ["TEAM123.com.acme.*", "com.acme.notes", true],
    ["TEAM123.com.other.*", "com.acme.notes", false],
  ])("%s covers %s: %s", (applicationIdentifier, bundleId, covers) => {
    expect(profileCoversBundleId(applicationIdentifier, bundleId)).toBe(covers);
  });
});

describe("iosTarget", () => {
  const meta = (projectRoot: string, buildNumber: number) => ({
    projectName: "App",
    displayVersion: "1.2.3",
    buildNumber,
    projectRoot,
  });

  it("finds the IPA the publish wrote, and records its build number", async () => {
    const publish = tempDirectory();
    const projectRoot = tempDirectory();
    const ipaDir = path.join(publish, "ios-arm64", "publish");
    fs.ensureDirSync(ipaDir);
    fs.writeFileSync(path.join(ipaDir, "App.Host.ipa"), "ipa");

    const ipa = iosTarget.findBundle(publish, "App");
    expect(ipa).toBe(path.join(ipaDir, "App.Host.ipa"));
    const [artifact] = await iosTarget.package(ipa!, path.join(projectRoot, "dist"), meta(projectRoot, 10203));

    expect(path.basename(artifact)).toBe("App-1.2.3-ios.ipa");
    expect(fs.readFileSync(`${artifact}.build-number`, "utf8")).toBe("10203\n");
  });

  it("rejects a build number lower than one already packaged", async () => {
    const projectRoot = tempDirectory();
    const ipa = path.join(tempDirectory(), "App.ipa");
    fs.writeFileSync(ipa, "ipa");

    await iosTarget.package(ipa, path.join(projectRoot, "dist", "stable"), meta(projectRoot, 20000));
    await expect(
      iosTarget.package(ipa, path.join(projectRoot, "dist", "beta"), meta(projectRoot, 19999)),
    ).rejects.toThrow(/iOS build number 19999 cannot be lower/);
  });
});

describe("iosSimulatorTarget", () => {
  it("builds rather than publishes, for this Mac's simulator architecture", () => {
    expect(iosSimulatorTarget.dotnetVerb).toBe("build");
    expect(iosSimulatorTarget.extraPublishArgs).toContain(iosSimulatorRuntimeIdentifier());
    expect(iosSimulatorTarget.extraPublishArgs).toContain("-p:VidraAllowLocalNetworking=true");
    expect(iosSimulatorRuntimeIdentifier("arm64")).toBe("iossimulator-arm64");
    expect(iosSimulatorRuntimeIdentifier("x64")).toBe("iossimulator-x64");
  });

  it("copies the .app bundle, not the frameworks inside it", async () => {
    const build = tempDirectory();
    const projectRoot = tempDirectory();
    const app = path.join(build, iosSimulatorRuntimeIdentifier(), "App.Host.app");
    fs.ensureDirSync(path.join(app, "Frameworks", "Inner.framework"));
    fs.ensureDirSync(path.join(app, "PlugIns", "Nested.app"));
    fs.writeFileSync(path.join(app, "Info.plist"), "plist");

    expect(iosSimulatorTarget.findBundle(build, "App")).toBe(app);
    const [artifact] = await iosSimulatorTarget.package(app, path.join(projectRoot, "dist"), {
      projectName: "App",
      displayVersion: "1.2.3",
      buildNumber: 1,
      projectRoot,
    });
    expect(path.basename(artifact)).toBe("App-1.2.3-ios-simulator.app");
    expect(fs.existsSync(path.join(artifact, "Info.plist"))).toBe(true);
  });
});
