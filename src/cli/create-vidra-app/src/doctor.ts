import { execFileSync } from "node:child_process";
import prompts from "prompts";
import chalk from "chalk";

const DOTNET = process.platform === "win32" ? "dotnet.exe" : "dotnet";
const MAUI_DOCS =
  "https://learn.microsoft.com/dotnet/maui/get-started/installation";

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

// --- Pure helpers (unit-tested without invoking the toolchain) ---------------

/** True when `dotnet --list-sdks` reports at least one 10.x SDK. */
export const hasNet10Sdk = (listSdksOutput: string): boolean =>
  listSdksOutput.split(/\r?\n/).some((line) => /^10\./.test(line.trim()));

/** Newest 10.x SDK version string from `dotnet --list-sdks`, if any. */
export const newestNet10Sdk = (listSdksOutput: string): string | undefined =>
  listSdksOutput
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((v) => /^10\./.test(v))
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    )
    .pop();

/** True when `dotnet workload list` output contains a MAUI workload row. */
export const outputMentionsMaui = (workloadListOutput: string): boolean =>
  /\bmaui\b/i.test(workloadListOutput);

/** Heuristic: does build output indicate the MAUI workload is missing? */
export const looksLikeMissingWorkload = (output: string): boolean =>
  [
    /NETSDK1147/i,
    /workloads?\s+must\s+be\s+installed/i,
    /maui-maccatalyst/i,
    /maui-windows/i,
    /to\s+install\s+the\s+.*workload/i,
  ].some((re) => re.test(output));

/**
 * Heuristic: does build output indicate full Xcode is missing? Mac Catalyst
 * builds need Xcode.app, not just the Command Line Tools, and fail with these
 * messages from Xamarin.Shared.targets when `xcode-select -p` points at CLT.
 */
export const looksLikeMissingXcode = (output: string): boolean =>
  [
    /valid\s+Xcode\s+installation\s+was\s+not\s+found/i,
    /could\s+not\s+find\s+a\s+valid\s+Xcode\s+app\s+bundle/i,
    /macios-missing-xcode/i,
  ].some((re) => re.test(output));

// --- Environment probes ------------------------------------------------------

const checkDotnetSdk = (): Requirement => {
  const res = run(DOTNET, ["--list-sdks"]);
  if (!res.found) {
    return {
      name: ".NET SDK",
      status: "missing",
      detail: "`dotnet` was not found on your PATH",
      fix: "Install the .NET 10 SDK — https://dotnet.microsoft.com/download",
    };
  }
  if (!res.ok && !res.stdout) {
    return {
      name: ".NET SDK",
      status: "unknown",
      detail: "could not run `dotnet --list-sdks`",
    };
  }
  if (hasNet10Sdk(res.stdout)) {
    const newest = newestNet10Sdk(res.stdout);
    return {
      name: ".NET SDK",
      status: "ok",
      detail: newest ? `found ${newest}` : "found 10.x",
    };
  }
  return {
    name: ".NET SDK",
    status: "missing",
    detail: "no 10.x SDK installed",
    fix: "Install the .NET 10 SDK — https://dotnet.microsoft.com/download",
  };
};

const checkMauiWorkload = (dotnetOk: boolean): Requirement => {
  if (!dotnetOk) {
    return {
      name: ".NET MAUI workload",
      status: "unknown",
      detail: "requires the .NET SDK first",
    };
  }
  const res = run(DOTNET, ["workload", "list"]);
  if (!res.found) {
    return {
      name: ".NET MAUI workload",
      status: "unknown",
      detail: "could not query workloads",
    };
  }
  if (outputMentionsMaui(res.stdout)) {
    return { name: ".NET MAUI workload", status: "ok", detail: "installed" };
  }
  return {
    name: ".NET MAUI workload",
    status: "missing",
    detail: "not installed",
    fix: "dotnet workload install maui",
  };
};

const checkXcode = (): Requirement => {
  const res = run("xcode-select", ["-p"]);
  if (!res.found || !res.ok) {
    return {
      name: "Xcode",
      status: "missing",
      detail: "not found",
      fix: "Install Xcode from the App Store",
    };
  }
  const devDir = res.stdout.trim();
  if (/CommandLineTools/i.test(devDir)) {
    return {
      name: "Xcode",
      status: "missing",
      detail: "only Command Line Tools detected (Mac Catalyst needs full Xcode)",
      fix: "Install Xcode, then: sudo xcode-select -s /Applications/Xcode.app",
    };
  }
  return { name: "Xcode", status: "ok", detail: devDir };
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
  const reqs: Requirement[] = [dotnet, checkMauiWorkload(dotnet.status === "ok")];
  if (opts.includeXcode ?? process.platform === "darwin") {
    reqs.push(checkXcode());
  }
  return reqs;
};

