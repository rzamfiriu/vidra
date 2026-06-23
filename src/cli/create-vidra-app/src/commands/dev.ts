import path from "node:path";
import fs from "fs-extra";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import {
  detectPlatform,
  detectProject,
  type ProjectInfo,
} from "../project.js";
import { parseArgs } from "../utils.js";
import { formatBuildError } from "../exec.js";
import { signMacAppBundleIfPossible } from "../signing.js";
import {
  ensureMauiWorkload,
  looksLikeMissingWorkload,
  looksLikeMissingXcode,
  printWorkloadHint,
  printXcodeHint,
} from "../doctor.js";
import {
  dim,
  footer,
  header,
  kv,
  lime,
  row,
  streamPrefix,
  taggedRow,
  value,
  type TagName,
} from "../theme.js";

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
const DOTNET_COMMAND = process.platform === "win32" ? "dotnet.exe" : "dotnet";

const TARGETS = {
  macos: {
    name: "macos",
    framework: "net10.0-maccatalyst",
  },
  windows: {
    name: "windows",
    framework: "net10.0-windows10.0.19041.0",
  },
} as const;

type DevTargetName = keyof typeof TARGETS;
type DevTarget = (typeof TARGETS)[DevTargetName];

export const devCommand = (argv: string[]): Promise<void> =>
  startSession(argv, { vite: true });

// `vidra run` builds and launches only the native host, without the Vite dev
// server (use it when you're serving the UI separately). It launches the host
// the same robust way `dev` does — build, then spawn the produced binary
// directly — instead of MSBuild's `-t:Run` target, which on macOS shells out to
// `open -a` and fails on locally signed apps, and on Windows execs an
// unpackaged app whose native deps aren't laid out yet; both surface only as a
// bare `MSB3073 ... exited with code N`.
export const runCommand = (argv: string[]): Promise<void> =>
  startSession(argv, { vite: false });

const startSession = async (
  argv: string[],
  opts: { vite: boolean },
): Promise<void> => {
  const args = parseArgs(["_", "_", ...argv]);
  const targetName = (args["target"] as string) || detectPlatform();
  const verbose = !!args["verbose"];
  const viteUrl = process.env.VIDRA_DEV_URL || "http://localhost:5173";
  const target = TARGETS[targetName as DevTargetName];

  if (!target) {
    const supported = Object.keys(TARGETS).join(", ");
    console.error(
      row({
        glyph: "error",
        detail: dim(`unsupported target: ${targetName} — supported: ${supported}`),
      }),
    );
    process.exit(1);
  }

  ensureTargetMatchesHostOs(target.name);

  const project = detectProject(process.cwd());

  // Fail fast (before starting Vite) if the MAUI workload the host build needs
  // isn't installed; offers to install it when the session is interactive.
  if (!(await ensureMauiWorkload({ csprojPath: project.csprojPath }))) {
    process.exit(1);
  }

  const session = new DevSession(project, target, viteUrl, verbose, opts);
  await session.run();
};

class DevSession {
  private readonly children: ChildProcess[] = [];
  private readonly buildConfig = process.env.VIDRA_BUILD_CONFIG || "Debug";
  private readonly vite: boolean;
  private shuttingDown = false;

  constructor(
    private readonly project: ProjectInfo,
    private readonly target: DevTarget,
    private readonly viteUrl: string,
    private readonly verbose: boolean,
    options: { vite?: boolean } = {},
  ) {
    this.vite = options.vite ?? true;
  }

