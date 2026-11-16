import path from "node:path";
import { dim, footer, lime, row, value } from "@vidra-dev/cli-shared/theme";
import { findAppBundleRecursive, findMacExecutable } from "../../artifacts.js";
import { signMacAppBundleIfPossible } from "../../signing.js";
import { spawnPiped } from "../processes.js";
import { buildHost, hostOutputDir } from "./dotnet-build.js";
import {
  announceLaunching,
  devServerEnv,
  HostLaunchError,
  type HostContext,
  type HostLauncher,
} from "./host.js";

const printMacLaunchHint = (): void => {
  const bullet = dim("•");
  console.error();
  console.error(
    row({ glyph: "manual", label: "the host built but the app couldn't launch." }),
  );
  console.error(
    footer(dim("on macOS this is usually code signing / Gatekeeper for a locally built app:")),
  );
  console.error(
    `      ${bullet} ${dim("install full Xcode, then run")} ${lime("vidra doctor")} ${dim("to verify")}`,
  );
  console.error(
    `      ${bullet} ${dim("approve it once in Finder: right-click the")} ${value(".app")} ${dim("and choose")} ${value("Open")}`,
  );
  console.error(
    `      ${bullet} ${dim("or provide a signing identity via")} ${value("VIDRA_MACOS_CODESIGN_KEY")}`,
  );
  console.error();
};

/** Locates the built `.app`, signs it if we can, and spawns its executable. */
export const createMacosHostLauncher = (ctx: HostContext): HostLauncher => ({
  launch: ({ build }) => {
    if (build) buildHost(ctx);

    const outputDir = hostOutputDir(ctx);
    const appBundle = findAppBundleRecursive(outputDir);
    if (!appBundle) {
      throw new HostLaunchError(`could not find .app bundle in ${outputDir}`);
    }

    signMacAppBundleIfPossible(appBundle, {
      verbose: ctx.verbose,
      log: console.log,
      warn: console.warn,
    });

    const binary = findMacExecutable(appBundle);
    if (!binary) {
      throw new HostLaunchError(`could not find the app executable in ${appBundle}`);
    }

    announceLaunching(path.basename(appBundle));
    const child = spawnPiped(binary, [], {
      cwd: ctx.project.root,
      env: devServerEnv(ctx.devUrl),
    });
    return { child, label: path.basename(binary) };
  },
  printLaunchFailureHint: printMacLaunchHint,
});
