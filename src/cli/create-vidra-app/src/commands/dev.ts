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

// How long a relaunch waits for the previous app to go away before killing it
// outright. Two instances of the same bundle must never overlap, and a host
// wedged on shutdown must not wedge the dev loop with it.
const HOST_TERMINATION_TIMEOUT_MS = 5_000;

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
  const hotReload = opts.hotReloadDefault && !args["no-hot-reload"];
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

/**
 * How the C#-side dev loop is driven:
 *
 * - `"delta"` — `dotnet watch run`. The watcher owns the launch, because only
 *   then can it inject the hot reload agent (`DOTNET_STARTUP_HOOKS`) and apply
 *   edits to the *running* process. This is the real thing, and every session
 *   starts here.
 * - `"rebuild"` — `dotnet watch build` plus a launch of our own, reusing the
 *   build-then-spawn path behind `vidra run` and `vidra dev --no-hot-reload`.
 *   Not a platform choice: it is where a session *lands* when the delta channel
 *   dies under it (see {@link DELTA_CHANNEL_DEAD_WARNING}).
 *
 * Mac Catalyst needs the fallback because its delta channel is unreliable
 * rather than absent. Measured on `macos-latest`, workload set 10.0.302
 * (Catalyst pack 26.5.10301), four `dotnet watch run` sessions, two SDKs, with
 * and without a wiped `bin`/`obj`:
 *
 * | SDK      | build state       | agent socket after 30s idle | first edit  |
 * |----------|-------------------|-----------------------------|-------------|
 * | 10.0.301 | fresh scaffold    | connected                   | delta lands |
 * | 10.0.301 | wiped + rebuilt   | dropped                     | nothing     |
 * | 10.0.302 | fresh scaffold    | dropped                     | nothing     |
 * | 10.0.302 | wiped + rebuilt   | connected                   | delta lands |
 *
 * So deltas do work on Catalyst today — about half the time. The failure is the
 * agent's WebSocket dropping while the session sits idle, before any edit
 * (dotnet/sdk#55488); it tracks neither the SDK nor the freshness of the build
 * output. When it happens every update fails and `dotnet watch` still prints
 * "changes applied", so a session that silently applies nothing is exactly as
 * quiet as a working one — which is what makes detecting it worth the code.
 *
 * (The other half of this on Catalyst, `dotnet watch run` never launching the
 * app at all, was a stale-manifest bug — dotnet/macios#26318, fixed from
 * Catalyst pack 26.2 onwards. `vidra doctor` reports a toolchain still on the
 * broken packs rather than this code working around it.)
 */
export type WatchStrategy = "delta" | "rebuild";

/**
 * The initial strategy. Always `"delta"`: a session only moves to `"rebuild"`
 * by observing its own delta channel die, never by predicting that it will.
 */
export const watchStrategyFor = (_targetName: DevTargetName): WatchStrategy =>
  "delta";

/**
 * `dotnet watch` gives up on a process with this line, after an update batch
 * fails. It is a `LogWarning` in the SDK, so unlike the transport's own
 * diagnostics it prints at default verbosity — the session never has to run the
 * watcher in `--verbose` to see it. Matching English text is safe because
 * {@link dotnetWatchEnv} pins `DOTNET_CLI_UI_LANGUAGE=en`.
 */
export const DELTA_CHANNEL_DEAD_WARNING =
  "further changes won't be applied to this process";

export interface DotnetWatchArgsOptions {
  csprojPath: string;
  framework: string;
  buildConfig: string;
  verbose: boolean;
  strategy: WatchStrategy;
}

