import { describe, expect, it } from "vitest";
import {
  parseDevicectlDevices,
  parseSimulators,
  pickDevice,
  pickSimulator,
  type IosDevice,
} from "../ios-devices.js";

const simctlOutput = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
      { udid: "OLD-PHONE", name: "iPhone 16", state: "Shutdown", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [
      { udid: "NEW-PAD", name: "iPad Air 11-inch (M3)", state: "Shutdown", isAvailable: true },
      { udid: "NEW-PHONE", name: "iPhone 17", state: "Shutdown", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [
      { udid: "WATCH", name: "Apple Watch Series 11", state: "Booted", isAvailable: true },
    ],
  },
});

describe("simulators", () => {
  it("keeps iOS runtimes only, with their versions", () => {
    const simulators = parseSimulators(simctlOutput);
    expect(simulators.map((simulator) => simulator.udid)).toEqual([
      "OLD-PHONE",
      "NEW-PAD",
      "NEW-PHONE",
    ]);
    expect(simulators[1].runtimeVersion).toEqual([26, 1]);
  });

  it("picks an iPhone on the newest runtime when nothing is booted", () => {
    expect(pickSimulator(parseSimulators(simctlOutput))?.udid).toBe("NEW-PHONE");
  });

  it("prefers one already booted, whatever its runtime", () => {
    const simulators = parseSimulators(simctlOutput).map((simulator) => ({
      ...simulator,
      booted: simulator.udid === "OLD-PHONE",
    }));
    expect(pickSimulator(simulators)?.udid).toBe("OLD-PHONE");
  });

  it("takes the one asked for by name or UDID, or none", () => {
    const simulators = parseSimulators(simctlOutput);
    expect(pickSimulator(simulators, "iPad Air 11-inch (M3)")?.udid).toBe("NEW-PAD");
    expect(pickSimulator(simulators, "OLD-PHONE")?.udid).toBe("OLD-PHONE");
    expect(pickSimulator(simulators, "iPhone 3G")).toBeNull();
  });
});

describe("devices", () => {
  const devicectlOutput = JSON.stringify({
    result: {
      devices: [
        {
          identifier: "AAAA",
          deviceProperties: { name: "Ana's iPhone" },
          hardwareProperties: { platform: "iOS", reality: "physical", udid: "00008110-A" },
          connectionProperties: { pairingState: "paired", tunnelState: "disconnected" },
        },
        {
          identifier: "BBBB",
          deviceProperties: { name: "Old iPad" },
          hardwareProperties: { platform: "iOS", reality: "physical", udid: "00008020-B" },
          connectionProperties: { pairingState: "paired", tunnelState: "unavailable" },
        },
        {
          identifier: "CCCC",
          deviceProperties: { name: "Living Room" },
          hardwareProperties: { platform: "tvOS", reality: "physical" },
          connectionProperties: { pairingState: "paired", tunnelState: "connected" },
        },
      ],
    },
  });

  it("keeps physical iOS devices, and knows which are reachable", () => {
    expect(parseDevicectlDevices(devicectlOutput)).toEqual([
      { identifier: "AAAA", name: "Ana's iPhone", udid: "00008110-A", available: true },
      { identifier: "BBBB", name: "Old iPad", udid: "00008020-B", available: false },
    ]);
  });

  it("picks the only reachable device without asking", () => {
    const pick = pickDevice(parseDevicectlDevices(devicectlOutput));
    expect(pick).toEqual({ device: expect.objectContaining({ identifier: "AAAA" }) });
  });

  it("asks which one when several are reachable", () => {
    const devices: IosDevice[] = [
      { identifier: "A", name: "One", available: true },
      { identifier: "B", name: "Two", available: true },
    ];
    expect(pickDevice(devices)).toEqual({
      error: "several devices are connected — set VIDRA_IOS_DEVICE to one of: One, Two",
    });
    expect(pickDevice(devices, "Two")).toEqual({ device: devices[1] });
  });

  it("says why a requested device cannot be used", () => {
    const devices = parseDevicectlDevices(devicectlOutput);
    expect(pickDevice(devices, "00008020-B")).toEqual({
      error: "Old iPad is not connected, or not paired with this Mac",
    });
    expect(pickDevice([], undefined)).toEqual({
      error: "no iPhone or iPad is connected — plug one in and trust this Mac",
    });
  });
});
