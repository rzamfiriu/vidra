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
import { selectDevServerUrl } from "../dev-port.js";
import {
  ensureMauiWorkload,
  looksLikeMissingWorkload,
  looksLikeMissingXcode,
  looksLikeXcodeTooOld,
  macCatalystHotReloadBlocker,
  printWorkloadHint,
  printXcodeHint,
  printXcodeTooOldHint,
} from "../doctor.js";
import {
  dim,
  fixLine,
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

// How much recent `dotnet watch` output to keep for diagnosing an early exit
// (workload / Xcode hints) when deciding to fall back to a classic launch.
const WATCH_OUTPUT_TAIL_CHARS = 8192;

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
  startSession(argv, { vite: true, hotReloadDefault: true });

// `vidra run` builds and launches only the native host, without the Vite dev
// server (use it when you're serving the UI separately). It launches the host
// the same robust way `dev` falls back to — build, then spawn the produced
// binary directly — instead of MSBuild's `-t:Run` target, which on macOS shells
// out to `open -a` and fails on locally signed apps, and on Windows execs an
// unpackaged app whose native deps aren't laid out yet; both surface only as a
// bare `MSB3073 ... exited with code N`.
export const runCommand = (argv: string[]): Promise<void> =>
  startSession(argv, { vite: false, hotReloadDefault: false });

const startSession = async (
  argv: string[],
  opts: { vite: boolean; hotReloadDefault: boolean },
): Promise<void> => {
  const args = parseArgs(["_", "_", ...argv]);
  const targetName = (args["target"] as string) || detectPlatform();
  const verbose = !!args["verbose"];
  let hotReload = opts.hotReloadDefault && !args["no-hot-reload"];
  let viteUrl = process.env.VIDRA_DEV_URL || "http://localhost:5173";
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

  // Some toolchains can't hot reload Mac Catalyst apps and fail in ways the
  // session can't detect (silent no-op deltas on old workload sets, an app
  // that crashes on launch under the 10.0.2xx watcher). Probe up-front and
  // use the classic launch instead of lying about hot reload being active.
  if (hotReload && target.name === "macos") {
    const blocker = macCatalystHotReloadBlocker();
    if (blocker) {
      hotReload = false;
      console.log();
      console.log(
        row({
          glyph: "manual",
          detail: `${dim(blocker.reason + "; using a classic launch")}`,
        }),
      );
      console.log(fixLine(blocker.fix));
    }
  }

  if (opts.vite) {
    viteUrl = await selectDevServerUrl(viteUrl);
  }

  const session = new DevSession(project, target, viteUrl, verbose, {
    vite: opts.vite,
    hotReload,
  });
  await session.run();
};

// --- dotnet watch helpers (exported for unit tests) ---------------------------

export interface DotnetWatchArgsOptions {
  csprojPath: string;
  framework: string;
  buildConfig: string;
  verbose: boolean;
  targetName: DevTargetName;
}

/**
 * Arguments for launching the host under `dotnet watch`, which builds, runs,
 * and hot reloads the app itself (it must own the launch so it can inject the
 * hot reload agent via DOTNET_STARTUP_HOOKS).
 */
export const buildDotnetWatchArgs = (
  opts: DotnetWatchArgsOptions,
): string[] => [
  "watch",
  "--project",
  opts.csprojPath,
  // Never prompt on rude edits (our stdio is piped, so a prompt would hang);
  // paired with DOTNET_WATCH_RESTART_ON_RUDE_EDIT for older SDKs.
  "--non-interactive",
  ...(opts.verbose ? ["--verbose"] : []),
  "run",
  "-f",
  opts.framework,
  "-c",
  opts.buildConfig,
  // Launch the Mac Catalyst app by exec'ing the binary rather than `open -a`,
  // so the environment (VIDRA_DEV_URL, DOTNET_STARTUP_HOOKS) propagates and
  // stdout streams back. Ignored by targets that don't define the property.
  ...(opts.targetName === "macos" ? ["--property:RunWithOpen=false"] : []),
];

/** Extra environment for the `dotnet watch` process (inherited by the app). */
export const dotnetWatchEnv = (devUrl: string): Record<string, string> => ({
  VIDRA_DEV_URL: devUrl,
  DOTNET_WATCH_RESTART_ON_RUDE_EDIT: "1",
  DOTNET_WATCH_SUPPRESS_EMOJIS: "1",
  DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: "1",
});

export const buildViteArgs = (devUrl: string): string[] => [
  "run",
  "dev",
  "--",
  "--port",
  new URL(devUrl).port,
  "--strictPort",
];

export type WatchLineEvent = "appStarted" | "appWaiting" | "buildBlocked" | null;

/**
 * Classifies a `dotnet watch` output line into lifecycle events we act on:
 *
 * - `appStarted` — the app launched. Seen at least once means watch mode
 *   works; a watch exit before it means watch isn't supported here and we
 *   should fall back to a classic launch. The primary signal is the
 *   `[vidra] host ready` sentinel VidraPage prints in dev sessions, because
 *   `dotnet watch` itself has no version-stable "started" message (the .NET
 *   10.0.2xx watcher prints none at all); the watch-message match covers
 *   SDKs that do print one. Deliberately NOT matched on "Hot reload
 *   enabled", which prints before the first build and would misclassify
 *   run-target failures as post-launch exits.
 * - `appWaiting` — the app is gone (closed, crashed, or a rebuild failed) and
 *   watch is idle until the next file change. Matched on the full "waiting
 *   for a file to change before restarting" phrase only: the shorter
 *   "Waiting for changes" that .NET 10.0.3xx watchers print is ambiguous —
 *   it also appears right after a successful launch while the app runs.
 * - `buildBlocked` — a build failed and watch is idle until the error is
 *   fixed. Before the first launch this can mean an environment problem
 *   (wrong Xcode, missing workload) rather than a code error, so the session
 *   prints targeted hints.
 */
export const HOST_READY_SENTINEL = "[vidra] host ready";

export const classifyWatchLine = (line: string): WatchLineEvent => {
  if (/waiting for a file to change/i.test(line)) return "appWaiting";
  if (/fix the error to continue/i.test(line)) return "buildBlocked";
  if (line.includes(HOST_READY_SENTINEL)) return "appStarted";
  if (/\bwatch\b/i.test(line) && /\b(?:started|launched)\b/i.test(line)) {
    return "appStarted";
  }
  return null;
};

interface SessionOptions {
  vite: boolean;
  hotReload: boolean;
}

class DevSession {
  private readonly children: ChildProcess[] = [];
  private readonly buildConfig = process.env.VIDRA_BUILD_CONFIG || "Debug";
  private readonly vite: boolean;
  private readonly hotReload: boolean;
  private shuttingDown = false;

  // Watch-mode state: `watchChild` is the `dotnet watch` process (a process
  // group leader on unix, so shutdown can signal it and the app it launched
  // together); `watchReady` flips once the app has started at least once.
  private watchChild: ChildProcess | undefined;
  private watchReady = false;
  private watchOutputTail = "";

  private endSession: () => void = () => {};
  private readonly sessionDone = new Promise<void>((resolve) => {
    this.endSession = resolve;
  });

  constructor(
    private readonly project: ProjectInfo,
    private readonly target: DevTarget,
    private readonly viteUrl: string,
    private readonly verbose: boolean,
    options: SessionOptions,
  ) {
    this.vite = options.vite;
    this.hotReload = options.hotReload;
  }

  async run(): Promise<void> {
    this.installSignalHandlers();

    console.log();
    console.log(header(this.vite ? "dev" : "run", this.target.name));
    console.log(kv("project", this.project.projectName));
    console.log(kv("target", this.target.framework));
    console.log();

    if (this.vite) {
      this.startVite();

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

    this.launchHost();

    const hostDirLabel = `src/${path.basename(this.project.hostDir)}`;

    if (this.vite) {
      console.log(
        taggedRow(
          "active",
          null,
          this.hotReload
            ? `${lime("hot reload active")} ${dim(`\u2014 edit ui/src or ${hostDirLabel} and save`)}`
            : `${lime("hot reload active")} ${dim("\u2014 edit ui/src and save")}`,
        ),
      );
      console.log();
      console.log(
        footer(
          this.hotReload
            ? `${dim("watching")} ${value("ui/")} ${dim("\u00b7")} ${value(`${hostDirLabel}/`)} ${dim(
                "\u00b7 hot reload on save \u00b7 ctrl-c to stop",
              )}`
            : `${dim("watching")} ${value("ui/")} ${dim(
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

    // Every exit path funnels through shutdown(), which resolves this promise
    // (and exits the process). Keeping run() pending until then means callers
    // never observe a "finished" session with children still running.
    await this.sessionDone;
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
    const vite = spawn(NPM_COMMAND, buildViteArgs(this.viteUrl), {
      cwd: this.project.uiDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    return this.registerChild(vite, "ui", "Vite dev server");
  }

  private launchHost(): ChildProcess {
    if (this.hotReload) {
      return this.launchHostWithWatch();
    }
    return this.target.name === "macos"
      ? this.launchMacosHost()
      : this.launchWindowsHost();
  }

  // --- dotnet watch launch (C# hot reload) -----------------------------------

  private launchHostWithWatch(): ChildProcess {
    console.log(
      taggedRow(
        "active",
        "host",
        `${dim("dotnet watch \u2014 building")} ${value(this.target.framework)} ${dim("\u2026")}`,
      ),
    );

    const watch = spawn(
      DOTNET_COMMAND,
      buildDotnetWatchArgs({
        csprojPath: this.project.csprojPath,
        framework: this.target.framework,
        buildConfig: this.buildConfig,
        verbose: this.verbose,
        targetName: this.target.name,
      }),
      {
        cwd: this.project.root,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...dotnetWatchEnv(this.viteUrl) },
        // Unix: make dotnet watch its own process-group leader so shutdown can
        // SIGTERM the group — taking down both watch and the app it launched.
        // Windows cleanup goes through `taskkill /T` instead.
        detached: process.platform !== "win32",
      },
    );

    this.watchChild = watch;
    this.children.push(watch);
    // The readiness sentinel is translated into a friendlier status line by
    // onWatchLine, so keep the raw marker out of the passthrough output.
    const notSentinel = (line: string): boolean =>
      !line.includes(HOST_READY_SENTINEL);
    prefixStream(watch.stdout, "host", notSentinel);
    prefixStream(watch.stderr, "host", notSentinel);
    scanStream(watch.stdout, (line) => this.onWatchLine(line));
    scanStream(watch.stderr, (line) => this.onWatchLine(line));

    watch.on("exit", (code, signal) => {
      if (this.shuttingDown) return;

      if (this.watchReady) {
        // The app ran at least once; treat like a normal host exit.
        const failed = (code !== null && code !== 0) || signal !== null;
        if (failed) {
          console.error(
            "\n" +
              row({
                glyph: "error",
                detail: dim(
                  `dotnet watch exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
                ),
              }),
          );
        }
        this.shutdown(code ?? (signal ? 1 : 0));
        return;
      }

      this.fallBackToClassicLaunch(code, signal);
    });

    watch.on("error", (error) => {
      if (this.shuttingDown) return;
      // Spawning dotnet itself failed (e.g. not on PATH) — the classic path
      // needs the same binary, so there is nothing to fall back to.
      console.error(
        "\n" +
          row({
            glyph: "error",
            detail: dim(`failed to start dotnet watch: ${error.message}`),
          }),
      );
      this.shutdown(1);
    });

    return watch;
  }

  private onWatchLine(line: string): void {
    this.watchOutputTail = (this.watchOutputTail + line + "\n").slice(
      -WATCH_OUTPUT_TAIL_CHARS,
    );

    const event = classifyWatchLine(line);
    if (event === "appStarted" && !this.watchReady) {
      this.watchReady = true;
      console.log(
        taggedRow(
          "done",
          "host",
          `${dim("launched")} ${value(this.project.projectName)} ${dim("\u2014 C# hot reload active")}`,
        ),
      );
      return;
    }

    // Both remaining events mean dotnet watch has gone idle without a running
    // app; it stays alive and retries on the next save. Which message the
    // watcher prints varies by SDK: after a failed build, .NET 10.0.2xx says
    // "Waiting for a file to change" (same as after an app exit) while
    // 10.0.3xx says "Fix the error to continue" — so both must take the
    // environment-hint path below, keyed on whether the app ever launched.
    if ((event !== "appWaiting" && event !== "buildBlocked") || this.shuttingDown) {
      return;
    }

    if (this.watchReady) {
      console.log(
        taggedRow(
          "manual",
          "host",
          dim("app not running \u2014 save a C# file to relaunch, or ctrl-c to stop"),
        ),
      );
      return;
    }

    // Idle before readiness was ever confirmed. Usually the initial build
    // failed — often an environment problem with a well-known fix, so surface
    // the targeted hint. But the app may also have launched and exited before
    // printing the readiness sentinel (e.g. an immediate crash), which is not
    // a build failure; don't claim one unless the output shows it.
    if (!/Build FAILED/i.test(this.watchOutputTail)) {
      console.log(
        taggedRow(
          "manual",
          "host",
          dim(
            "app exited before it was ready \u2014 save a C# file to relaunch, or ctrl-c to stop",
          ),
        ),
      );
      return;
    }

    if (looksLikeMissingWorkload(this.watchOutputTail)) printWorkloadHint();
    else if (looksLikeXcodeTooOld(this.watchOutputTail)) printXcodeTooOldHint();
    else if (looksLikeMissingXcode(this.watchOutputTail)) printXcodeHint();

    console.log(
      taggedRow(
        "manual",
        "host",
        dim("build failed \u2014 fix the error and save to retry, or ctrl-c to stop"),
      ),
    );
  }

  /**
   * `dotnet watch` exited before the app ever started — typically an SDK or
   * MAUI workload set that predates `dotnet run`/`dotnet watch` support for
   * this target. Explain why, then launch the host the classic way (one
   * build + direct spawn) so the dev session still works, minus C# hot reload.
   */
  private fallBackToClassicLaunch(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    console.log();
    console.log(
      taggedRow(
        "manual",
        "host",
        `${dim("C# hot reload unavailable \u2014 dotnet watch exited with")} ${value(
          signal ? `signal ${signal}` : `code ${code ?? "unknown"}`,
        )}`,
      ),
    );

    if (looksLikeMissingWorkload(this.watchOutputTail)) {
      printWorkloadHint();
    } else if (looksLikeXcodeTooOld(this.watchOutputTail)) {
      printXcodeTooOldHint();
    } else if (looksLikeMissingXcode(this.watchOutputTail)) {
      printXcodeHint();
    } else {
      console.log(
        footer(
          dim(
            "C# hot reload needs the .NET 10.0.203+ workload set (Mac Catalyst dotnet-watch support) \u2014 try:",
          ),
        ),
      );
      console.log(fixLine("dotnet workload update"));
      if (!this.verbose) {
        console.log(footer(dim("re-run with --verbose for the full watch log.")));
      }
    }

    console.log(
      taggedRow(
        "active",
        "host",
        dim("falling back to a classic launch (frontend hot reload still active)\u2026"),
      ),
    );
    console.log();

    if (this.target.name === "macos") {
      this.launchMacosHost();
    } else {
      this.launchWindowsHost();
    }
  }

  // --- classic launch (one build + direct spawn) ------------------------------

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
    // Host processes emit the readiness sentinel in dev sessions; it's CLI
    // plumbing (see classifyWatchLine), not output the user should see.
    const include =
      tag === "host"
        ? (line: string): boolean => !line.includes(HOST_READY_SENTINEL)
        : undefined;
    prefixStream(child.stdout, tag, include);
    prefixStream(child.stderr, tag, include);

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
      killChild(child, { processGroup: child === this.watchChild });
    }

    this.endSession();
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
  include: (line: string) => boolean = () => true,
): void => {
  if (!stream) return;

  const prefix = streamPrefix(tag);
  stream.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.length > 0 && include(line)) {
        process.stdout.write(`${prefix} ${line}\n`);
      }
    }
  });
};

/** Invokes `onLine` per complete output line, buffering partial chunks. */
const scanStream = (
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void => {
  if (!stream) return;

  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  stream.on("end", () => {
    if (pending) onLine(pending);
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

const killChild = (
  child: ChildProcess,
  opts: { processGroup?: boolean } = {},
): void => {
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

  // A detached child leads its own process group; signal the whole group so
  // its grandchildren (the app `dotnet watch` launched) terminate with it.
  if (opts.processGroup) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Group already gone — fall through to a plain kill.
    }
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
