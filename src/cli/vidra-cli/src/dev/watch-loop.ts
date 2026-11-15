import { spawn, type ChildProcess } from "node:child_process";
import { dim, fixLine, footer, row, taggedRow, value } from "@vidra-dev/cli-shared/theme";
import { printToolchainHint } from "../doctor.js";
import { coalesce } from "./coalesce.js";
import {
  buildDotnetWatchArgs,
  classifyWatchLine,
  dotnetWatchEnv,
  isHostReadySentinel,
  watchReaction,
  watchStrategyFor,
  type BuildOutcome,
  type WatchStrategy,
} from "./dotnet-watch.js";
import { DOTNET_COMMAND } from "./hosts/dotnet-build.js";
import { reportHostLaunchFailure, type HostContext, type HostLauncher } from "./hosts/index.js";
import { csharpLoopLabel, hostReadyText, hostStatus } from "./messages.js";
import {
  describeExit,
  exitedCleanly,
  killChild,
  sessionExitCode,
  terminateChild,
  type ProcessExit,
} from "./processes.js";
import { superviseHost, type Supervisor } from "./supervisor.js";

// How much recent `dotnet watch` output to keep for diagnosing an early exit
// (workload / Xcode hints) when deciding to fall back to a classic launch.
const WATCH_OUTPUT_TAIL_CHARS = 8192;

const APP_NOT_RUNNING = "app not running — save a C# file to relaunch, or ctrl-c to stop";

export interface WatchLoopDeps {
  readonly ctx: HostContext;
  readonly supervisor: Supervisor;
  readonly hosts: HostLauncher;
  /** The watcher exited before the app ever ran; the session continues without a C# loop. */
  readonly onUnavailable: () => void;
}

export interface WatchLoop {
  readonly start: () => void;
  readonly strategy: () => WatchStrategy;
  /** Replaces the watcher, so its first build embeds a changed bridge policy. */
  readonly restartForBridgePolicyChange: () => Promise<void>;
}

/** What the current watcher has printed. Starts over with each watcher. */
interface WatcherProgress {
  buildOutcome: BuildOutcome | null;
  everBuilt: boolean;
  outputTail: string;
}

const freshProgress = (): WatcherProgress => ({
  buildOutcome: null,
  everBuilt: false,
  outputTail: "",
});

/**
 * Drives the C# half of the dev loop through `dotnet watch`, under whichever
 * {@link WatchStrategy} the session is on, and owns the transitions between
 * them: delta to rebuild when the hot reload agent dies, a fresh watcher when
 * the bridge policy changes, and a hand-over to a classic launch when watching
 * does not work at all.
 */