  async run(): Promise<void> {
    this.installSignalHandlers();

    console.log();
    console.log(header(this.vite ? "dev" : "run", this.target.name));
    console.log(kv("project", this.project.projectName));
    console.log(kv("target", this.target.framework));
    console.log();

    let vite: ChildProcess | undefined;
    if (this.vite) {
      vite = this.startVite();

      try {
        await waitForServer(this.viteUrl, POLL_TIMEOUT_MS);
      } catch (error) {
        console.error(row({ glyph: "error", detail: dim((error as Error).message) }));
        this.shutdown(1);
      }

      console.log(
        taggedRow("active", "ui", `${dim("vite ready \u2014")} ${value(this.viteUrl)}`),
      );
    } else {
      console.log(
        taggedRow(
          "skip",
          "ui",
          `${dim("vite not started \u2014")} ${value("npm run dev:ui")}`,
        ),
      );
    }

    const host =
      this.target.name === "macos"
        ? this.launchMacosHost()
        : this.launchWindowsHost();

    if (this.vite) {
      console.log(
        taggedRow(
          "active",
          null,
          `${lime("hot reload active")} ${dim("\u2014 edit ui/src and save")}`,
        ),
      );
      console.log();
      console.log(
        footer(
          `${dim("watching")} ${value("ui/")} ${dim(
            "\u00b7 hot reload on save \u00b7 ctrl-c to stop",
          )}`,
        ),
      );
    } else {
      console.log();
      console.log(
        footer(dim("host only \u00b7 serve the UI separately \u00b7 ctrl-c to stop")),
      );
    }
    console.log();

    await waitForExit(...(vite ? [vite, host] : [host]));
  }

  private installSignalHandlers(): void {
    process.on("SIGINT", () => {
      console.log("\n" + footer(dim("shutting down\u2026")));
      this.shutdown(0);
    });
    process.on("SIGTERM", () => {
      this.shutdown(0);
    });
  }

  private startVite(): ChildProcess {
    console.log(taggedRow("active", "ui", dim("starting dev server\u2026")));
    // `npm` on Windows is a `.cmd` shim, and since the fix for CVE-2024-27980
    // Node refuses to `spawn` `.cmd`/`.bat` files directly (it throws
    // `spawn EINVAL`) unless they're run through a shell. `taskkill /T` in
    // killChild already tears down the wrapping cmd.exe and its children.
    const vite = spawn(NPM_COMMAND, ["run", "dev"], {
      cwd: this.project.uiDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    return this.registerChild(vite, "ui", "Vite dev server");
  }

  // Builds the MAUI host as a discrete step (a plain `dotnet build`, never
  // MSBuild's `-t:Run`) so the per-OS launch paths can spawn the produced
  // binary directly. `-t:Run` shells out in ways that break for both locally
  // signed mac apps and unpackaged Windows apps (see the call sites).
  private buildHostSync(): void {
    console.log(
      taggedRow(
        "active",
        "host",
        `${dim("building")} ${value(this.target.framework)} ${dim("\u2026")}`,
      ),
    );

    try {
      execFileSync(
        DOTNET_COMMAND,
        [
          "build",
          "-c",
          this.buildConfig,
          "-f",
          this.target.framework,
          this.project.csprojPath,
        ],
        {
          cwd: this.project.root,
          stdio: this.verbose ? "inherit" : "pipe",
        },
      );
    } catch (error) {
      const output = formatBuildError(error);
      console.error(taggedRow("error", "host", dim("MAUI build failed")));
      console.error(dim(output));
      if (looksLikeMissingWorkload(output)) printWorkloadHint();
      else if (looksLikeMissingXcode(output)) printXcodeHint();
      if (!this.verbose) {
        console.error(footer(dim("re-run with --verbose for the full build log.")));
      }
      process.exit(1);
    }
  }

  private launchMacosHost(): ChildProcess {
    this.buildHostSync();

    const appBundle = findMacAppBundle(
      this.project.hostDir,
      this.target.framework,
      this.buildConfig,
    );
    if (!appBundle) {
      console.error(
        row({
          glyph: "error",
          detail: dim(
            `could not find .app bundle in ${path.join(this.project.hostDir, "bin", this.buildConfig, this.target.framework)}`,
          ),
        }),
      );
      process.exit(1);
    }

    signMacAppBundleIfPossible(appBundle, {
      verbose: this.verbose,
      log: console.log,
      warn: console.warn,
    });

    const binary = findMacExecutable(appBundle);
    if (!binary) {
      console.error(
        row({
          glyph: "error",
          detail: dim(`could not find the app executable in ${appBundle}`),
        }),
      );
      process.exit(1);
    }

    console.log(
      taggedRow("done", "host", `${dim("launched")} ${value(path.basename(appBundle))}`),
    );
    const host = spawn(binary, [], {
      cwd: this.project.root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VIDRA_DEV_URL: this.viteUrl },
    });
    return this.registerChild(host, "host", path.basename(binary));
  }

  // Build first, then spawn the produced .exe directly. A single
  // `dotnet build -t:Run` on an unpackaged MAUI Windows app
  // (`WindowsPackageType=None`) execs the binary before the WindowsAppSDK
  // native assets are laid out beside it, so the app can't resolve its deps and
  // dies with a bare `MSB3073 ... exited with code 3` (ERROR_PATH_NOT_FOUND —
  // "The system cannot find the path specified"). Building as a discrete step
  // and then launching the binary is the documented workaround.
  // See dotnet/maui#13942 and dotnet/maui#5975.
  private launchWindowsHost(): ChildProcess {
    this.buildHostSync();

    const exe = findWindowsExecutable(
      this.project.hostDir,
      this.project.csprojPath,
      this.target.framework,
      this.buildConfig,
    );
    if (!exe) {
      console.error(
        row({
          glyph: "error",
          detail: dim(
            `could not find the host .exe under ${path.join(this.project.hostDir, "bin", this.buildConfig, this.target.framework)}`,
          ),
        }),
      );
      process.exit(1);
    }

    console.log(
      taggedRow("done", "host", `${dim("launched")} ${value(path.basename(exe))}`),
    );
    const host = spawn(exe, [], {
      cwd: path.dirname(exe),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VIDRA_DEV_URL: this.viteUrl },
    });
    return this.registerChild(host, "host", path.basename(exe));
  }