/**
 * Arguments for the `dotnet watch` process. Under `"delta"` the watcher runs
 * the app; under `"rebuild"` it only builds it (see {@link WatchStrategy}).
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
  opts.strategy === "rebuild" ? "build" : "run",
  "-f",
  opts.framework,
  "-c",
  opts.buildConfig,
];

/** Extra environment for the `dotnet watch` process (inherited by the app). */
export const dotnetWatchEnv = (devUrl: string): Record<string, string> => ({
  VIDRA_DEV_URL: devUrl,
  DOTNET_WATCH_RESTART_ON_RUDE_EDIT: "1",
  DOTNET_WATCH_SUPPRESS_EMOJIS: "1",
  DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: "1",
  // The session reads the loop's state out of watch and MSBuild output
  // ("Build succeeded.", "Waiting for a file to change"), so the child must
  // speak the language those patterns are written in. Without this a localized
  // SDK silently breaks the dev loop for everyone whose machine isn't English.
  DOTNET_CLI_UI_LANGUAGE: "en",
});

export const buildViteArgs = (devUrl: string): string[] => [
  "run",
  "dev",
  "--",
  "--port",
  new URL(devUrl).port,
  "--strictPort",
];

export type WatchLineEvent =
  | "appStarted"
  | "appWaiting"
  | "buildBlocked"
  | "buildSucceeded"
  | "buildFailed"
  | "deltaChannelDead"
  | null;

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
 * - `deltaChannelDead` — the hot reload agent is gone and `dotnet watch` has
 *   stopped trying to reach it, so every later edit would be swallowed while
 *   the watcher keeps printing "changes applied". The session reacts by
 *   switching to the rebuild loop (see {@link WatchStrategy}).
 * - `buildSucceeded` / `buildFailed` — MSBuild's own end-of-build summary.
 *   These are the outcome of one watch cycle, and under the `"rebuild"`
 *   strategy they are what drives the loop: a succeeded build is the cue to
 *   (re)launch the app ourselves. MSBuild is the right thing to read here
 *   rather than the watcher, because it reports the outcome as well as the
 *   boundary, and it prints the classic summary whenever stdout is a pipe —
 *   which it always is for us.
 */
export const HOST_READY_SENTINEL = "[vidra] host ready";

export const classifyWatchLine = (line: string): WatchLineEvent => {
  if (line.toLowerCase().includes(DELTA_CHANNEL_DEAD_WARNING)) {
    return "deltaChannelDead";
  }
  if (/waiting for a file to change/i.test(line)) return "appWaiting";
  if (/fix the error to continue/i.test(line)) return "buildBlocked";
  if (line.includes(HOST_READY_SENTINEL)) return "appStarted";
  // "Build succeeded." / "Build FAILED." — anchored to the start of the line
  // (modulo MSBuild's indentation) so a compiler message or app log that
  // merely contains the words can't be mistaken for the summary.
  if (/^\s*build succeeded\b/i.test(line)) return "buildSucceeded";
  if (/^\s*build failed\b/i.test(line)) return "buildFailed";
  if (/\bwatch\b/i.test(line) && /\b(?:started|launched)\b/i.test(line)) {
    return "appStarted";
  }
  return null;
};

/** What the session should do about a classified line. */
export type WatchReaction =
  | "markHostReady"
  | "launchHost"
  | "switchToRebuild"
  | "reportBuildFailed"
  | "reportAppIdle"
  | "reportEarlyExit"
  | "none";

export interface WatchReactionContext {
  strategy: WatchStrategy;
  /** Has the app run at least once this session? */
  hostLaunched: boolean;
  /** MSBuild's verdict for the cycle now ending, if it was seen. */
  buildOutcome: "succeeded" | "failed" | null;
  /** Has any build at all finished this session? */
  everBuilt: boolean;
}

/**
 * The dev loop's state machine, kept pure so it can be tested without a
 * toolchain. The two strategies read the same lines but mean different things
 * by them:
 *
 * - Under `"rebuild"` the watcher never launches anything, so a successful
 *   build *is* the launch signal and the idle line is just the cycle closing.
 * - Under `"delta"` the watcher owns the app, so an idle line means the app is
 *   gone — either it exited (fine, save to relaunch) or it never started, which
 *   is the interesting case: a failed build, or a launch that died before the
 *   host could announce itself.
 */
