import type { DevTargetName } from "./options.js";

/**
 * How the C#-side dev loop is driven:
 *
 * - `"delta"` — `dotnet watch run`. The watcher owns the launch, because only
 *   then can it inject the hot reload agent (`DOTNET_STARTUP_HOOKS`) and apply
 *   edits to the *running* process. This is the real thing, and every desktop
 *   session starts here.
 * - `"rebuild"` — `dotnet watch build` plus a launch of our own, reusing the
 *   build-then-spawn path behind `vidra run` and `vidra dev --no-hot-reload`.
 *   Android and iOS always use it, deploying each build themselves. On the
 *   desktop it is where a session *lands* when the delta channel dies under it
 *   (see {@link DELTA_CHANNEL_DEAD_WARNING}).
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
 * The initial strategy. A desktop session only moves to `"rebuild"` by
 * observing its own delta channel die, never by predicting that it will.
 */
export const watchStrategyFor = (targetName: DevTargetName): WatchStrategy =>
  targetName === "android" || targetName === "ios" ? "rebuild" : "delta";

/**
 * `dotnet watch` gives up on a process with this line, after an update batch
 * fails. It is a `LogWarning` in the SDK, so unlike the transport's own
 * diagnostics it prints at default verbosity — the session never has to run the
 * watcher in `--verbose` to see it. Matching English text is safe because
 * {@link dotnetWatchEnv} pins `DOTNET_CLI_UI_LANGUAGE=en`.
 */
export const DELTA_CHANNEL_DEAD_WARNING =
  "further changes won't be applied to this process";

/**
 * Printed by VidraPage in dev sessions once the host is up. It is CLI plumbing
 * rather than output for the user, so the session consumes it and prints a
 * friendlier status line instead.
 */
export const HOST_READY_SENTINEL = "[vidra] host ready";

export const isHostReadySentinel = (line: string): boolean =>
  line.includes(HOST_READY_SENTINEL);

export interface DotnetWatchArgsOptions {
  readonly csprojPath: string;
  readonly framework: string;
  readonly buildConfig: string;
  readonly verbose: boolean;
  readonly strategy: WatchStrategy;
  /** iOS only: the Simulator and a device are different builds of one framework. */
  readonly runtimeIdentifier?: string;
}

/**
 * Arguments for the `dotnet watch` process. Under `"delta"` the watcher runs
 * the app; under `"rebuild"` it only builds it (see {@link WatchStrategy}).
 *
 * `RunWithOpen=false` is load-bearing on Mac Catalyst. Left at its default the
 * run target hands the bundle to `open(1)`, which returns immediately and
 * leaves the app parented to launchd: `dotnet run` exits 0 straight away, the
 * watcher concludes the app is gone, and nothing the app prints — including the
 * readiness sentinel this session waits for — is ever connected to anything.
 * With it, the bundle's executable is spawned as a child, which is what makes
 * both the sentinel and the hot reload agent's lifetime observable.
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
  ...(opts.runtimeIdentifier ? ["-r", opts.runtimeIdentifier] : []),
  ...(opts.strategy === "delta" && opts.framework.includes("maccatalyst")
    ? ["--property:RunWithOpen=false"]
    : []),
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
 *   {@link HOST_READY_SENTINEL}, because `dotnet watch` itself has no
 *   version-stable "started" message (the .NET 10.0.2xx watcher prints none at
 *   all); the watch-message match covers SDKs that do print one. Deliberately
 *   NOT matched on "Hot reload enabled", which prints before the first build
 *   and would misclassify run-target failures as post-launch exits.
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
export const classifyWatchLine = (line: string): WatchLineEvent => {
  if (line.toLowerCase().includes(DELTA_CHANNEL_DEAD_WARNING)) {
    return "deltaChannelDead";
  }
  if (/waiting for a file to change/i.test(line)) return "appWaiting";
  if (/fix the error to continue/i.test(line)) return "buildBlocked";
  if (isHostReadySentinel(line)) return "appStarted";
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

export type BuildOutcome = "succeeded" | "failed";

export interface WatchReactionContext {
  readonly strategy: WatchStrategy;
  /** Has the app run at least once this session? */
  readonly hostLaunched: boolean;
  /** MSBuild's verdict for the cycle now ending, if it was seen. */
  readonly buildOutcome: BuildOutcome | null;
  /** Has any build at all finished this session? */
  readonly everBuilt: boolean;
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
