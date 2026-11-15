import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { execFileSync, spawnSync } from "node:child_process";

/**
 * Finding somewhere to run an iOS build: a Simulator through `simctl`, or a
 * plugged-in iPhone or iPad through `devicectl` (Xcode 15+, iOS 17+). Both
 * tools are asked for JSON, and the parsing is split from the calls so it can
 * be tested without Xcode.
 */

export interface IosSimulator {
  udid: string;
  name: string;
  /** e.g. `[26, 0]`, from the runtime identifier. */
  runtimeVersion: number[];
  booted: boolean;
}

/** `xcrun simctl list devices available --json`, iOS runtimes only. */
export const parseSimulators = (json: string): IosSimulator[] => {
  const runtimes = (JSON.parse(json) as {
    devices?: Record<string, { udid: string; name: string; state: string; isAvailable?: boolean }[]>;
  }).devices ?? {};
  return Object.entries(runtimes).flatMap(([runtime, devices]) => {
    const version = runtime.match(/SimRuntime\.iOS-([\d-]+)$/)?.[1];
    if (!version) return [];
    return devices
      .filter((device) => device.isAvailable !== false)
      .map((device) => ({
        udid: device.udid,
        name: device.name,
        runtimeVersion: version.split("-").map(Number),
        booted: device.state === "Booted",
      }));
  });
};

/**
 * The one asked for by UDID or name, else one already booted, else an iPhone
 * on the newest runtime: what Xcode would pick, without making anyone choose.
 */
export const pickSimulator = (
  simulators: IosSimulator[],
  requested?: string,
): IosSimulator | null => {
  const wanted = requested?.trim();
  const candidates = wanted
    ? simulators.filter((simulator) => simulator.udid === wanted || simulator.name === wanted)
    : simulators;
  const ranked = [...candidates].sort(
    (a, b) =>
      Number(b.booted) - Number(a.booted)
      || compareVersions(b.runtimeVersion, a.runtimeVersion)
      || Number(b.name.startsWith("iPhone")) - Number(a.name.startsWith("iPhone")),
  );
  return ranked[0] ?? null;
};

const compareVersions = (a: number[], b: number[]): number => {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

export const listSimulators = (): IosSimulator[] =>
  parseSimulators(
    execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

/** Boots it if it isn't, brings up Simulator.app on it, and waits until it can install. */
export const bootSimulator = (simulator: IosSimulator): void => {
  if (!simulator.booted) {
    // Fails with "Unable to boot device in current state: Booted" if it raced
    // us; bootstatus below is what decides whether it is usable.
    spawnSync("xcrun", ["simctl", "boot", simulator.udid], { stdio: "ignore" });
  }
  spawnSync("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", simulator.udid], {
    stdio: "ignore",
  });
  execFileSync("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
};

export interface IosDevice {
  identifier: string;
  name: string;
  udid?: string;
  /** Paired and reachable now, over USB or the network. */
  available: boolean;
}

interface DevicectlDevice {
  identifier: string;
  deviceProperties?: { name?: string };
  hardwareProperties?: { platform?: string; reality?: string; udid?: string };
  connectionProperties?: { pairingState?: string; tunnelState?: string };
}

/** `xcrun devicectl list devices --json-output <file>`, physical iOS devices only. */
export const parseDevicectlDevices = (json: string): IosDevice[] => {
  const devices = (JSON.parse(json) as { result?: { devices?: DevicectlDevice[] } }).result
    ?.devices ?? [];
  return devices
    .filter((device) =>
      device.hardwareProperties?.platform === "iOS"
      && device.hardwareProperties.reality !== "simulated")
    .map((device) => ({
      identifier: device.identifier,
      name: device.deviceProperties?.name ?? device.identifier,
      udid: device.hardwareProperties?.udid,
      available:
        device.connectionProperties?.pairingState === "paired"
        && device.connectionProperties.tunnelState !== "unavailable",
    }));
};

export type DevicePick =
  | { device: IosDevice }
  | { error: string };

export const pickDevice = (devices: IosDevice[], requested?: string): DevicePick => {
  const wanted = requested?.trim();
  if (wanted) {
    const match = devices.find((device) =>
      [device.identifier, device.udid, device.name].includes(wanted));
    if (!match) return { error: `VIDRA_IOS_DEVICE is not a known device: ${wanted}` };
    if (!match.available) return { error: `${match.name} is not connected, or not paired with this Mac` };
    return { device: match };
  }
  const available = devices.filter((device) => device.available);
  if (available.length === 1) return { device: available[0] };
  if (available.length === 0) {
    return {
      error: devices.length === 0
        ? "no iPhone or iPad is connected — plug one in and trust this Mac"
        : `${devices.map((device) => device.name).join(", ")}: paired but not reachable — unlock it, or reconnect the cable`,
    };
  }
  return {
    error: `several devices are connected — set VIDRA_IOS_DEVICE to one of: ${available
      .map((device) => device.name)
      .join(", ")}`,
  };
};

export const listDevices = (): IosDevice[] => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vidra-devicectl-"));
  try {
    const output = path.join(scratch, "devices.json");
    execFileSync("xcrun", ["devicectl", "list", "devices", "--quiet", "--json-output", output], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseDevicectlDevices(fs.readFileSync(output, "utf8"));
  } finally {
    fs.removeSync(scratch);
  }
};
