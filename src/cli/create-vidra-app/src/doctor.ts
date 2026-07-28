import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";
import { dim, fixLine, footer, lime, row, value } from "./theme.js";
import type { GlyphName } from "./theme.js";
import {
  listCodeSigningIdentities,
  listExpiredCodeSigningIdentities,
} from "./signing.js";
import { resolveNotaryCredentials } from "./notarize.js";
import { resolveWindowsSigningConfig } from "./windows-signing.js";

const DOTNET = process.platform === "win32" ? "dotnet.exe" : "dotnet";
const MAUI_DOCS =
  "https://learn.microsoft.com/dotnet/maui/get-started/installation";

/** Fix shown whenever a suitable .NET SDK is absent (reused across checks). */
const INSTALL_NET_10_FIX =
  "Install the .NET 10 SDK — https://dotnet.microsoft.com/download";

export type RequirementStatus = "ok" | "missing" | "unknown";

export interface Requirement {
  name: string;
  status: RequirementStatus;
  detail?: string;
  /** Command or URL that resolves a `missing` requirement. */
  fix?: string;
}

interface RunResult {
  /** The executable was located and spawned (regardless of exit code). */
  found: boolean;
  /** Process exited 0. */
  ok: boolean;
  stdout: string;
  stderr: string;
}

const bufToStr = (v: Buffer | string | undefined): string =>
  v == null ? "" : Buffer.isBuffer(v) ? v.toString() : v;

const run = (cmd: string, args: string[]): RunResult => {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { found: true, ok: true, stdout: stdout ?? "", stderr: "" };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      found: err.code !== "ENOENT",
      ok: false,
      stdout: bufToStr(err.stdout),
      stderr: bufToStr(err.stderr),
    };
  }
};

// --- Text scanning helpers ---------------------------------------------------

const splitLines = (text: string): string[] => text.split(/\r?\n/);

/** True when `text` matches at least one of the patterns. */
const matchesAny = (text: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

/** A 10.x version at the start of a `dotnet --list-sdks` line. */
const NET_10_VERSION = /^10\./;

/** The version on the "Workload version: X" line of `dotnet workload list`. */
const WORKLOAD_SET_VERSION_LINE = /Workload version:\s*([\w.-]+)/i;

/** A MAUI workload row in `dotnet workload list`. */
const MAUI_WORKLOAD = /\bmaui\b/i;

/** `xcode-select -p` pointing at the Command Line Tools, not a full Xcode.app. */
const COMMAND_LINE_TOOLS_PATH = /CommandLineTools/i;

// --- Pure helpers (unit-tested without invoking the toolchain) ---------------

/** True when `dotnet --list-sdks` reports at least one 10.x SDK. */
export const hasNet10Sdk = (listSdksOutput: string): boolean =>
  splitLines(listSdksOutput).some((line) => NET_10_VERSION.test(line.trim()));

/** Newest 10.x SDK version string from `dotnet --list-sdks`, if any. */
export const newestNet10Sdk = (listSdksOutput: string): string | undefined =>
  splitLines(listSdksOutput)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((version) => NET_10_VERSION.test(version))
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    )
    .pop();

/** True when `dotnet workload list` output contains a MAUI workload row. */
export const outputMentionsMaui = (workloadListOutput: string): boolean =>
  MAUI_WORKLOAD.test(workloadListOutput);

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

const checkDotnetSdk = (): Requirement => {
  const name = ".NET SDK";
  const res = run(DOTNET, ["--list-sdks"]);

  if (!res.found) {
    return {
      name,
      status: "missing",
      detail: "`dotnet` was not found on your PATH",
      fix: INSTALL_NET_10_FIX,
    };
  }
  if (!res.ok && !res.stdout) {
    return { name, status: "unknown", detail: "could not run `dotnet --list-sdks`" };
  }
  if (hasNet10Sdk(res.stdout)) {
    const newest = newestNet10Sdk(res.stdout);
    return { name, status: "ok", detail: newest ? `found ${newest}` : "found 10.x" };
  }
  return {
    name,
    status: "missing",
    detail: "no 10.x SDK installed",
    fix: INSTALL_NET_10_FIX,
  };
};