  private registerChild(
    child: ChildProcess,
    tag: TagName,
    label: string,
  ): ChildProcess {
    this.children.push(child);
    prefixStream(child.stdout, tag);
    prefixStream(child.stderr, tag);

    child.on("exit", (code, signal) => {
      if (this.shuttingDown) return;

      if (tag === "ui") {
        const exitCode = code ?? 1;
        console.error(
          "\n" + row({ glyph: "error", detail: dim(`${label} exited with code ${exitCode}`) }),
        );
        this.shutdown(exitCode);
        return;
      }

      const failed = (code !== null && code !== 0) || signal !== null;
      if (failed) {
        console.error(
          "\n" +
            row({
              glyph: "error",
              detail: dim(
                `${label} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
              ),
            }),
        );
        if (tag === "host" && this.target.name === "macos") {
          printMacLaunchHint();
        }
      }
      this.shutdown(code ?? (signal ? 1 : 0));
    });

    child.on("error", (error) => {
      if (this.shuttingDown) return;
      console.error(
        "\n" + row({ glyph: "error", detail: dim(`failed to start ${label}: ${error.message}`) }),
      );
      if (tag === "host" && this.target.name === "macos") {
        printMacLaunchHint();
      }
      this.shutdown(1);
    });

    return child;
  }

  private shutdown(exitCode: number): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    for (const child of this.children) {
      killChild(child);
    }

    process.exit(exitCode);
  }
}

const ensureTargetMatchesHostOs = (targetName: DevTargetName): void => {
  if (targetName === "macos" && process.platform !== "darwin") {
    console.error(
      row({ glyph: "error", detail: dim("the macOS target can only run on macOS") }),
    );
    process.exit(1);
  }

  if (targetName === "windows" && process.platform !== "win32") {
    console.error(
      row({ glyph: "error", detail: dim("the Windows target can only run on Windows") }),
    );
    process.exit(1);
  }
};

const prefixStream = (
  stream: NodeJS.ReadableStream | null,
  tag: TagName,
): void => {
  if (!stream) return;

  const prefix = streamPrefix(tag);
  stream.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.length > 0) {
        process.stdout.write(`${prefix} ${line}\n`);
      }
    }
  });
};

const waitForServer = (url: string, timeoutMs: number): Promise<void> => {
  const { hostname, port, pathname } = new URL(url);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`),
        );
        return;
      }

      const req = request(
        {
          hostname,
          port,
          path: pathname,
          method: "HEAD",
          timeout: 1000,
        },
        () => resolve(),
      );
      req.on("error", () => setTimeout(poll, POLL_INTERVAL_MS));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(poll, POLL_INTERVAL_MS);
      });
      req.end();
    };

    poll();
  });
};

