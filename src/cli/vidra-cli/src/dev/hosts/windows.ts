import path from "node:path";
import { findWindowsExecutableRecursive } from "../../artifacts.js";
import { spawnPiped } from "../processes.js";
import { buildHost, hostOutputDir } from "./dotnet-build.js";
import {
  announceLaunching,
  devServerEnv,
  HostLaunchError,
  type HostContext,
  type HostLauncher,
} from "./host.js";

/**
 * Builds first, then spawns the produced .exe directly. A single
 * `dotnet build -t:Run` on an unpackaged MAUI Windows app
 * (`WindowsPackageType=None`) execs the binary before the WindowsAppSDK native
 * assets are laid out beside it, so the app can't resolve its deps and dies
 * with a bare `MSB3073 ... exited with code 3` (ERROR_PATH_NOT_FOUND). Building
 * as a discrete step and then launching the binary is the documented
 * workaround; see dotnet/maui#13942 and dotnet/maui#5975.
 */
export const createWindowsHostLauncher = (ctx: HostContext): HostLauncher => ({
  launch: ({ build }) => {
    if (build) buildHost(ctx);

    // The .exe sits in a RID subfolder whose name varies by SDK (`win-x64`,
    // `win10-x64`, `win-arm64`, …).
    const outputDir = hostOutputDir(ctx);
    const exe = findWindowsExecutableRecursive(outputDir, ctx.project.projectName);
    if (!exe) {
      throw new HostLaunchError(`could not find the host .exe under ${outputDir}`);
    }

    announceLaunching(path.basename(exe));
    const child = spawnPiped(exe, [], {
      cwd: path.dirname(exe),
      env: devServerEnv(ctx.devUrl),
    });
    return { child, label: path.basename(exe) };
  },
});
