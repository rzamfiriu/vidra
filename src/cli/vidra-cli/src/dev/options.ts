import type { ParsedArgs } from "@vidra-dev/cli-shared/utils";
import { detectPlatform } from "../project.js";
import { iosSimulatorRuntimeIdentifier } from "../targets/ios.js";

export const DEV_TARGETS = {
  macos: { name: "macos", framework: "net10.0-maccatalyst" },
  windows: { name: "windows", framework: "net10.0-windows10.0.19041.0" },
  android: { name: "android", framework: "net10.0-android" },
  ios: { name: "ios", framework: "net10.0-ios" },
} as const;

export type DevTargetName = keyof typeof DEV_TARGETS;
export type DevTarget = (typeof DEV_TARGETS)[DevTargetName];

/** `vidra dev` runs Vite and the C# loop; `vidra run` only launches the host. */
export type DevCommand = "dev" | "run";

/** Where an iOS session runs. The Simulator unless `--device` says otherwise. */
export type IosDestination = "simulator" | "device";

export interface DevOptions {
  readonly command: DevCommand;
  readonly target: DevTarget;
  readonly verbose: boolean;
  /** Start the Vite dev server alongside the host. */
  readonly vite: boolean;
  /** Drive the host through `dotnet watch` so C# edits reach the app. */
  readonly hotReload: boolean;
  /** Set exactly when the target is iOS. */
  readonly iosDestination: IosDestination | null;
}

type OptionsError = { readonly error: string };

const HOST_OS_REQUIREMENTS: Partial<
  Record<DevTargetName, { readonly platform: NodeJS.Platform; readonly error: string }>
> = {
  macos: { platform: "darwin", error: "the macOS target can only run on macOS" },
  ios: { platform: "darwin", error: "the iOS target needs a Mac with Xcode" },
  windows: { platform: "win32", error: "the Windows target can only run on Windows" },
};

const isDevTargetName = (name: string): name is DevTargetName =>
  Object.hasOwn(DEV_TARGETS, name);

export const resolveIosDestination = (
  targetName: string,
  args: Record<string, unknown>,
): IosDestination | OptionsError | null => {
  const flag = args["device"] ? "device" : args["simulator"] ? "simulator" : null;
  if (targetName !== "ios") {
    return flag ? { error: `--${flag} only applies to --target ios` } : null;
  }
  if (args["device"] && args["simulator"]) {
    return { error: "--device and --simulator are mutually exclusive" };
  }
  return flag ?? "simulator";
};

/** Validates the command line for `command`, defaulting the target to this machine's OS. */
export const resolveDevOptions = (
  args: ParsedArgs,
  command: DevCommand,
  platform: NodeJS.Platform = process.platform,
): DevOptions | OptionsError => {
  const targetName = args["target"] ? String(args["target"]) : detectPlatform();
  if (!isDevTargetName(targetName)) {
    const supported = Object.keys(DEV_TARGETS).join(", ");
    return { error: `unsupported target: ${targetName} — supported: ${supported}` };
  }

  const iosDestination = resolveIosDestination(targetName, args);
  if (iosDestination !== null && typeof iosDestination === "object") {
    return iosDestination;
  }

  const hostOs = HOST_OS_REQUIREMENTS[targetName];
  if (hostOs && hostOs.platform !== platform) {
    return { error: hostOs.error };
  }

  const isDev = command === "dev";
  return {
    command,
    target: DEV_TARGETS[targetName],
    verbose: !!args["verbose"],
    vite: isDev,
    hotReload: isDev && !args["no-hot-reload"],
    iosDestination,
  };
};

/** The Simulator and a device are separate builds, told apart by runtime identifier. */
export const iosRuntimeIdentifier = (
  destination: IosDestination | null,
): string | undefined => {
  if (destination === null) return undefined;
  return destination === "device" ? "ios-arm64" : iosSimulatorRuntimeIdentifier();
};