export const watchReaction = (
  event: WatchLineEvent,
  ctx: WatchReactionContext,
): WatchReaction => {
  if (event === "appStarted") {
    return ctx.hostLaunched ? "none" : "markHostReady";
  }

  // Only meaningful while the watcher owns the app: under "rebuild" nothing is
  // asking it to apply deltas, so a stale warning from the session it replaced
  // must not send us round the loop again.
  if (event === "deltaChannelDead") {
    return ctx.strategy === "delta" ? "switchToRebuild" : "none";
  }

  if (ctx.strategy === "rebuild") {
    if (event === "buildSucceeded") return "launchHost";
    if (event === "buildFailed") return "reportBuildFailed";
    if (event === "appWaiting" || event === "buildBlocked") {
      // The outcome was already reported when MSBuild printed it; the idle line
      // only closes the cycle. A cycle that ends having never built anything is
      // the one worth saying something about — the watcher parked without
      // getting as far as a build. `everBuilt` rather than `buildOutcome`
      // because watch writes the idle line to stderr and MSBuild writes its
      // summary to stdout: within a cycle their arrival order is not
      // guaranteed, and a session that has built before is plainly not stuck.
      return ctx.everBuilt || ctx.buildOutcome !== null
        ? "none"
        : "reportEarlyExit";
    }
    return "none";
  }

  if (event === "appWaiting" || event === "buildBlocked") {
    if (ctx.hostLaunched) return "reportAppIdle";
    return ctx.buildOutcome === "failed" ? "reportBuildFailed" : "reportEarlyExit";
  }
  return "none";
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
  // Not readonly: a session that watches its delta channel die moves itself to
  // the rebuild loop (see WatchStrategy).
  private strategy: WatchStrategy;
  private shuttingDown = false;

  // Watch-mode state: `watchChild` is the `dotnet watch` process (a process
  // group leader on unix, so shutdown can signal it and the app it launched
  // together); `watchReady` flips once the app has started at least once.
  private watchChild: ChildProcess | undefined;
  private watchReady = false;
  private watchOutputTail = "";
  private buildOutcome: "succeeded" | "failed" | null = null;
  private everBuilt = false;

  // `"rebuild"` state: the app process we own, and a guard so that overlapping
  // build cycles (save twice in a row) can't spawn two hosts at once.
  private hostChild: ChildProcess | undefined;
  private relaunching = false;
  private relaunchPending = false;
  private fellBackToClassic = false;

  // Set while the watch child is being replaced on purpose, so its exit reads
  // as part of the switch rather than as the watcher dying under us.
  private switchingStrategy = false;

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
    this.strategy = watchStrategyFor(target.name);
  }

  /** How C# edits reach the app, in words the user can trust. */
  private get csharpLoopLabel(): string {
    return this.strategy === "rebuild"
      ? "C# rebuild + relaunch"
      : "C# hot reload active";
  }

  /**
   * The banner word for the loop as a whole. UI edits always hot reload; the
   * banner only stops saying so when the C# half of the loop cannot.
   */
  private get loopHeadline(): string {
    return this.hotReload && this.strategy === "rebuild"
      ? "reload on save active"
      : "hot reload active";
  }

  /** The same, phrased for the footer's "watching …" line. */
  private get csharpLoopSuffix(): string {
    return this.strategy === "rebuild"
      ? "C# rebuild + relaunch on save"
      : "hot reload on save";
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
            ? `${lime(this.loopHeadline)} ${dim(`\u2014 edit ui/src or ${hostDirLabel} and save`)}`
            : `${lime(this.loopHeadline)} ${dim("\u2014 edit ui/src and save")}`,
        ),
      );
      console.log();
      console.log(
        footer(
          this.hotReload
            ? `${dim("watching")} ${value("ui/")} ${dim("\u00b7")} ${value(`${hostDirLabel}/`)} ${dim(
                `\u00b7 ${this.csharpLoopSuffix} \u00b7 ctrl-c to stop`,
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
        strategy: this.strategy,
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
      // We killed it ourselves to restart it in the other mode; switchToRebuild
      // owns what happens next.
      if (this.switchingStrategy) return;

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
    if (event === "buildSucceeded" || event === "buildFailed") {
      this.buildOutcome = event === "buildSucceeded" ? "succeeded" : "failed";
      this.everBuilt = true;
    }

    if (this.shuttingDown) return;

    const reaction = watchReaction(event, {
      strategy: this.strategy,
      hostLaunched: this.watchReady,
      buildOutcome: this.buildOutcome,
      everBuilt: this.everBuilt,
    });

    // An idle line closes the cycle: whatever MSBuild said applied to the build
    // that just ended, not to the next one. Which message the watcher prints
    // varies by SDK — .NET 10.0.2xx says "Waiting for a file to change" while
    // 10.0.3xx says "Fix the error to continue" — so both count.
    if (event === "appWaiting" || event === "buildBlocked") {
      this.buildOutcome = null;
    }

    switch (reaction) {
      case "markHostReady":
        this.announceHostLaunched();
        return;

      case "launchHost":
        // Under "rebuild" the watcher has just produced a fresh build and will
        // not run it — that part is ours to do (see WatchStrategy).
        void this.launchOrRelaunchHost();
        return;

      case "switchToRebuild":
        void this.switchToRebuildLoop();
        return;

      case "reportAppIdle":
        console.log(
          taggedRow(
            "manual",
            "host",
            dim("app not running — save a C# file to relaunch, or ctrl-c to stop"),
          ),
        );
        return;

      case "reportEarlyExit":
        // Idle before the app was ever ready, with no build failure to blame:
        // it launched and died before announcing itself (an immediate crash),
        // or the watcher gave up before it ever built.
        console.log(
          taggedRow(
            "manual",
            "host",
            dim(
              "app exited before it was ready — save a C# file to relaunch, or ctrl-c to stop",
            ),
          ),
        );
        return;

      case "reportBuildFailed":
        // A failure before the first launch is often an environment problem
        // with a well-known fix rather than a code error, so surface the
        // targeted hint alongside the generic message.
        if (!this.watchReady) {
          if (looksLikeMissingWorkload(this.watchOutputTail)) printWorkloadHint();
          else if (looksLikeXcodeTooOld(this.watchOutputTail)) printXcodeTooOldHint();
          else if (looksLikeMissingXcode(this.watchOutputTail)) printXcodeHint();
        }
        console.log(
          taggedRow(
            "manual",
            "host",
            dim("build failed — fix the error and save to retry, or ctrl-c to stop"),
          ),
        );
        return;

      case "none":
        return;
    }
  }

  /**
   * A host we spawned ourselves reached VidraPage. Reported per launch, not
   * per session: under the "rebuild" loop each save produces a new one, and
   * "the app is back up" is the thing the developer is waiting to see.
   */
  private onHostReady(): void {
    if (this.shuttingDown) return;
    this.watchReady = true;
    const loop = this.hotReload ? ` ${dim(`\u00b7 ${this.csharpLoopSuffix}`)}` : "";
    console.log(
      taggedRow(
        "done",
        "host",
        `${dim("host ready \u2014")} ${value(this.project.projectName)}${loop}`,
      ),
    );
  }

  private announceHostLaunched(): void {
    if (this.watchReady) return;
    this.watchReady = true;
    console.log(
      taggedRow(
        "done",
        "host",
        `${dim("launched")} ${value(this.project.projectName)} ${dim(`— ${this.csharpLoopLabel}`)}`,
      ),
    );
  }

  /**
   * "rebuild" strategy: a build just succeeded, so replace the running app with
   * the one that was built. Serialized, because a burst of saves produces a
   * burst of successful builds and two hosts must never run at once — the
   * last request wins.
   */
  private async launchOrRelaunchHost(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.relaunching) {
      this.relaunchPending = true;
      return;
    }
    this.relaunching = true;

    try {
      do {
        this.relaunchPending = false;

        const previous = this.hostChild;
        if (previous) {
          this.hostChild = undefined;
          console.log(taggedRow("active", "host", dim("relaunching…")));
          killChild(previous);
          await waitForExit(previous, HOST_TERMINATION_TIMEOUT_MS);
        }
        if (this.shuttingDown) return;

        // The watcher already built it; go straight to signing and spawning.
        // Readiness is announced by onHostReady when the app says so itself;
        // spawning only means the loop is live.
        this.hostChild = this.spawnMacosHost({ fatal: false }) ?? undefined;
        if (this.hostChild) this.watchReady = true;
      } while (this.relaunchPending && !this.shuttingDown);
    } finally {
      this.relaunching = false;
    }
  }

  /**
   * The hot reload agent is gone and `dotnet watch` has stopped trying to reach
   * it. Every later edit would be applied to nothing while the watcher keeps
   * reporting success, so the session stops asking for deltas and drives the
   * loop itself: the watcher is restarted as `dotnet watch build`, and each
   * successful build relaunches the app.
   *
   * Restarting the watcher also takes the app down with it (it leads the
   * process group), which is what makes the first rebuild land on a clean
   * process instead of one whose agent has already given up.
   */
  private async switchToRebuildLoop(): Promise<void> {
    if (this.shuttingDown || this.strategy !== "delta") return;
    this.strategy = "rebuild";

    console.log();
    console.log(
      taggedRow(
        "manual",
        "host",
        dim(
          "the hot reload agent dropped out — dotnet watch would keep reporting edits as applied",
        ),
      ),
    );
    console.log(
      taggedRow(
        "active",
        "host",
        dim("switching this session to rebuild + relaunch on save…"),
      ),
    );
    console.log(
      footer(
        dim(
          "a known Mac Catalyst flake (dotnet/sdk#55488) — restarting vidra dev often gets deltas back",
        ),
      ),
    );
    console.log();

    const previous = this.watchChild;
    this.watchChild = undefined;
    if (previous) {
      this.switchingStrategy = true;
      killChild(previous, { processGroup: true });
      await waitForExit(previous, HOST_TERMINATION_TIMEOUT_MS);
      this.switchingStrategy = false;
    }
    if (this.shuttingDown) return;

    // The next cycle is a build, not a run: its outcome is what launches the
    // app, so start from a clean slate rather than the dead session's verdict.
    this.buildOutcome = null;
    this.everBuilt = false;
    this.launchHostWithWatch();
  }

  /**
   * `dotnet watch` exited before the app ever started — an incomplete SDK or
   * MAUI workload install, usually. Explain why, then launch the host the
   * classic way (one build + direct spawn) so the dev session still works,
   * minus anything that reacts to a C# edit.
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
        `${dim("the C# watch loop is unavailable \u2014 dotnet watch exited with")} ${value(
          signal ? `signal ${signal}` : `code ${code ?? "unknown"}`,
        )}`,
      ),
    );

    this.fellBackToClassic = true;

    if (looksLikeMissingWorkload(this.watchOutputTail)) {
      printWorkloadHint();
    } else if (looksLikeXcodeTooOld(this.watchOutputTail)) {
      printXcodeTooOldHint();
    } else if (looksLikeMissingXcode(this.watchOutputTail)) {
      printXcodeHint();
    } else {
      console.log(
        footer(
          dim("nothing in the output explains it \u2014 an incomplete toolchain is the usual cause:"),
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
    // A one-shot launch has nothing to retry with, so a missing bundle is fatal
    // \u2014 `fatal` exits inside spawnMacosHost; this keeps the return type honest.
    const host = this.spawnMacosHost({ fatal: true });
    if (!host) process.exit(1);
    return host;
  }

  /**
   * Locate the built `.app`, sign it if we can, and spawn its executable.
   *
   * Split out from {@link launchMacosHost} because the watch loop reaches this
   * point with the build already done — and, unlike a one-shot launch, must
   * survive a bad outcome: under `"rebuild"` the session stays alive so the
   * next save can put things right, hence `fatal: false` returning null rather
   * than exiting the process.
   */
  private spawnMacosHost(opts: { fatal: boolean }): ChildProcess | null {
    const outputDir = path.join(
      this.project.hostDir,
      "bin",
      this.buildConfig,
      this.target.framework,
    );

    const fail = (detail: string): null => {
      console.error(row({ glyph: "error", detail: dim(detail) }));
      if (opts.fatal) process.exit(1);
      return null;
    };

    const appBundle = findMacAppBundle(
      this.project.hostDir,
      this.target.framework,
      this.buildConfig,
    );
    if (!appBundle) return fail(`could not find .app bundle in ${outputDir}`);

    signMacAppBundleIfPossible(appBundle, {
      verbose: this.verbose,
      log: console.log,
      warn: console.warn,
    });

    const binary = findMacExecutable(appBundle);
    if (!binary) {
      return fail(`could not find the app executable in ${appBundle}`);
    }

    // "launching", not "launched": readiness is a claim only the app can make,
    // and it makes it via the sentinel (see onHostReady).
    console.log(
      taggedRow("active", "host", `${dim("launching")} ${value(path.basename(appBundle))}${dim("\u2026")}`),
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
      taggedRow("active", "host", `${dim("launching")} ${value(path.basename(exe))}${dim("\u2026")}`),
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
    // plumbing (see classifyWatchLine), not output the user should see \u2014 but it
    // is how we know the app got as far as VidraPage rather than merely being
    // spawned, so it is consumed rather than only suppressed.
    const include =
      tag === "host"
        ? (line: string): boolean => !line.includes(HOST_READY_SENTINEL)
        : undefined;
    prefixStream(child.stdout, tag, include);
    prefixStream(child.stderr, tag, include);
    if (tag === "host") {
      const onLine = (line: string): void => {
        if (line.includes(HOST_READY_SENTINEL)) this.onHostReady();
      };
      scanStream(child.stdout, onLine);
      scanStream(child.stderr, onLine);
    }

    child.on("exit", (code, signal) => {
      this.forgetChild(child);
      if (this.shuttingDown) return;

      if (tag === "ui") {
        const exitCode = code ?? 1;
        console.error(
          "\n" + row({ glyph: "error", detail: dim(`${label} exited with code ${exitCode}`) }),
        );
        this.shutdown(exitCode);
        return;
      }

      // A host we own under the "rebuild" loop is expected to come and go: we
      // kill it ourselves on every rebuild, and the user may close its window.
      // Either way the session lives on, exactly as `dotnet watch` does when it
      // owns the app — the next save relaunches.
      if (this.ownsHostProcess) {
        if (child !== this.hostChild) return;
        this.hostChild = undefined;
        console.log(
          taggedRow(
            "manual",
            "host",
            dim("app not running — save a C# file to relaunch, or ctrl-c to stop"),
          ),
        );
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

  /**
   * True while the "rebuild" loop is driving the app rather than the watcher.
   * Goes false once we fall back to a classic launch: there is no watcher left
   * to relaunch anything, so a host exit ends the session as it always did.
   */
  private get ownsHostProcess(): boolean {
    return (
      this.hotReload && this.strategy === "rebuild" && !this.fellBackToClassic
    );
  }

  /** Drop an exited child so a long session's relaunches don't accumulate. */
  private forgetChild(child: ChildProcess): void {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
  }

  private shutdown(exitCode: number): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    // Iterate a copy: an exiting child removes itself from `children`.
    for (const child of [...this.children]) {
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

/**
 * Resolves when `child` has exited, or after `timeoutMs` \u2014 in which case it is
 * SIGKILLed, because the caller's next step is to start a replacement.
 */
const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });

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
