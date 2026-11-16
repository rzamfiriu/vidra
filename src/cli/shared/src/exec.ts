import { execFileSync, execSync, spawn } from "node:child_process";
import { dim, row } from "./theme.js";

const toText = (value: Buffer | string | undefined): string => {
  if (value == null) return "";
  return Buffer.isBuffer(value) ? value.toString() : value;
};

/** Run a command without a shell and capture its output, never throwing. */
export interface RunResult {
  /** The executable was located and spawned (regardless of exit code). */
  found: boolean;
  /** Process exited 0. */
  ok: boolean;
  stdout: string;
  stderr: string;
}

export const run = (cmd: string, args: string[], cwd?: string): RunResult => {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
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
      stdout: toText(err.stdout),
      stderr: toText(err.stderr),
    };
  }
};

/**
 * Render a readable message from a failed child process. `dotnet`/MSBuild write
 * their build errors to **stdout**, not stderr, so we have to combine both —
 * otherwise the actual failure is dropped and callers only ever see the generic
 * "Command failed" message with an empty body.
 */
export const formatProcessError = (error: unknown): string => {
  const err = error as {
    stdout?: Buffer | string;
    stderr?: Buffer | string;
    message?: string;
  };
  const combined = [toText(err.stderr), toText(err.stdout)]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n")
    .trim();
  return combined.length > 0 ? combined : (err.message ?? String(error));
};

/**
 * Like {@link formatProcessError}, but distilled down to the lines that matter
 * for a build failure (compiler / MSBuild error rows). Falls back to the tail of
 * the output when nothing recognizable is found.
 */
export const formatBuildError = (error: unknown): string => {
  const raw = formatProcessError(error);
  const lines = raw.split(/\r?\n/);
  const errorLines = lines.filter((line) =>
    /(:\s*error\b|\berror\s+[A-Z]{2,}\d+|Build FAILED|MSB\d{4}|NETSDK\d{4})/i.test(
      line,
    ),
  );
  const picked =
    errorLines.length > 0
      ? errorLines
      : lines.filter((line) => line.trim().length > 0).slice(-30);
  return picked.join("\n").trim();
};

export const exec = (cmd: string, cwd: string): void => {
  try {
    execSync(cmd, { cwd, stdio: "pipe" });
  } catch (e: unknown) {
    console.error(row({ glyph: "error", detail: dim(`command failed: ${cmd}`) }));
    console.error(dim(formatProcessError(e)));
    process.exit(1);
  }
};

/**
 * Async, non-throwing variant of {@link exec}. Resolves `true` on a clean exit
 * and `false` on any failure (non-zero exit or spawn error), mirroring the
 * "swallow the error, report a boolean" contract callers rely on. Output is
 * discarded (`stdio: "ignore"`), so running several of these concurrently
 * neither garbles the console nor risks the `maxBuffer` overflow that buffering
 * a chatty `npm install` through a pipe would.
 */
export const tryExecAsync = (cmd: string, cwd: string): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(cmd, { cwd, stdio: "ignore", shell: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
