import type { ChildProcess } from "node:child_process";
import { dim, footer, taggedRow, value } from "@vidra-dev/cli-shared/theme";
import { printToolchainHint } from "../../doctor.js";
import type { ProjectInfo } from "../../project.js";
import type { DevTarget, IosDestination } from "../options.js";

/** Everything a platform needs to build, deploy, and start the host app. */
export interface HostContext {
  readonly project: ProjectInfo;
  readonly target: DevTarget;
  readonly buildConfig: string;
  /** The dev server URL as this machine sees it. */
  readonly devUrl: string;
  readonly verbose: boolean;
  readonly iosDestination: IosDestination | null;
  readonly runtimeIdentifier: string | undefined;
}

/** The process standing in for the running app, and what to call it in messages. */
export interface LaunchedHost {
  readonly child: ChildProcess;
  readonly label: string;
}

export interface LaunchOptions {
  /** False when `dotnet watch build` has just produced the same output. */
  readonly build: boolean;
}

export interface HostLauncher {
  /**
   * Builds (if asked), deploys, and spawns the app. Synchronous builds and
   * installs block the event loop for their duration. Throws
   * {@link HostLaunchError} when the app cannot be started.
   */
  readonly launch: (opts: LaunchOptions) => LaunchedHost;
  /** Stops an app that outlives its launched process, e.g. Android behind logcat. */
  readonly stopApp?: () => void;
  /** Explains a host that built but would not start. */
  readonly printLaunchFailureHint?: () => void;
}

export interface HostLaunchErrorDetails {
  /** Tool output worth showing, scanned for known toolchain problems. */
  readonly output?: string;
  /** A one-line suggestion printed last. */
  readonly hint?: string;
}

export class HostLaunchError extends Error {
  readonly output?: string;
  readonly hint?: string;

  constructor(message: string, details: HostLaunchErrorDetails = {}) {
    super(message);
    this.name = "HostLaunchError";
    this.output = details.output;
    this.hint = details.hint;
  }
}

export const reportHostLaunchFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(taggedRow("error", "host", dim(message)));
  if (!(error instanceof HostLaunchError)) return;

  if (error.output) {
    console.error(dim(error.output));
    printToolchainHint(error.output);
  }
  if (error.hint) console.error(footer(dim(error.hint)));
};

/** The environment for a host process that reads the dev server URL itself. */
export const devServerEnv = (devUrl: string): NodeJS.ProcessEnv => ({
  ...process.env,
  VIDRA_DEV_URL: devUrl,
});

// "launching", not "launched": readiness is a claim only the app can make, and
// it makes it with the host-ready sentinel.
export const announceLaunching = (name: string): void => {
  console.log(
    taggedRow("active", "host", `${dim("launching")} ${value(name)}${dim("…")}`),
  );
};