const checkMauiWorkload = (workloadList: RunResult | null): Requirement => {
  const name = ".NET MAUI workload";

  if (!workloadList) {
    return { name, status: "unknown", detail: "requires the .NET SDK first" };
  }
  if (!workloadList.found) {
    return { name, status: "unknown", detail: "could not query workloads" };
  }
  if (outputMentionsMaui(workloadList.stdout)) {
    return { name, status: "ok", detail: "installed" };
  }
  return {
    name,
    status: "missing",
    detail: "not installed",
    fix: "dotnet workload install maui",
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

const checkCSharpDevLoop = (workloadList: RunResult | null): Requirement => {
  const name = "C# dev loop";
  if (!workloadList) {
    return { name, status: "unknown", detail: "requires the .NET SDK first" };
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

export const isMauiWorkloadInstalled = (): boolean =>
  outputMentionsMaui(run(DOTNET, ["workload", "list"]).stdout);

export const isInteractive = (): boolean =>
  Boolean(process.stdin.isTTY && process.stdout.isTTY);

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

// --- Reporting ---------------------------------------------------------------

export const collectRequirements = (
  opts: { includeXcode?: boolean } = {},
): Requirement[] => {
  const dotnet = checkDotnetSdk();
  const workloadList =
    dotnet.status === "ok" ? run(DOTNET, ["workload", "list"]) : null;
  const reqs: Requirement[] = [
    dotnet,
    checkMauiWorkload(workloadList),
    checkCSharpDevLoop(workloadList),
  ];
  if (opts.includeXcode ?? process.platform === "darwin") {
    reqs.push(checkXcode());
  }
  if (process.platform === "darwin") {
    reqs.push(checkMacSigningIdentity(), checkNotarization());
  }
  if (process.platform === "win32") {
    reqs.push(checkWindowsSigning(), checkWebView2Runtime());
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
export const runDoctor = async (): Promise<number> => {
  console.log();
  console.log(`  ${lime("vidra")} ${value("doctor")}`);
  console.log();
  console.log(footer(dim("checking your environment\u2026")));
  console.log();

  const reqs = collectRequirements();
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

// --- Workload gate -----------------------------------------------------------

const installWorkload = (csprojPath?: string): boolean => {
  // `workload restore <csproj>` installs only the workloads the project's
  // target frameworks need (e.g. just maccatalyst on macOS); the umbrella
  // `install maui` is the documented fallback when no project is in scope.
  const args = csprojPath
    ? ["workload", "restore", csprojPath]
    : ["workload", "install", "maui"];

  console.log();
  console.log(
    row({
      glyph: "active",
      detail: `${dim("running")} ${value(`${DOTNET} ${args.join(" ")}`)}`,
    }),
  );
  console.log(
    footer(
      dim("this can download several hundred MB and take a few minutes."),
    ),
  );
  console.log();

  try {
    execFileSync(DOTNET, args, { stdio: "inherit" });
    return true;
  } catch {
    console.error();
    console.error(row({ glyph: "error", label: "workload install failed" }));
    console.error(
      footer(
        dim(
          "if this is a permissions error, your SDK is in a system location and needs elevation:",
        ),
      ),
    );
    console.error(fixLine("sudo dotnet workload install maui"));
    console.error();
    return false;
  }
};

/**
 * Verifies the .NET MAUI workload is available, offering to install it when the
 * session is interactive. Returns true if the workload is present (or was just
 * installed). Callers that require the workload should exit when this is false;
 * the scaffolder calls it advisorily and ignores the result.
 */
export const ensureMauiWorkload = async (opts: {
  csprojPath?: string;
  interactive?: boolean;
} = {}): Promise<boolean> => {
  const dotnet = checkDotnetSdk();
  if (dotnet.status === "missing") {
    console.log();
    console.log(
      row({
        glyph: "error",
        label: dotnet.name,
        detail: dotnet.detail ? dim(dotnet.detail) : undefined,
      }),
    );
    if (dotnet.fix) {
      console.log(fixLine(dotnet.fix));
    }
    return false;
  }
  // SDK present but unverifiable — let the real build surface any error.
  if (dotnet.status === "unknown") return true;

  if (isMauiWorkloadInstalled()) return true;

  console.log();
  console.log(
    row({
      glyph: "error",
      label: ".NET MAUI workload",
      detail: dim("required but not installed"),
    }),
  );

  const interactive = opts.interactive ?? isInteractive();
  if (interactive) {
    let install = false;
    try {
      const res = await prompts({
        type: "confirm",
        name: "install",
        message: "Install the .NET MAUI workload now?",
        initial: true,
      });
      install = Boolean(res.install);
    } catch {
      install = false;
    }
    if (install) {
      if (installWorkload(opts.csprojPath) && isMauiWorkloadInstalled()) {
        console.log(
          row({
            glyph: "done",
            label: ".NET MAUI workload",
            detail: dim("installed"),
          }),
        );
        return true;
      }
      return false;
    }
  }

  console.log(fixLine("dotnet workload install maui", "run:"));
  console.log(fixLine(MAUI_DOCS, "docs:"));
  return false;
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
