import fs from "node:fs";
import path from "node:path";
import { dim, fixLine, footer, lime, row, value } from "@vidra-dev/cli-shared/theme";
import type { GlyphName } from "@vidra-dev/cli-shared/theme";
import {
  listCodeSigningIdentities,
  listExpiredCodeSigningIdentities,
} from "./signing.js";
import { resolveNotaryCredentials } from "./notarize.js";
import { resolveWindowsSigningConfig } from "./windows-signing.js";
import { resolveVpk, vpkVersion } from "./velopack.js";
import {
  resolveFeeds,
  type ResolvedFeeds,
  type UpdateConfig,
} from "./update-config.js";
import { loadVidraConfig } from "./config.js";
import { FeedUriError } from "./feed-uri.js";
import { tryDetectProject } from "./project.js";
import { run, type RunResult } from "@vidra-dev/cli-shared/exec";
import {
  checkDotnetSdk,
  DOTNET,
  outputMentionsMauiTarget,
  type Requirement,
  type RequirementStatus,
} from "@vidra-dev/cli-shared/dotnet-toolchain";
import { parseArgs } from "@vidra-dev/cli-shared/utils";
import { rejectUnknownFlags } from "./help.js";
import { DOCTOR } from "./commands/specs.js";
import { resolveAndroidSigningConfig } from "./targets/android.js";

// --- Text scanning helpers ---------------------------------------------------