export const createWatchLoop = ({
  ctx,
  supervisor,
  hosts,
  onUnavailable,
}: WatchLoopDeps): WatchLoop => {
  const { isShuttingDown } = supervisor;
  const { projectName } = ctx.project;

  let strategy = watchStrategyFor(ctx.target.name);
  // Cleared *before* a watcher is retired on purpose, so its exit and its last
  // output are recognisably not ours to act on. Identity rather than a flag:
  // the old process can outlive the wait for it.
  let watcher: ChildProcess | undefined;
  let progress = freshProgress();
  // Has the app come up since the loop last started from scratch? Until it
  // has, a watcher exit means watching does not work here, not that the app
  // was closed.
  let hostLaunched = false;
  // Under "rebuild", the app process the session spawned itself.
  let ownedHost: ChildProcess | undefined;

  const startWatcher = (): void => {
    console.log(
      taggedRow(
        "active",
        "host",
        `${dim("dotnet watch — building")} ${value(ctx.target.framework)} ${dim("…")}`,
      ),
    );

    const watch = spawn(
      DOTNET_COMMAND,
      buildDotnetWatchArgs({
        csprojPath: ctx.project.csprojPath,
        framework: ctx.target.framework,
        buildConfig: ctx.buildConfig,
        verbose: ctx.verbose,
        strategy,
        runtimeIdentifier: ctx.runtimeIdentifier,
      }),
      {
        cwd: ctx.project.root,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...dotnetWatchEnv(ctx.devUrl) },
        // Unix: lead a process group, so shutdown can signal the watcher and
        // the app it launched together. Windows goes through `taskkill /T`.
        detached: process.platform !== "win32",
      },
    );

    watcher = watch;
    supervisor.supervise(watch, {
      tag: "host",
      label: "dotnet watch",
      processGroup: true,
      // onWatchLine turns the sentinel into a friendlier status line.
      hideLine: isHostReadySentinel,
      onLine: (line) => {
        if (watch === watcher) onWatchLine(watch, line);
      },
      onExit: (exit) => {
        if (watch === watcher) onWatcherExit(watch, exit);
      },
    });
  };

  const onWatchLine = (watch: ChildProcess, line: string): void => {
    progress.outputTail = (progress.outputTail + line + "\n").slice(-WATCH_OUTPUT_TAIL_CHARS);

    const event = classifyWatchLine(line);
    if (event === "buildSucceeded" || event === "buildFailed") {
      progress.buildOutcome = event === "buildSucceeded" ? "succeeded" : "failed";
      progress.everBuilt = true;
    }

    const reaction = watchReaction(event, {
      strategy,
      hostLaunched,
      buildOutcome: progress.buildOutcome,
      everBuilt: progress.everBuilt,
    });

    // An idle line closes the cycle: whatever MSBuild said applied to the build
    // that just ended, not to the next one. Which message the watcher prints
    // varies by SDK — .NET 10.0.2xx says "Waiting for a file to change" while
    // 10.0.3xx says "Fix the error to continue" — so both count.
    if (event === "appWaiting" || event === "buildBlocked") {
      progress.buildOutcome = null;
    }

    switch (reaction) {
      case "markHostReady":
        hostLaunched = true;
        // The sentinel means the app said so itself; the watcher's own start
        // message only means a process was spawned.
        console.log(
          taggedRow(
            "done",
            "host",
            isHostReadySentinel(line)
              ? hostReadyText(projectName, strategy)
              : `${dim("launched")} ${value(projectName)} ${dim(`— ${csharpLoopLabel(strategy)}`)}`,
          ),
        );
        return;

      case "launchHost":
        // Under "rebuild" the watcher has just produced a fresh build and will
        // not run it; that part is ours.
        void relaunchOwnedHost();
        return;

      case "switchToRebuild":
        void switchToRebuild(watch);
        return;

      case "reportAppIdle":
        hostStatus("manual", APP_NOT_RUNNING);
        return;

      case "reportEarlyExit":
        // Idle before the app was ever ready, with no build failure to blame:
        // it launched and died before announcing itself, or the watcher gave
        // up before it ever built.
        hostStatus(
          "manual",
          "app exited before it was ready — save a C# file to relaunch, or ctrl-c to stop",
        );
        return;

      case "reportBuildFailed":
        // A failure before the first launch is often an environment problem
        // with a well-known fix rather than a code error.
        if (!hostLaunched) printToolchainHint(progress.outputTail);
        hostStatus("manual", "build failed — fix the error and save to retry, or ctrl-c to stop");
        return;

      case "none":
        return;

      default:
        reaction satisfies never;
    }
  };

  const onWatcherExit = (watch: ChildProcess, exit: ProcessExit): void => {
    watcher = undefined;
    if (!hostLaunched) {
      void fallBackToClassicLaunch(exit);
      return;
    }

    // The app ran at least once, so this ends the session like any host exit.
    // The watcher led the app's process group; make sure an app that outlived
    // it is not orphaned.
    killChild(watch, { processGroup: true, signal: "SIGKILL" });
    if (!exitedCleanly(exit)) {
      console.error(
        "\n" + row({ glyph: "error", detail: dim(`dotnet watch exited with ${describeExit(exit)}`) }),
      );
    }
    supervisor.shutdown(sessionExitCode(exit));
  };

  /** Retires `previous` and starts a fresh watcher with the current strategy. */
  const replaceWatcher = async (previous: ChildProcess): Promise<void> => {
    watcher = undefined;
    // Under "delta" the watcher leads the app's process group, so this takes
    // the app down too.
    await terminateChild(previous, { processGroup: true });
    if (isShuttingDown()) return;

    progress = freshProgress();
    startWatcher();
  };

  /**
   * The hot reload agent is gone and `dotnet watch` has stopped trying to reach
   * it. Every later edit would be applied to nothing while the watcher keeps
   * reporting success, so the session stops asking for deltas and drives the
   * loop itself: the watcher is restarted as `dotnet watch build`, and each
   * successful build relaunches the app. Restarting the watcher takes the app
   * down with it, so the first rebuild lands on a clean process instead of one
   * whose agent has already given up.
   */
  const switchToRebuild = async (previous: ChildProcess): Promise<void> => {
    strategy = "rebuild";

    console.log();
    hostStatus(
      "manual",
      "the hot reload agent dropped out — dotnet watch would keep reporting edits as applied",
    );
    hostStatus("active", "switching this session to rebuild + relaunch on save…");
    console.log(
      footer(
        dim("a known Mac Catalyst flake (dotnet/sdk#55488) — restarting vidra dev often gets deltas back"),
      ),
    );
    console.log();

    await replaceWatcher(previous);
  };

  /**
   * "rebuild": a build just succeeded, so replace the running app with the one
   * that was built. Coalesced, because a burst of saves produces a burst of
   * successful builds and two hosts must never run at once.
   */
  const relaunchOwnedHost = coalesce(async () => {
    if (isShuttingDown()) return;
    if (ownedHost) {
      const previous = ownedHost;
      ownedHost = undefined;
      hostStatus("active", "relaunching…");
      await terminateChild(previous);
      if (isShuttingDown()) return;
    }

    try {
      // The watcher already built it; go straight to deploying.
      const host = hosts.launch({ build: false });
      ownedHost = host.child;
      hostLaunched = true;
      superviseHost(supervisor, hosts, host, {
        // Reported per launch: each save produces a new app, and "it is back
        // up" is what the developer is waiting to see.
        onReady: () => console.log(taggedRow("done", "host", hostReadyText(projectName, strategy))),
        // An owned app comes and goes: we kill it on every rebuild, and the
        // user may close its window. The session lives on either way.
        onExit: () => {
          if (host.child !== ownedHost) return;
          ownedHost = undefined;
          hostStatus("manual", APP_NOT_RUNNING);
        },
      });
    } catch (error) {
      reportHostLaunchFailure(error);
      hostStatus("manual", "launch failed — fix the error and save to retry, or ctrl-c to stop");
    }
  });

  /**
   * `dotnet watch` exited before the app ever started — an incomplete SDK or
   * MAUI workload install, usually. Explain why, then hand over to a classic
   * launch (one build + direct spawn) so the session still works, minus
   * anything that reacts to a C# edit.
   */
  const fallBackToClassicLaunch = async (exit: ProcessExit): Promise<void> => {
    console.log();
    console.log(
      taggedRow(
        "manual",
        "host",
        `${dim("the C# watch loop is unavailable — dotnet watch exited with")} ${value(describeExit(exit))}`,
      ),
    );
    if (!printToolchainHint(progress.outputTail)) {
      console.log(
        footer(dim("nothing in the output explains it — an incomplete toolchain is the usual cause:")),
      );
      console.log(fixLine("dotnet workload update"));
      if (!ctx.verbose) {
        console.log(footer(dim("re-run with --verbose for the full watch log.")));
      }
    }
    hostStatus("active", "falling back to a classic launch (frontend hot reload still active)…");
    console.log();

    // A bridge-policy restart under "rebuild" leaves the app we spawned running
    // until the next build, and the classic launch must not overlap it.
    if (ownedHost) {
      const previous = ownedHost;
      ownedHost = undefined;
      await terminateChild(previous);
      if (isShuttingDown()) return;
    }
    onUnavailable();
  };

  const restartForBridgePolicyChange = async (): Promise<void> => {
    // Without a live watcher another transition is already replacing it, and
    // the replacement's first build reads the policy that was just written.
    if (!watcher) return;

    hostStatus("active", "vidra.config.ts updated — rebuilding and relaunching the host…");
    hostLaunched = false;
    await replaceWatcher(watcher);
  };

  return {
    start: startWatcher,
    strategy: () => strategy,
    restartForBridgePolicyChange,
  };
};
