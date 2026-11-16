import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

// How long a relaunch waits for the previous app to go away before killing it
// outright. Two instances of the same bundle must never overlap, and a host
// wedged on shutdown must not wedge the dev loop with it.
const TERMINATION_TIMEOUT_MS = 5_000;
const KILL_GRACE_MS = 1_000;

/** The arguments of a child's `exit` event. */
export interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export const describeExit = ({ code, signal }: ProcessExit): string =>
  signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;

export const exitedCleanly = ({ code, signal }: ProcessExit): boolean =>
  signal === null && (code === null || code === 0);

/** The CLI's own exit code when a child's exit ends the session. */
export const sessionExitCode = ({ code, signal }: ProcessExit): number =>
  code ?? (signal ? 1 : 0);

/** Spawns `command` with stdin closed and stdout/stderr piped back to us. */
export const spawnPiped = (
  command: string,
  args: readonly string[],
  opts: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): ChildProcess =>
  spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** Invokes `onLine` per complete output line, buffering partial chunks. */
export const forEachLine = (
  stream: Readable | null,
  onLine: (line: string) => void,
): void => {
  if (!stream) return;

  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop() ?? "";
    lines.forEach(onLine);
  });
  stream.on("end", () => {
    if (pending) onLine(pending);
  });
};

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

/** Resolves true when `child` exits, or false when the timeout elapses first. */
const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (hasExited(child)) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

export interface KillOptions {
  /** The child leads its own process group (spawned `detached`); signal all of it. */
  readonly processGroup?: boolean;
  readonly signal?: NodeJS.Signals;
}

export const killChild = (child: ChildProcess, opts: KillOptions = {}): void => {
  if (!child.pid) return;
  const signal = opts.signal ?? "SIGTERM";

  if (process.platform === "win32") {
    if (child.exitCode !== null) return;
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      child.kill();
    }
    return;
  }

  // Signalling the group reaches its grandchildren too (the app `dotnet watch`
  // launched), which a plain kill of the leader would orphan.
  if (opts.processGroup) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Group already gone — fall through to a plain kill.
    }
  }

  if (child.exitCode === null) child.kill(signal);
};

/**
 * Stops a supervised process and waits for it before its replacement starts or
 * the CLI exits. If a watcher leader exits before its app, the final group
 * SIGKILL still reaches that grandchild because the process-group id survives
 * its leader.
 */
export const terminateChild = async (
  child: ChildProcess,
  opts: Pick<KillOptions, "processGroup"> = {},
): Promise<void> => {
  // A child that failed to spawn has no process to wait for.
  if (child.pid === undefined) return;

  killChild(child, opts);
  const exited = await waitForExit(child, TERMINATION_TIMEOUT_MS);
  if (!exited || opts.processGroup) {
    killChild(child, { ...opts, signal: "SIGKILL" });
  }
  if (!exited) {
    await waitForExit(child, KILL_GRACE_MS);
  }
};
