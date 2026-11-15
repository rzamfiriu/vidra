import { ensureMauiWorkload } from "@vidra-dev/cli-shared/dotnet-toolchain";
import { dim, row } from "@vidra-dev/cli-shared/theme";
import { parseArgs } from "@vidra-dev/cli-shared/utils";
import type { VidraConfigContext } from "../config.js";
import { syncVidraConfig, watchVidraConfig } from "../dev/config-sync.js";
import {
  reportHostLaunchFailure,
  resolveHostLauncher,
  type HostContext,
  type HostLauncher,
} from "../dev/hosts/index.js";
import { iosRuntimeIdentifier, resolveDevOptions, type DevCommand } from "../dev/options.js";
import { createDevSession } from "../dev/session.js";
import { selectDevServerUrl } from "../dev-port.js";
import { detectProject } from "../project.js";

const DEFAULT_DEV_URL = "http://localhost:5173";
const DEFAULT_BUILD_CONFIG = "Debug";

export const devCommand = (argv: string[]): Promise<void> => startSession(argv, "dev");

// `vidra run` builds and launches only the native host, without the Vite dev
// server (use it when you're serving the UI separately). It launches the host
// the same robust way `dev` falls back to — build, then spawn the produced
// binary directly — instead of MSBuild's `-t:Run` target (see dotnetBuild).
export const runCommand = (argv: string[]): Promise<void> => startSession(argv, "run");

const exitWithError = (message: string): never => {
  console.error(row({ glyph: "error", detail: dim(message) }));
  return process.exit(1);
};

const resolveHostLauncherOrExit = (ctx: HostContext): HostLauncher => {
  try {
    return resolveHostLauncher(ctx);
  } catch (error) {
    reportHostLaunchFailure(error);
    return process.exit(1);
  }
};

const startSession = async (argv: string[], command: DevCommand): Promise<void> => {
  const options = resolveDevOptions(parseArgs(["_", "_", ...argv]), command);
  if ("error" in options) return exitWithError(options.error);
  const { target } = options;

  const project = detectProject(process.cwd());
  const configContext: VidraConfigContext = { command, mode: "development", target: target.name };
  await syncVidraConfig(project, configContext);

  // Fail fast, before starting Vite, if the MAUI workload the host build needs
  // isn't installed; offers to install it when the session is interactive.
  if (!(await ensureMauiWorkload({ csprojPath: project.csprojPath, target: target.name }))) {
    return process.exit(1);
  }

  const configuredUrl = process.env.VIDRA_DEV_URL || DEFAULT_DEV_URL;
  const hostContext: HostContext = {
    project,
    target,
    buildConfig: process.env.VIDRA_BUILD_CONFIG || DEFAULT_BUILD_CONFIG,
    devUrl: options.vite ? await selectDevServerUrl(configuredUrl) : configuredUrl,
    verbose: options.verbose,
    iosDestination: options.iosDestination,
    runtimeIdentifier: iosRuntimeIdentifier(options.iosDestination),
  };
  const session = createDevSession(
    { ...hostContext, command, vite: options.vite, hotReload: options.hotReload },
    resolveHostLauncherOrExit(hostContext),
  );

  const stopWatchingConfig = watchVidraConfig(project.root, async () => {
    const changes = await syncVidraConfig(project, configContext);
    if (changes.bridgePolicyChanged) {
      await session.restartHostForBridgePolicyChange();
    } else if (changes.accessFingerprintChanged) {
      console.log(
        row({
          glyph: "done",
          detail: dim("vidra.config.ts updated — refreshing frontend access fingerprint"),
        }),
      );
    }
  });

  try {
    await session.run();
  } finally {
    stopWatchingConfig();
  }
};