/** True when `text` matches at least one of the patterns. */
const matchesAny = (text: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

/** The version on the "Workload version: X" line of `dotnet workload list`. */
const WORKLOAD_SET_VERSION_LINE = /Workload version:\s*([\w.-]+)/i;

/** `xcode-select -p` pointing at the Command Line Tools, not a full Xcode.app. */
const COMMAND_LINE_TOOLS_PATH = /CommandLineTools/i;

// --- Pure helpers (unit-tested without invoking the toolchain) ---------------

/** Workload set version from `dotnet workload list` ("Workload version: 10.0.201"). */
export const workloadSetVersion = (
  workloadListOutput: string,
): string | undefined =>
  workloadListOutput.match(WORKLOAD_SET_VERSION_LINE)?.[1];

// --- Build-output signatures -------------------------------------------------
//
// A plain `dotnet build` (run by `vidra dev` and the scaffolder) can fail for
// environmental reasons that have well-known fixes. Rather than dump raw
// MSBuild output at the user, we scan it for these signatures and print a
// targeted hint. Each list collects the phrasings seen across SDK versions.

/** The MAUI workload isn't installed (NETSDK1147 + workload-restore guidance). */
const MISSING_WORKLOAD_SIGNATURES: readonly RegExp[] = [
  /NETSDK1147/i,
  /workloads?\s+must\s+be\s+installed/i,
  /maui-maccatalyst/i,
  /maui-windows/i,
  /maui-android/i,
  /to\s+install\s+the\s+.*workload/i,
];

/**
 * Full Xcode.app is missing. Mac Catalyst builds need it, not just the Command
 * Line Tools, and fail this way from Xamarin.Shared.targets when
 * `xcode-select -p` points at the CLT.
 */
const MISSING_XCODE_SIGNATURES: readonly RegExp[] = [
  /valid\s+Xcode\s+installation\s+was\s+not\s+found/i,
  /could\s+not\s+find\s+a\s+valid\s+Xcode\s+app\s+bundle/i,
  /macios-missing-xcode/i,
];

/**
 * The installed Xcode is older than the platform SDK the MAUI workload tracks.
 * Surfaces as MT0180 from the macios linker Setup step ("requires the
 * MacCatalyst X SDK (shipped with Xcode Y)").
 */
const OUTDATED_XCODE_SIGNATURES: readonly RegExp[] = [
  /error\s+MT0180/i,
  /requires\s+the\s+MacCatalyst\s+\S+\s+SDK\s+\(shipped\s+with\s+Xcode/i,
];

/** Heuristic: does build output indicate the MAUI workload is missing? */
export const looksLikeMissingWorkload = (output: string): boolean =>
  matchesAny(output, MISSING_WORKLOAD_SIGNATURES);

/** Heuristic: does build output indicate full Xcode is missing? */
export const looksLikeMissingXcode = (output: string): boolean =>
  matchesAny(output, MISSING_XCODE_SIGNATURES);

/** Heuristic: does build output indicate the installed Xcode is too old? */
export const looksLikeXcodeTooOld = (output: string): boolean =>
  matchesAny(output, OUTDATED_XCODE_SIGNATURES);

// --- Environment probes ------------------------------------------------------

const checkMauiWorkload = (
  workloadList: RunResult | null,
  target: DoctorTarget,
): Requirement => {
  const name = ".NET MAUI workload";

  if (!workloadList) {
    return { name, status: "unknown", detail: "requires the .NET SDK first" };
  }
  if (!workloadList.found) {
    return { name, status: "unknown", detail: "could not query workloads" };
  }
  const hasRequiredWorkload = outputMentionsMauiTarget(
    workloadList.stdout,
    target,
  );
  if (hasRequiredWorkload) {
    return { name, status: "ok", detail: "installed" };
  }
  return {
    name,
    status: "missing",
    detail: "not installed",
    fix: target === "android"
      ? "dotnet workload install maui-android"
      : "dotnet workload install maui",
  };
};

/**
 * Advisory: how do C# edits reach the running app on this OS? Never reported
 * as `missing` \u2014 `vidra dev` has a working loop on both platforms, and the
 * difference between them is a property of the platform, not of the machine,
 * so there is nothing here for a user to go and fix.
 *
 * On Windows `dotnet watch` applies deltas to the running process. On macOS
 * it cannot today: the Mac Catalyst hot-reload agent's connection drops before
 * any edit arrives (and older workloads never loaded the agent at all), so
 * `vidra dev` rebuilds and relaunches the app on save instead. Say so plainly
 * rather than advertising a loop the toolchain does not deliver.
 */
// --- Mac Catalyst SDK pack ---------------------------------------------------
//
// The Catalyst pack decides whether `dotnet watch run` can launch the app at
// all. Packs before 26.2.10233 compute the run path from `$(AssemblyName).app`
// while the build names the bundle `$(_AppBundleName).app` (i.e. from
// `ApplicationTitle`), so for any app whose title differs from its assembly
// name — every scaffolded Vidra app — the launch fails with "No such file or
// directory" and the watch session parks forever. Fixed upstream in
// dotnet/macios#26318; verified by reading the shipped targets of each pack:
// broken in 26.0.11017, 26.1.10502 and 26.2.10191, fixed in 26.2.10233,
// 26.4.10259 and 26.5.10301.
//
// `dotnet workload list` cannot answer this: with `--skip-manifest-update` the
// workload set version advances while the Catalyst manifest stays behind, so
// the pack on disk is the only honest source.
const FIRST_FIXED_MACCATALYST_PACK = [26, 2, 10233];

const MACCATALYST_PACK_DIR = /^Microsoft\.MacCatalyst\.Sdk\.net\d+\.\d+_\d+\.\d+$/;

const compareVersions = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const versionSegments = (version: string): number[] | null => {
  const segments = version.split(".").map((s) => Number.parseInt(s, 10));
  return segments.length && !segments.some(Number.isNaN) ? segments : null;
};

/** The newest of a list of pack version directory names, or undefined. */
export const newestPackVersion = (versions: string[]): string | undefined => {
  let best: { raw: string; segments: number[] } | undefined;
  for (const raw of versions) {
    const segments = versionSegments(raw);
    if (!segments) continue;
    if (!best || compareVersions(segments, best.segments) > 0) {
      best = { raw, segments };
    }
  }
  return best?.raw;
};

/**
 * True when this Catalyst pack still computes the run path from the assembly
 * name, i.e. `dotnet watch run` cannot launch a scaffolded app. Unparseable
 * versions read as fine: the check is advisory and a false alarm is worse than
 * a missed one.
 */
export const macCatalystPackIsStale = (version: string): boolean => {
  const segments = versionSegments(version);
  return segments
    ? compareVersions(segments, FIRST_FIXED_MACCATALYST_PACK) < 0
    : false;
};

/** Where the SDK keeps its packs, derived from `dotnet --list-sdks`. */
const dotnetPacksDir = (): string | undefined => {
  if (process.env.DOTNET_ROOT) {
    return path.join(process.env.DOTNET_ROOT, "packs");
  }
  const res = run(DOTNET, ["--list-sdks"]);
  if (!res.found) return undefined;
  // "10.0.302 [/usr/local/share/dotnet/sdk]" — the sdk dir's parent is the root.
  const sdkDir = res.stdout.trim().split("\n").pop()?.match(/\[(.+)\]\s*$/)?.[1];
  return sdkDir ? path.join(path.dirname(sdkDir), "packs") : undefined;
};

/** Newest Mac Catalyst SDK pack installed, or undefined if none/unreadable. */
export const installedMacCatalystPackVersion = (): string | undefined => {
  const packs = dotnetPacksDir();
  if (!packs) return undefined;
  try {
    const versions = fs
      .readdirSync(packs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && MACCATALYST_PACK_DIR.test(e.name))
      .flatMap((e) => {
        try {
          return fs
            .readdirSync(path.join(packs, e.name), { withFileTypes: true })
            .filter((v) => v.isDirectory())
            .map((v) => v.name);
        } catch {
          return [];
        }
      });
    return newestPackVersion(versions);
  } catch {
    return undefined;
  }
};

const checkCSharpDevLoop = (
  workloadList: RunResult | null,
  target: DoctorTarget,
): Requirement => {
  const name = "C# dev loop";
  if (!workloadList) {
    return { name, status: "unknown", detail: "requires the .NET SDK first" };
  }
  if (target === "android") {
    return {
      name,
      status: "ok",
      detail: "C# edits rebuild, reinstall, and relaunch the Android app",
    };
  }
  if (process.platform !== "darwin") {
    return {
      name,
      status: "ok",
      detail: "dotnet watch applies C# edits to the running app",
    };
  }
  const pack = installedMacCatalystPackVersion();
  if (pack && macCatalystPackIsStale(pack)) {
    return {
      name,
      status: "unknown",
      detail: `Mac Catalyst pack ${pack} cannot launch the app under dotnet watch \u2014 vidra dev falls back to a classic launch (fixed in 26.2.10233+)`,
      fix: "dotnet workload update",
    };
  }
  const packNote = pack ? ` (Mac Catalyst pack ${pack})` : "";
  return {
    name,
    status: "ok",
    detail: `dotnet watch applies C# edits to the running app${packNote} \u2014 vidra dev rebuilds and relaunches if the agent drops mid-session`,
  };
};

const checkXcode = (): Requirement => {
  const name = "Xcode";
  const res = run("xcode-select", ["-p"]);

  if (!res.found || !res.ok) {
    return {
      name,
      status: "missing",
      detail: "not found",
      fix: "Install Xcode from the App Store",
    };
  }
  const devDir = res.stdout.trim();
  if (COMMAND_LINE_TOOLS_PATH.test(devDir)) {
    return {
      name,
      status: "missing",
      detail: "only Command Line Tools detected (Mac Catalyst needs full Xcode)",
      fix: "Install Xcode, then: sudo xcode-select -s /Applications/Xcode.app",
    };
  }
  return { name, status: "ok", detail: devDir };
};

// --- Distribution readiness --------------------------------------------------

/**
 * These checks are deliberately advisory — they never report `missing`, because
 * a developer who only runs `vidra dev` has no reason to hold a certificate and
 * `vidra doctor` must not fail for them. They exist so that the day someone
 * tries to ship, the gap is already visible instead of being discovered by a
 * user hitting a Gatekeeper wall.
 */
export const checkMacSigningIdentity = (): Requirement => {
  const all = listCodeSigningIdentities();
  const expired = new Set(listExpiredCodeSigningIdentities(all));
  const identities = all.filter((id) => !expired.has(id));

  if (identities.some((id) => id.startsWith("Developer ID Application:"))) {
    return {
      name: "macOS signing (distribution)",
      status: "ok",
      detail: "Developer ID Application certificate found",
    };
  }
  // An expired certificate is still in the keychain and still looks present, so
  // name it — otherwise the only symptom is `codesign` failing without a reason.
  const expiredDeveloperId = [...expired].find((id) =>
    id.startsWith("Developer ID Application:"),
  );
  if (expiredDeveloperId) {
    return {
      name: "macOS signing (distribution)",
      status: "unknown",
      detail: `Developer ID certificate expired — ${expiredDeveloperId}`,
      fix: "Renew it in the Apple Developer portal, then re-download and install it",
    };
  }
  if (identities.some((id) => id.startsWith("Apple Development:"))) {
    return {
      name: "macOS signing (distribution)",
      status: "unknown",
      detail:
        "only a development certificate found — fine for `vidra dev`, cannot be notarized",
      fix: "Create a Developer ID Application certificate (requires the Apple Developer Program)",
    };
  }
  return {
    name: "macOS signing (distribution)",
    status: "unknown",
    detail: "no code-signing identity — builds will be ad-hoc signed",
    fix: "Create a Developer ID Application certificate, or set VIDRA_MACOS_CODESIGN_KEY",
  };
};

export const checkNotarization = (): Requirement => {
  const creds = resolveNotaryCredentials();
  if (creds) {
    return {
      name: "macOS notarization",
      status: "ok",
      detail:
        creds.mode === "profile"
          ? `keychain profile "${creds.profile}"`
          : `Apple ID ${creds.appleId} (team ${creds.teamId})`,
    };
  }
  return {
    name: "macOS notarization",
    status: "unknown",
    detail: "no credentials — `vidra build` will skip notarization",
    fix: "xcrun notarytool store-credentials, then set VIDRA_NOTARY_PROFILE",
  };
};

export const checkWindowsSigning = (): Requirement => {
  const config = resolveWindowsSigningConfig();
  if (config) {
    return {
      name: "Windows signing",
      status: "ok",
      detail:
        config.mode === "pfx"
          ? `certificate file ${config.pfxPath}`
          : `store certificate ${config.thumbprint}`,
    };
  }
  return {
    name: "Windows signing",
    status: "unknown",
    detail: "no certificate — builds ship unsigned and SmartScreen will warn",
    fix: "Set VIDRA_WINDOWS_CERT_PATH (+ VIDRA_WINDOWS_CERT_PASSWORD) or VIDRA_WINDOWS_CERT_THUMBPRINT",
  };
};

/**
 * A self-contained build bundles the .NET runtime and the WindowsAppSDK, but
 * *not* the WebView2 Evergreen Runtime — that is a machine-wide install. It
 * ships with Windows 11 and alongside Edge on Windows 10, so it is usually
 * present, but a machine without it launches Vidra apps to a blank window.
 */
export const checkWebView2Runtime = (): Requirement => {
  const key =
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
  const result = run("reg", ["query", key, "/v", "pv"]);
  const version = result.stdout.match(/pv\s+REG_SZ\s+([\d.]+)/)?.[1];
  if (result.ok && version && version !== "0.0.0.0") {
    return {
      name: "WebView2 runtime",
      status: "ok",
      detail: `found ${version}`,
    };
  }
  return {
    name: "WebView2 runtime",
    status: "unknown",
    detail: "not detected — Vidra apps need it to render on this machine",
    fix: "https://developer.microsoft.com/microsoft-edge/webview2/",
  };
};

/**
 * Velopack's CLI. Reported as `unknown` rather than `missing` when it is absent
 * and unconfigured: most apps never pack a native release, and a doctor that
 * cries about a tool nobody asked for is a doctor people stop reading.
 */
export const checkVelopack = (required: boolean): Requirement => {
  const vpk = resolveVpk();
  if (vpk) {
    const version = vpkVersion(vpk);
    return {
      name: "Velopack (vpk)",
      status: "ok",
      detail: version ? `${version} at ${vpk}` : vpk,
    };
  }

  return {
    name: "Velopack (vpk)",
    status: required ? "missing" : "unknown",
    detail: required
      ? "a feed is configured for whole-app updates but vpk is not installed, so `vidra build` cannot pack a release"
      : "not installed, and only needed once an app publishes whole-app updates",
    fix: "dotnet tool install -g vpk",
  };
};

type DoctorTarget = "macos" | "windows" | "android";

const checkAndroidSdk = (): Requirement => {
  const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  return sdk && fs.existsSync(sdk)
    ? { name: "Android SDK", status: "ok", detail: sdk }
    : {
        name: "Android SDK",
        status: "missing",
        detail: "ANDROID_SDK_ROOT/ANDROID_HOME does not point to an installed SDK",
        fix: "install Android Studio command-line tools and set ANDROID_SDK_ROOT",
      };
};

const checkJdk17 = (): Requirement => {
  const result = run("java", ["-version"]);
  const output = `${result.stdout}\n${result.stderr}`;
  const major = Number(output.match(/version \"(?:1\\.)?(\\d+)/)?.[1]);
  return result.found && major >= 17
    ? { name: "JDK", status: "ok", detail: `Java ${major}` }
    : {
        name: "JDK",
        status: "missing",
        detail: result.found ? "Java 17 or newer is required" : "java not found",
        fix: "install JDK 17 and set JAVA_HOME",
      };
};

const checkAdb = (): Requirement => {
  const result = run("adb", ["devices"]);
  if (!result.found) {
    return {
      name: "adb",
      status: "missing",
      detail: "not found on PATH",
      fix: "add Android SDK platform-tools to PATH",
    };
  }
  const connected = result.stdout
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => /\sdevice\s*$/.test(line)).length;
  return {
    name: "adb",
    status: connected > 0 ? "ok" : "unknown",
    detail: connected > 0
      ? `${connected} device${connected === 1 ? "" : "s"} connected`
      : "installed; no emulator or device connected",
  };
};

const checkAndroidSigning = (): Requirement => {
  try {
    const config = resolveAndroidSigningConfig();
    return config
      ? { name: "Android signing", status: "ok", detail: `${config.keyAlias} · ${config.keyStore}` }
      : {
          name: "Android signing",
          status: "unknown",
          detail: "not configured; required only for `vidra build --target android`",
          fix: "set VIDRA_ANDROID_KEYSTORE, VIDRA_ANDROID_KEY_ALIAS, VIDRA_ANDROID_KEY_PASSWORD, and VIDRA_ANDROID_STORE_PASSWORD",
        };
  } catch (error) {
    return {
      name: "Android signing",
      status: "missing",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * What is left to get wrong once a feed URL is the only switch.
 *
 * Every scaffolded app carries the whole updater, so the states below are not
 * "did you wire it up" any more — they are the two things a URL cannot fix: a
 * config that turns nothing on, and an app scaffolded before the updater
 * shipped live, whose own source is missing the parts a package cannot
 * retrofit.
 *
 * Typed config loading catches unknown keys before this runs. Doctor handles
 * valid update settings that are internally consistent but cannot work with
 * the native project as wired.
 *
 * A pure function over what was read, so every state below is a unit test
 * rather than a scaffolded app someone has to break by hand.
 */
export const diagnoseUpdateConfiguration = (input: {
  config: UpdateConfig | null;
  target?: DoctorTarget;
  /** Source of `MauiProgram.cs`, or null when it could not be read. */
  mauiProgram: string | null;
  /** Source of the host `.csproj`, or null when it could not be read. */
  csproj: string | null;
  /** Sources of the per-platform `Program.cs` files that exist. */
  entryPoints: Record<string, string>;
  /** True when a `bundles.json` has been published but no `.sig` sits beside it. */
  publishedUnsigned: boolean;
}): Requirement[] => {
  const { config } = input;
  if (!config) return [];

  let feeds: ResolvedFeeds;
  try {
    feeds = resolveFeeds(config);
  } catch (error) {
    if (!(error instanceof FeedUriError)) throw error;
    return [
      {
        name: "Update feed",
        status: "missing",
        detail: error.message,
        fix: "npx vidra updates init --feed <url>",
      },
    ];
  }

  const found: Requirement[] = [];

  if (!feeds.web && !feeds.app) {
    found.push({
      name: "Update feed",
      status: "missing",
      detail:
        config.enabled === false
          ? "updates are switched off with enabled: false — nothing is checked"
          : "vidra.config.ts updates has no feed URL, so nothing is ever checked",
      fix: "npx vidra updates init --feed <url>",
    });
    return found;
  }

  // Comments first. The scaffolded sources explain themselves, and those
  // explanations name the very calls being looked for, so a naive substring
  // search reports every app as already wired up.
  const mauiProgram = input.mauiProgram === null ? null : stripComments(input.mauiProgram);

  if (feeds.web && mauiProgram !== null && !mauiProgram.includes(".UseVidraUpdates(")) {
    found.push({
      name: "OTA updates wired up",
      status: "missing",
      detail: "a feed is configured, but MauiProgram never calls .UseVidraUpdates()",
      fix: "add .UseVidraUpdates() after .UseVidra() in MauiProgram.cs",
    });
  }

  if (feeds.app) {
    if (input.target === "android") {
      found.push({
        name: "Android app updates",
        status: "missing",
        detail: "whole-app feeds are unsupported on Android; Google Play owns app updates",
        fix: "configure updates.feed.web only for Android builds",
      });
    } else {
    if (mauiProgram !== null && !mauiProgram.includes(".UseVidraNativeUpdates(")) {
      found.push({
        name: "Native updates wired up",
        status: "missing",
        detail: "a feed is configured, but MauiProgram never calls .UseVidraNativeUpdates()",
        fix: "add .UseVidraNativeUpdates() after .UseVidra() in MauiProgram.cs",
      });
    }

    if (input.csproj !== null && !input.csproj.includes("Vidra.Updates.Native")) {
      found.push({
        name: "Velopack package",
        status: "missing",
        detail: "the host project does not reference Vidra.Updates.Native, so there is no updater to run",
        fix: '<PackageReference Include="Vidra.Updates.Native" Version="..." /> in the host .csproj',
      });
    }

    // The one thing a package reference cannot retrofit. Missing here means the
    // app installs and launches perfectly and never handles a Velopack hook.
    for (const [platform, source] of Object.entries(input.entryPoints)) {
      if (!stripComments(source).includes("VelopackApp.Build(")) {
        found.push({
          name: `Velopack entry point (${platform})`,
          status: "missing",
          detail: `Platforms/${platform}/Program.cs never calls VelopackApp.Build()...Run(), so install and update hooks are ignored`,
          fix: "VelopackApp.Build().UseVidraLocator().Run(); as the first line of Main",
        });
      }
    }
    }
  }

  if (input.publishedUnsigned && (config?.publicKeys?.length ?? 0) > 0) {
    found.push({
      name: "Feed signature",
      status: "missing",
      detail: "publicKeys are configured, so signatures are mandatory, but the published bundles.json has no .sig beside it",
      fix: "republish with `vidra build --web --sign <key.pem>`",
    });
  }

  return found;
};

/**
 * C# line and block comments, removed. Crude on purpose: it does not know
 * about strings, and nothing here needs it to: the only question is whether a
 * builder call is live code or the template explaining itself.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * Every `bundles.json` this project has published locally.
 *
 * Shallow on purpose: a feed directory sits one or two levels under `dist/`
 * depending on whether the build used a channel, and looking further would
 * start reporting on directories that are not feeds.
 */
const publishedFeeds = (projectRoot: string): string[] => {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 2 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === "bundles.json") found.push(full);
    }
  };
  walk(path.join(projectRoot, "dist"), 0);
  return found;
};

/** Reads what {@link diagnoseUpdateConfiguration} needs off disk. */
const inspectUpdateConfiguration = (
  config: UpdateConfig | null,
  target?: DoctorTarget,
): Requirement[] => {
  const project = tryDetectProject(process.cwd());
  if (!project) return [];

  if (!config) return [];

  const entryPoints: Record<string, string> = {};
  for (const platform of ["MacCatalyst", "Windows"]) {
    const source = readIfPresent(
      path.join(project.hostDir, "Platforms", platform, "Program.cs"),
    );
    if (source !== null) entryPoints[platform] = source;
  }

  const publishedUnsigned = publishedFeeds(project.root).some(
    (index) => !fs.existsSync(`${index}.sig`),
  );

  let nativeWanted = false;
  try {
    nativeWanted = !!resolveFeeds(config).app;
  } catch {
    // A feed we cannot resolve is diagnosed below; it does not decide whether
    // `vpk` is required.
  }

  return [
    ...(target !== "android" && (nativeWanted || resolveVpk())
      ? [checkVelopack(nativeWanted)]
      : []),
    ...diagnoseUpdateConfiguration({
      config,
      target,
      mauiProgram: readIfPresent(path.join(project.hostDir, "MauiProgram.cs")),
      csproj: readIfPresent(project.csprojPath),
      entryPoints,
      publishedUnsigned,
    }),
  ];
};

const readIfPresent = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
};

// --- Reporting ---------------------------------------------------------------

export const collectRequirements = (
  opts: {
    includeXcode?: boolean;
    updateConfig?: UpdateConfig | null;
    target?: DoctorTarget;
  } = {},
): Requirement[] => {
  const platformTarget = opts.target
    ?? (process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : "android");
  const dotnet = checkDotnetSdk();
  const workloadList =
    dotnet.status === "ok" ? run(DOTNET, ["workload", "list"]) : null;
  const reqs: Requirement[] = [
    dotnet,
    checkMauiWorkload(workloadList, platformTarget),
    checkCSharpDevLoop(workloadList, platformTarget),
  ];
  if (opts.includeXcode ?? platformTarget === "macos") {
    reqs.push(checkXcode());
  }
  if (platformTarget === "macos") {
    reqs.push(checkMacSigningIdentity(), checkNotarization());
  }
  if (platformTarget === "windows") {
    reqs.push(checkWindowsSigning(), checkWebView2Runtime());
  }
  if (platformTarget === "android") {
    reqs.push(checkAndroidSdk(), checkJdk17(), checkAdb(), checkAndroidSigning());
  }

  const updateIssues = inspectUpdateConfiguration(
    opts.updateConfig ?? null,
    platformTarget,
  );
  if (updateIssues.length > 0) {
    reqs.push(...updateIssues);
  }

  return reqs;
};

const STATUS_GLYPH: Record<RequirementStatus, GlyphName> = {
  ok: "done",
  missing: "error",
  unknown: "manual",
};

export const printRequirements = (reqs: Requirement[]): void => {
  const labelWidth = Math.max(0, ...reqs.map((r) => r.name.length)) + 2;
  for (const r of reqs) {
    console.log(
      row({
        glyph: STATUS_GLYPH[r.status],
        label: r.name,
        labelWidth,
        detail: r.detail ? dim(r.detail) : undefined,
      }),
    );
    if (r.status !== "ok" && r.fix) {
      console.log(fixLine(r.fix));
    }
  }
};

/** Implements the `vidra doctor` command. Returns a process exit code. */
export const runDoctor = async (argv: string[] = []): Promise<number> => {
  const args = parseArgs(["_", "_", ...argv]);
  if (rejectUnknownFlags(DOCTOR, args)) return 1;
  const defaultTarget: DoctorTarget =
    process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : "android";
  const target = ((args.target as string | undefined) ?? defaultTarget) as DoctorTarget;
  if (!["macos", "windows", "android"].includes(target)) {
    console.error(row({ glyph: "error", detail: dim(`unsupported target: ${target}`) }));
    return 1;
  }

  console.log();
  console.log(`  ${lime("vidra")} ${value("doctor")}`);
  console.log();
  console.log(footer(dim("checking your environment\u2026")));
  console.log();

  const project = tryDetectProject(process.cwd());
  const updateConfig = project
    ? (await loadVidraConfig(project.root, {
        command: "doctor",
        mode: "development",
        target,
      })).updates
    : null;
  const reqs = collectRequirements({ updateConfig, target });
  printRequirements(reqs);
  console.log();

  const missing = reqs.filter((r) => r.status === "missing");
  if (missing.length === 0) {
    console.log(
      footer(
        `${dim("all checks passed \u2014 you're ready to run")} ${lime(
          "npm run dev",
        )}${dim(".")}`,
      ),
    );
    console.log();
    return 0;
  }

  const n = missing.length;
  console.log(
    footer(
      `${dim(
        `${n} issue${n === 1 ? "" : "s"} found. apply the ${
          n === 1 ? "fix" : "fixes"
        } above, then re-run`,
      )} ${lime("npm run doctor")}${dim(".")}`,
    ),
  );
  console.log();
  return 1;
};

/** Prints an actionable hint when a build error looks workload-related. */
export const printWorkloadHint = (): void => {
  console.error();
  console.error(
    row({ glyph: "manual", label: "this looks like a missing .NET MAUI workload." }),
  );
  console.error(fixLine("dotnet workload install maui"));
  console.error(fixLine("vidra doctor", "check:"));
  console.error();
};

/** Prints an actionable hint when the installed Xcode predates the workload's SDK. */
export const printXcodeTooOldHint = (): void => {
  console.error();
  console.error(
    row({
      glyph: "manual",
      label: "your Xcode is older than the SDK this MAUI workload set expects.",
    }),
  );
  console.error(
    `      ${dim("\u2022")} ${dim("update Xcode (App Store), then")} ${lime("sudo xcodebuild -runFirstLaunch")}`,
  );
  console.error(
    `      ${dim("\u2022")} ${dim("or pin the workloads to your Xcode's era:")} ${lime("dotnet workload update --version <set>")}`,
  );
  console.error(fixLine("vidra doctor", "check:"));
  console.error();
};

/** Prints an actionable hint when a build error looks like missing full Xcode. */
export const printXcodeHint = (): void => {
  console.error();
  console.error(
    row({
      glyph: "manual",
      label:
        "Mac Catalyst needs the full Xcode app, not just the Command Line Tools.",
    }),
  );
  console.error(`      ${dim("1.")} ${value("install Xcode from the App Store")}`);
  console.error(
    `      ${dim("2.")} ${lime(
      "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
    )}`,
  );
  console.error(`      ${dim("3.")} ${lime("sudo xcodebuild -runFirstLaunch")}`);
  console.error(fixLine("vidra doctor", "check:"));
  console.error();
};
