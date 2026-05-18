import path from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";

export interface SignMacAppBundleOptions {
  verbose: boolean;
  log: (message: string) => void;
  warn: (message: string) => void;
}

export const signMacAppBundleIfPossible = (
  appBundle: string,
  options: SignMacAppBundleOptions,
): void => {
  if (process.platform !== "darwin") return;

  const codesignIdentity = resolveMacCodeSigningIdentity();
  if (!codesignIdentity) {
    options.warn(
      chalk.yellow(
        "  No usable macOS signing identity found. The app will remain ad-hoc signed.",
      ),
    );
    options.warn(
      chalk.yellow(
        "  Set UINET_MACOS_CODESIGN_KEY to override identity selection if needed.",
      ),
    );
    return;
  }

  try {
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", codesignIdentity, appBundle],
      {
        stdio: options.verbose ? "inherit" : "pipe",
      },
    );
    options.log(
      `  ${chalk.dim("Signing:")}  ${chalk.cyan(path.basename(appBundle))} ${chalk.dim(`with ${codesignIdentity}`)}`,
    );
  } catch (error) {
    options.warn(
      chalk.yellow(
        "  Failed to re-sign the macOS app bundle. It may remain ad-hoc signed.",
      ),
    );
    options.warn(chalk.dim(formatExecError(error)));
  }
};

export const resolveMacCodeSigningIdentity = (): string | null => {
  const override = process.env.UINET_MACOS_CODESIGN_KEY?.trim();
  if (override) {
    return override;
  }

  try {
    const output = execFileSync(
      "security",
      ["find-identity", "-v", "-p", "codesigning"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      },
    );

    const identities = output
      .split(/\r?\n/)
      .map((line) => line.match(/"([^"]+)"/)?.[1] ?? null)
      .filter((value): value is string => value !== null);

    return (
      identities.find((identity) => identity.startsWith("Apple Development:")) ??
      identities.find((identity) => identity.startsWith("Developer ID Application:")) ??
      null
    );
  } catch {
    return null;
  }
};

const formatExecError = (error: unknown): string => {
  const err = error as { stderr?: Buffer | string; message?: string };
  if (Buffer.isBuffer(err.stderr)) {
    return err.stderr.toString();
  }
  if (typeof err.stderr === "string") {
    return err.stderr;
  }
  return err.message ?? String(error);
};
