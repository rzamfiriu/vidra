import path from "node:path";
import { execFileSync } from "node:child_process";
import { dim, footer, row, STEP_LABEL_WIDTH, value } from "./theme.js";

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

  // A real identity gives a fully signed bundle; when none exists we still
  // re-sign ad-hoc ("-"). MAUI already ad-hoc signs Debug builds, but doing it
  // ourselves with --force --deep guarantees a consistent, unbroken signature so
  // the OS will actually launch the locally built app instead of killing it.
  const identity = resolveMacCodeSigningIdentity();
  const signWith = identity ?? "-";
  const label = path.basename(appBundle);

  try {
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", signWith, appBundle],
      {
        stdio: options.verbose ? "inherit" : "pipe",
      },
    );
    options.log(
      row({
        glyph: "done",
        label: "codesign",
        labelWidth: STEP_LABEL_WIDTH,
        detail: identity
          ? `${value(label)} ${dim(`with ${identity}`)}`
          : `${value(label)} ${dim("ad-hoc (-)")}`,
      }),
    );
  } catch (error) {
    options.warn(
      row({
        glyph: "manual",
        label: "codesign",
        labelWidth: STEP_LABEL_WIDTH,
        detail: dim("could not sign the app bundle; it may fail to launch"),
      }),
    );
    options.warn(
      footer(
        dim(
          "install Xcode or the Command Line Tools (provides `codesign`), or set VIDRA_MACOS_CODESIGN_KEY.",
        ),
      ),
    );
    options.warn(dim(formatExecError(error)));
  }
};

export const resolveMacCodeSigningIdentity = (): string | null => {
  const override = process.env.VIDRA_MACOS_CODESIGN_KEY?.trim();
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
