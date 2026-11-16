import type { DevTargetName } from "../options.js";
import { createAndroidHostLauncher } from "./android.js";
import type { HostContext, HostLauncher } from "./host.js";
import { createIosHostLauncher } from "./ios.js";
import { createMacosHostLauncher } from "./macos.js";
import { createWindowsHostLauncher } from "./windows.js";

export * from "./host.js";

const HOST_LAUNCHERS: Record<DevTargetName, (ctx: HostContext) => HostLauncher> = {
  macos: createMacosHostLauncher,
  windows: createWindowsHostLauncher,
  android: createAndroidHostLauncher,
  ios: createIosHostLauncher,
};

/**
 * Returns the launcher for the session's target, bound to the device or
 * simulator it deploys to. Picking that device runs `adb`/`xcrun`, and throws a
 * {@link HostLaunchError} when there is none, so call it before anything else
 * is started.
 */
export const resolveHostLauncher = (ctx: HostContext): HostLauncher =>
  HOST_LAUNCHERS[ctx.target.name](ctx);