const waitForExit = (...children: ChildProcess[]): Promise<void> => {
  return new Promise((resolve) => {
    const resolveOnce = (): void => resolve();
    for (const child of children) {
      child.once("exit", resolveOnce);
    }
  });
};

const findMacAppBundle = (
  hostDir: string,
  framework: string,
  buildConfig: string,
): string | null => {
  const outputDir = path.join(hostDir, "bin", buildConfig, framework);
  return findAppBundleRecursive(outputDir);
};

const findAppBundleRecursive = (dir: string): string | null => {
  if (!fs.existsSync(dir)) return null;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const nested = findAppBundleRecursive(fullPath);
      if (nested) return nested;
    }
  }

  return null;
};

const findMacExecutable = (appBundle: string): string | null => {
  const macOsDir = path.join(appBundle, "Contents", "MacOS");
  if (!fs.existsSync(macOsDir)) return null;

  for (const entry of fs.readdirSync(macOsDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      return path.join(macOsDir, entry.name);
    }
  }

  return null;
};

const findWindowsExecutable = (
  hostDir: string,
  csprojPath: string,
  framework: string,
  buildConfig: string,
): string | null => {
  const outputDir = path.join(hostDir, "bin", buildConfig, framework);
  if (!fs.existsSync(outputDir)) return null;

  // The build emits `<AssemblyName>.exe` — the csproj base name, e.g.
  // `MyApp.Host.exe` — inside a RID subfolder whose name varies by SDK
  // (`win-x64`, `win10-x64`, `win-arm64`, …). Search recursively, preferring an
  // exact name match before falling back to any host/`.exe`.
  const exeName = `${path.basename(csprojPath, ".csproj")}.exe`.toLowerCase();
  return (
    findFileRecursive(outputDir, (name) => name.toLowerCase() === exeName) ??
    findFileRecursive(outputDir, (name) =>
      name.toLowerCase().endsWith(".host.exe"),
    ) ??
    findFileRecursive(outputDir, (name) => name.toLowerCase().endsWith(".exe"))
  );
};

const findFileRecursive = (
  dir: string,
  match: (name: string) => boolean,
): string | null => {
  if (!fs.existsSync(dir)) return null;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && match(entry.name)) {
      return path.join(dir, entry.name);
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findFileRecursive(path.join(dir, entry.name), match);
      if (found) return found;
    }
  }

  return null;
};

const killChild = (child: ChildProcess): void => {
  if (!child.pid || child.exitCode !== null) return;

  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      child.kill();
    }
    return;
  }

  child.kill("SIGTERM");
};

const printMacLaunchHint = (): void => {
  console.error();
  console.error(
    row({ glyph: "manual", label: "the host built but the app couldn't launch." }),
  );
  console.error(
    footer(
      dim(
        "on macOS this is usually code signing / Gatekeeper for a locally built app:",
      ),
    ),
  );
  console.error(
    `      ${dim("\u2022")} ${dim("install full Xcode, then run")} ${lime("vidra doctor")} ${dim("to verify")}`,
  );
  console.error(
    `      ${dim("\u2022")} ${dim("approve it once in Finder: right-click the")} ${value(".app")} ${dim("and choose")} ${value("Open")}`,
  );
  console.error(
    `      ${dim("\u2022")} ${dim("or provide a signing identity via")} ${value("VIDRA_MACOS_CODESIGN_KEY")}`,
  );
  console.error();
};
