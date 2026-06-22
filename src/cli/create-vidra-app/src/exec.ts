import { execSync } from "node:child_process";
import { dim, row } from "./theme.js";

const toText = (value: Buffer | string | undefined): string => {
  if (value == null) return "";
  return Buffer.isBuffer(value) ? value.toString() : value;
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

export const tryExec = (cmd: string, cwd: string): boolean => {
  try {
    execSync(cmd, { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};
