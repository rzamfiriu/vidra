import { execFileSync } from "node:child_process";
import { formatBuildError } from "@vidra-dev/cli-shared/exec";
import { dim, taggedRow, value } from "@vidra-dev/cli-shared/theme";
import {
  bootSimulator,
  listDevices,
  listSimulators,
  pickDevice,
  pickSimulator,
  type DevicePick,
  type IosDevice,
  type IosSimulator,
} from "../../ios-devices.js";
import { findAppBundleRecursive } from "../../artifacts.js";
import { spawnPiped } from "../processes.js";
import { buildHost, hostOutputDir, requireApplicationId } from "./dotnet-build.js";
import { HostLaunchError, type HostContext, type HostLauncher, type LaunchedHost } from "./host.js";
import { localNetworkAddress, resolveDeviceDevHost } from "./network.js";

/** Installs a built `.app` and launches it attached to its console. */
type Deploy = (app: string, bundleId: string) => LaunchedHost;

const resolveIosSimulator = (): IosSimulator => {
  const requested = process.env.VIDRA_IOS_SIMULATOR;
  let simulator: IosSimulator | null;
  try {
    simulator = pickSimulator(listSimulators(), requested);
  } catch {
    throw new HostLaunchError("xcrun simctl failed — is Xcode installed and selected?");
  }
  if (simulator) return simulator;
  throw new HostLaunchError(
    requested
      ? `VIDRA_IOS_SIMULATOR matches no available simulator: ${requested}`
      : "no iOS simulator is installed — xcodebuild -downloadPlatform iOS",
  );
};

const resolveIosDevice = (): IosDevice => {
  let pick: DevicePick;
  try {
    pick = pickDevice(listDevices(), process.env.VIDRA_IOS_DEVICE);
  } catch {
    throw new HostLaunchError("xcrun devicectl failed — it needs Xcode 15 or later");
  }
  if ("device" in pick) return pick.device;
  throw new HostLaunchError(pick.error);
};

const deployToSimulator = (ctx: HostContext, simulator: IosSimulator): Deploy => (app, bundleId) => {
  console.log(
    taggedRow(
      "active",
      "host",
      `${dim("installing on")} ${value(simulator.name)} ${dim(`(iOS ${simulator.runtimeVersion.join(".")})…`)}`,
    ),
  );
  try {
    bootSimulator(simulator);
    execFileSync("xcrun", ["simctl", "install", simulator.udid, app], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new HostLaunchError("Simulator boot/install failed", { output: formatBuildError(error) });
  }

  const child = spawnPiped(
    "xcrun",
    ["simctl", "launch", "--console-pty", "--terminate-running-process", simulator.udid, bundleId],
    { cwd: ctx.project.root, env: { ...process.env, SIMCTL_CHILD_VIDRA_DEV_URL: ctx.devUrl } },
  );
  return { child, label: bundleId };
};

const deployToDevice = (ctx: HostContext, device: IosDevice): Deploy => (app, bundleId) => {
  // localhost on the phone is the phone. Vite listens on every interface for
  // a device session, so point the app at this Mac's LAN address.
  const port = new URL(ctx.devUrl).port;
  const host = resolveDeviceDevHost(ctx.devUrl, process.env.VIDRA_IOS_HOST, localNetworkAddress());
  if (!host) {
    throw new HostLaunchError(
      "no LAN address for the device to reach the dev server — join a network, or set VIDRA_IOS_HOST",
    );
  }
  const deviceDevUrl = `http://${host}${port ? `:${port}` : ""}`;

  console.log(
    taggedRow(
      "active",
      "host",
      `${dim("installing on")} ${value(device.name)} ${dim(`· dev server ${deviceDevUrl}…`)}`,
    ),
  );
  try {
    execFileSync(
      "xcrun",
      ["devicectl", "device", "install", "app", "--device", device.identifier, app],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new HostLaunchError(`install on ${device.name} failed`, {
      output: formatBuildError(error),
      hint: "a locked device, or Developer Mode off (Settings → Privacy & Security), are the usual causes",
    });
  }

  const child = spawnPiped(
    "xcrun",
    [
      "devicectl", "device", "process", "launch",
      "--device", device.identifier,
      "--terminate-existing",
      "--console",
      "--environment-variables", JSON.stringify({ VIDRA_DEV_URL: deviceDevUrl }),
      bundleId,
    ],
    { cwd: ctx.project.root },
  );
  return { child, label: bundleId };
};

/**
 * Installs the built `.app` on the Simulator or a device and launches it
 * attached to its console, so the app's output (and the readiness sentinel)
 * streams back here. simctl and devicectl both forward signals to the app, so
 * terminating the child stops the app: relaunch and shutdown need nothing
 * iOS-specific.
 */
export const createIosHostLauncher = (ctx: HostContext): HostLauncher => {
  const deploy =
    ctx.iosDestination === "device"
      ? deployToDevice(ctx, resolveIosDevice())
      : deployToSimulator(ctx, resolveIosSimulator());

  return {
    launch: ({ build }) => {
      if (build) buildHost(ctx);

      const outputDir = hostOutputDir(ctx);
      const app = findAppBundleRecursive(outputDir);
      if (!app) throw new HostLaunchError(`could not find .app bundle in ${outputDir}`);
      return deploy(app, requireApplicationId(ctx.project.csprojPath));
    },
  };
};