export const printRequirements = (reqs: Requirement[]): void => {
  for (const r of reqs) {
    const icon =
      r.status === "ok"
        ? chalk.green("\u2713")
        : r.status === "missing"
          ? chalk.red("\u2717")
          : chalk.yellow("?");
    const detail = r.detail ? ` ${chalk.dim(`(${r.detail})`)}` : "";
    console.log(`  ${icon} ${r.name}${detail}`);
    if (r.status === "missing" && r.fix) {
      console.log(`      ${chalk.dim("fix:")} ${chalk.cyan(r.fix)}`);
    }
  }
};

/** Implements the `vidra doctor` command. Returns a process exit code. */
export const runDoctor = async (): Promise<number> => {
  console.log();
  console.log(`  ${chalk.bold.cyan("vidra doctor")}`);
  console.log();

  const reqs = collectRequirements();
  printRequirements(reqs);
  console.log();

  const missing = reqs.filter((r) => r.status === "missing");
  if (missing.length === 0) {
    console.log(
      `  ${chalk.green("All checks passed.")} You're ready to run ${chalk.cyan(
        "vidra dev",
      )}.`,
    );
    console.log();
    return 0;
  }

  console.log(
    `  ${chalk.yellow(
      `${missing.length} issue(s) found.`,
    )} Apply the fixes above, then re-run ${chalk.cyan("vidra doctor")}.`,
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
  console.log(`  ${chalk.dim(`Running: ${DOTNET} ${args.join(" ")}`)}`);
  console.log(
    `  ${chalk.dim(
      "This can download several hundred MB and take a few minutes.",
    )}`,
  );
  console.log();

  try {
    execFileSync(DOTNET, args, { stdio: "inherit" });
    return true;
  } catch {
    console.error();
    console.error(`  ${chalk.red("Workload install failed.")}`);
    console.error(
      `  ${chalk.dim(
        "If this is a permissions error, your SDK is in a system location and needs elevation:",
      )}`,
    );
    console.error(`      ${chalk.cyan("sudo dotnet workload install maui")}`);
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
    console.log(`  ${chalk.yellow("!")} ${dotnet.name} \u2014 ${dotnet.detail}`);
    if (dotnet.fix) {
      console.log(`      ${chalk.dim("fix:")} ${chalk.cyan(dotnet.fix)}`);
    }
    return false;
  }
  // SDK present but unverifiable — let the real build surface any error.
  if (dotnet.status === "unknown") return true;

  if (isMauiWorkloadInstalled()) return true;

  console.log();
  console.log(
    `  ${chalk.yellow("!")} The .NET MAUI workload is required but not installed.`,
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
        console.log(`  ${chalk.green("\u2713")} MAUI workload installed.`);
        return true;
      }
      return false;
    }
  }

  console.log(
    `      ${chalk.dim("run:")} ${chalk.cyan("dotnet workload install maui")}`,
  );
  console.log(`      ${chalk.dim("docs:")} ${chalk.cyan(MAUI_DOCS)}`);
  return false;
};

/** Prints an actionable hint when a build error looks workload-related. */
export const printWorkloadHint = (): void => {
  console.error();
  console.error(
    `  ${chalk.yellow("This looks like a missing .NET MAUI workload.")}`,
  );
  console.error(
    `      ${chalk.dim("fix: ")} ${chalk.cyan("dotnet workload install maui")}`,
  );
  console.error(
    `      ${chalk.dim("check:")} ${chalk.cyan("vidra doctor")}`,
  );
  console.error();
};

/** Prints an actionable hint when a build error looks like missing full Xcode. */
export const printXcodeHint = (): void => {
  console.error();
  console.error(
    `  ${chalk.yellow(
      "Mac Catalyst builds need the full Xcode app, not just the Command Line Tools.",
    )}`,
  );
  console.error(`      ${chalk.dim("1.")} Install Xcode from the App Store`);
  console.error(
    `      ${chalk.dim("2.")} ${chalk.cyan(
      "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
    )}`,
  );
  console.error(
    `      ${chalk.dim("3.")} ${chalk.cyan("sudo xcodebuild -runFirstLaunch")}`,
  );
  console.error(`      ${chalk.dim("check:")} ${chalk.cyan("vidra doctor")}`);
  console.error();
};
