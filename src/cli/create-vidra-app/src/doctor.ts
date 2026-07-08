import { execFileSync } from "node:child_process";
import prompts from "prompts";
import { dim, fixLine, footer, lime, row, value } from "./theme.js";
import type { GlyphName } from "./theme.js";

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

/**
 * Minimum workload set whose Mac Catalyst SDK supports `dotnet run` /
 * `dotnet watch` (shipped with the macios "Xcode 26.4" release in workload
 * set 10.0.203). Older sets make `vidra dev` fall back to a classic launch.
 */
const MIN_MACCATALYST_WATCH_WORKLOAD_SET = [10, 0, 203];

/**
 * Compares the leading dotted segments of `version` against `minimum`. Missing
 * segments read as 0, and a non-numeric leading segment (e.g. "unknown") fails
 * closed. Segments beyond `minimum`'s length are ignored, so "10.0.203.1"
 * satisfies a 10.0.203 minimum.
 */
const meetsMinimumVersion = (
  version: string,
  minimum: readonly number[],
): boolean => {
  const segments = version.split(".").map((s) => Number.parseInt(s, 10));
  if (segments.slice(0, minimum.length).some(Number.isNaN)) return false;

  for (let i = 0; i < minimum.length; i++) {
    const segment = segments[i] ?? 0;
    if (segment !== minimum[i]) return segment > minimum[i];
  }
  return true;
};

/** True when the workload set is new enough for C# hot reload on Mac Catalyst. */
export const workloadSetSupportsCSharpHotReload = (version: string): boolean =>
  meetsMinimumVersion(version, MIN_MACCATALYST_WATCH_WORKLOAD_SET);

/**
 * Environment probe for the dev command: is C# hot reload usable for Mac
 * Catalyst here? On older workload sets `dotnet watch` still launches the app
 * but silently never applies deltas (the hot reload startup hook only works
 * from macios 26.4 / workload set 10.0.203), so `vidra dev` must decide
 * up-front rather than trust the session to fail. Returns the blocking
 * workload set version when unsupported, null when supported or undeterminable
 * (let the watch session try).
 */
export const macCatalystHotReloadBlocker = (): string | null => {
  const res = run(DOTNET, ["workload", "list"]);
  if (!res.found) return null;
  const version = workloadSetVersion(res.stdout);
  if (!version) return null;
  return workloadSetSupportsCSharpHotReload(version) ? null : version;
};

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
 * Advisory: can this environment run the host under `dotnet watch`? On
 * Windows any .NET 10 SDK can; Mac Catalyst needs a recent enough workload
 * set. Never reported as `missing` — `vidra dev` degrades gracefully to a
 * classic launch, so an old workload set shouldn't fail the doctor.
 */
const checkCSharpHotReload = (workloadList: RunResult | null): Requirement => {
  const name = "C# hot reload";
  if (!workloadList) {
    return { name, status: "unknown", detail: "requires the .NET SDK first" };
  }
  if (process.platform !== "darwin") {
    return { name, status: "ok", detail: "dotnet watch supported" };
  }
  const version = workloadSetVersion(workloadList.stdout);
  if (!version) {
    return {
      name,
      status: "unknown",
      detail: "could not read the workload set version",
    };
  }
  if (workloadSetSupportsCSharpHotReload(version)) {
    return { name, status: "ok", detail: `workload set ${version}` };
  }
  return {
    name,
    status: "unknown",
    detail: `workload set ${version} predates Mac Catalyst dotnet-watch support (needs 10.0.203+) — vidra dev falls back to a classic launch`,
    fix: "dotnet workload update",
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
    checkCSharpHotReload(workloadList),
  ];
  if (opts.includeXcode ?? process.platform === "darwin") {
    reqs.push(checkXcode());
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
