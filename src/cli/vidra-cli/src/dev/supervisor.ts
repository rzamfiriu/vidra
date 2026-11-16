import type { ChildProcess } from "node:child_process";
import { dim, footer, row, streamPrefix, type TagName } from "@vidra-dev/cli-shared/theme";
import { isHostReadySentinel } from "./dotnet-watch.js";
import type { HostLauncher, LaunchedHost } from "./hosts/index.js";
import { forEachLine, terminateChild, type ProcessExit } from "./processes.js";

export interface SuperviseOptions {
  readonly tag: TagName;
  /** Names the process in error messages. */
  readonly label: string;
  /** The child was spawned `detached`; shutdown signals its whole process group. */
  readonly processGroup?: boolean;
  /** Lines the session consumes itself rather than showing the user. */
  readonly hideLine?: (line: string) => boolean;
  /** Every complete output line, until the session starts shutting down. */
  readonly onLine?: (line: string) => void;
  /** The child exited while the session was still running. */
  readonly onExit: (exit: ProcessExit) => void;
  /** Printed after "failed to start …"; the session ends either way. */
  readonly spawnFailureHint?: () => void;
}

export interface Supervisor {
  /** Passes the child's output through under `tag` and stops it on shutdown. */
  readonly supervise: (child: ChildProcess, opts: SuperviseOptions) => void;
  readonly isShuttingDown: () => boolean;
  /**
   * Stops every supervised child, waits for them, then exits the process with
   * `exitCode`. Only the first call has any effect.
   */
  readonly shutdown: (exitCode: number) => void;
  /** Routes ctrl-c and SIGTERM through {@link Supervisor.shutdown}. */
  readonly handleSignals: () => void;
  /** Settles once shutdown has stopped every child, just before the process exits. */
  readonly done: Promise<void>;
}

export interface SupervisorOptions {
  /** Runs first on shutdown, while the children are still up. */
  readonly beforeShutdown?: () => void;
}

export const createSupervisor = (opts: SupervisorOptions = {}): Supervisor => {
  // Keyed by child so an exited one can drop out: a long session's relaunches
  // must not accumulate.
  const children = new Map<ChildProcess, { processGroup: boolean }>();
  let shuttingDown = false;
  let markDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    markDone = resolve;
  });

  const isShuttingDown = (): boolean => shuttingDown;

  const shutdown = (exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    opts.beforeShutdown?.();

    // Copied first: each child removes itself from the map as it exits.
    const stopping = [...children].map(([child, { processGroup }]) =>
      terminateChild(child, { processGroup }),
    );
    void Promise.all(stopping).finally(() => {
      markDone();
      process.exit(exitCode);
    });
  };

  const supervise = (child: ChildProcess, options: SuperviseOptions): void => {
    children.set(child, { processGroup: options.processGroup ?? false });

    const prefix = streamPrefix(options.tag);
    const handleLine = (line: string): void => {
      if (line.length > 0 && !options.hideLine?.(line)) {
        process.stdout.write(`${prefix} ${line}\n`);
      }
      if (!shuttingDown) options.onLine?.(line);
    };
    forEachLine(child.stdout, handleLine);
    forEachLine(child.stderr, handleLine);

    child.on("exit", (code, signal) => {
      children.delete(child);
      if (!shuttingDown) options.onExit({ code, signal });
    });

    child.on("error", (error) => {
      if (shuttingDown) return;
      console.error(
        "\n" +
          row({
            glyph: "error",
            detail: dim(`failed to start ${options.label}: ${error.message}`),
          }),
      );
      options.spawnFailureHint?.();
      shutdown(1);
    });
  };

  const handleSignals = (): void => {
    process.on("SIGINT", () => {
      console.log("\n" + footer(dim("shutting down…")));
      shutdown(0);
    });
    process.on("SIGTERM", () => shutdown(0));
  };

  return { supervise, isShuttingDown, shutdown, handleSignals, done };
};

export interface HostHandlers {
  /** The app printed the host-ready sentinel: it got as far as VidraPage. */
  readonly onReady: () => void;
  readonly onExit: (exit: ProcessExit) => void;
}

/** Supervises a launched app, consuming its readiness sentinel rather than showing it. */
export const superviseHost = (
  supervisor: Supervisor,
  launcher: HostLauncher,
  host: LaunchedHost,
  handlers: HostHandlers,
): void =>
  supervisor.supervise(host.child, {
    tag: "host",
    label: host.label,
    hideLine: isHostReadySentinel,
    onLine: (line) => {
      if (isHostReadySentinel(line)) handlers.onReady();
    },
    onExit: handlers.onExit,
    spawnFailureHint: launcher.printLaunchFailureHint,
  });
