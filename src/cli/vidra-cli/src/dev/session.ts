import { dim, row, taggedRow, value } from "@vidra-dev/cli-shared/theme";
import { reportHostLaunchFailure, type HostContext, type HostLauncher } from "./hosts/index.js";
import {
  errorMessage,
  hostReadyText,
  hostStatus,
  printLoopBanner,
  printSessionHeader,
} from "./messages.js";
import type { DevCommand } from "./options.js";
import { describeExit, exitedCleanly, sessionExitCode } from "./processes.js";
import { createSupervisor, superviseHost } from "./supervisor.js";
import { spawnVite, waitForServer } from "./vite.js";
import { createWatchLoop, type WatchLoop } from "./watch-loop.js";

const VITE_READY_TIMEOUT_MS = 30_000;

export interface DevSessionConfig extends HostContext {
  readonly command: DevCommand;
  readonly vite: boolean;
  readonly hotReload: boolean;
}

export interface DevSession {
  /** Starts Vite and the host; settles only once the session has shut down. */
  readonly run: () => Promise<void>;
  /**
   * A bridge policy is a bundled native resource, not managed code, so
   * `dotnet watch` notices the file but cannot apply it as a metadata delta.
   * Replaces the watcher instead: the new one performs a real build, embeds the
   * policy, launches the host, and keeps the current delta or rebuild strategy.
   */
  readonly restartHostForBridgePolicyChange: () => Promise<void>;
}

/**
 * How the host is driven. `classic` is one build and a direct spawn, with no C#
 * loop: `vidra run`, `--no-hot-reload`, or a session whose watcher could not
 * start the app.
 */
type HostLoop = { readonly kind: "watch"; readonly loop: WatchLoop } | { readonly kind: "classic" };

export const createDevSession = (config: DevSessionConfig, hosts: HostLauncher): DevSession => {
  const supervisor = createSupervisor({ beforeShutdown: hosts.stopApp });

  const launchClassicHost = (): void => {
    hostLoop = { kind: "classic" };
    try {
      const host = hosts.launch({ build: true });
      superviseHost(supervisor, hosts, host, {
        onReady: () =>
          console.log(taggedRow("done", "host", hostReadyText(config.project.projectName, null))),
        onExit: (exit) => {
          if (!exitedCleanly(exit)) {
            console.error(
              "\n" + row({ glyph: "error", detail: dim(`${host.label} exited with ${describeExit(exit)}`) }),
            );
            hosts.printLaunchFailureHint?.();
          }
          supervisor.shutdown(sessionExitCode(exit));
        },
      });
    } catch (error) {
      reportHostLaunchFailure(error);
      supervisor.shutdown(1);
    }
  };

  let hostLoop: HostLoop = config.hotReload
    ? {
        kind: "watch",
        loop: createWatchLoop({ ctx: config, supervisor, hosts, onUnavailable: launchClassicHost }),
      }
    : { kind: "classic" };

  /** Resolves false, having started shutdown, when Vite never answers. */
  const startVite = async (): Promise<boolean> => {
    console.log(taggedRow("active", "ui", dim("starting dev server…")));
    const exposeNetwork = config.target.name === "android" || config.iosDestination === "device";
    supervisor.supervise(spawnVite(config.devUrl, config.project.uiDir, exposeNetwork), {
      tag: "ui",
      label: "Vite dev server",
      onExit: ({ code }) => {
        const exitCode = code ?? 1;
        console.error(
          "\n" + row({ glyph: "error", detail: dim(`Vite dev server exited with code ${exitCode}`) }),
        );
        supervisor.shutdown(exitCode);
      },
    });

    try {
      await waitForServer(config.devUrl, VITE_READY_TIMEOUT_MS);
    } catch (error) {
      console.error(row({ glyph: "error", detail: dim(errorMessage(error)) }));
      supervisor.shutdown(1);
      return false;
    }
    console.log(taggedRow("active", "ui", `${dim("vite ready —")} ${value(config.devUrl)}`));
    return true;
  };

  const startHost = (): void => {
    if (hostLoop.kind === "watch") hostLoop.loop.start();
    else launchClassicHost();
  };

  const run = async (): Promise<void> => {
    supervisor.handleSignals();
    printSessionHeader(config.command, config.target, config.project.projectName);

    if (config.vite) {
      if (!(await startVite())) return supervisor.done;
    } else {
      console.log(taggedRow("skip", "ui", `${dim("vite not started —")} ${value("npm run dev:ui")}`));
    }

    startHost();
    if (supervisor.isShuttingDown()) return supervisor.done;

    printLoopBanner({
      vite: config.vite,
      hostDir: config.project.hostDir,
      csharpLoop: hostLoop.kind === "watch" ? hostLoop.loop.strategy() : null,
    });

    // Every exit path funnels through shutdown, which settles this and exits
    // the process, so callers never observe a finished session with children
    // still running.
    return supervisor.done;
  };

  const restartHostForBridgePolicyChange = async (): Promise<void> => {
    if (supervisor.isShuttingDown()) return;
    if (hostLoop.kind === "classic") {
      hostStatus("manual", "vidra.config.ts updated — restart the host to apply bridge access");
      return;
    }
    await hostLoop.loop.restartForBridgePolicyChange();
  };

  return { run, restartHostForBridgePolicyChange };
};
