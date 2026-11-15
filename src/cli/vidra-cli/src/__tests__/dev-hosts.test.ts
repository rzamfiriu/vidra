import { describe, it, expect } from "vitest";
import {
  parseAdbDevices,
  parseAndroidPid,
  selectAndroidDevUrl,
} from "../dev/hosts/android.js";
import { resolveDeviceDevHost } from "../dev/hosts/network.js";

describe("parseAdbDevices", () => {
  it("returns only fully connected devices", () => {
    expect(
      parseAdbDevices(
        "List of devices attached\nemulator-5554\tdevice\nphone\toffline\npending\tunauthorized\n",
      ),
    ).toEqual(["emulator-5554"]);
  });
});

describe("Android device compatibility", () => {
  it("uses adb reverse, emulator host routing, then LAN in that order", () => {
    expect(selectAndroidDevUrl("phone", "5173", true, "192.168.1.5"))
      .toBe("http://127.0.0.1:5173");
    expect(selectAndroidDevUrl("emulator-5554", "5173", false, "192.168.1.5"))
      .toBe("http://10.0.2.2:5173");
    expect(selectAndroidDevUrl("phone", "5173", false, "192.168.1.5"))
      .toBe("http://192.168.1.5:5173");
  });

  it("gives up on a physical device with no route to the dev server", () => {
    expect(() => selectAndroidDevUrl("phone", "5173", false)).toThrow(/adb reverse failed/);
  });

  it("reads the app pid from legacy Android ps output", () => {
    const output = [
      "USER PID PPID VSIZE RSS WCHAN PC NAME",
      "u0_a123 4321 200 100 20 ffffffff 0 com.example.app",
    ].join("\n");
    expect(parseAndroidPid(output, "com.example.app")).toBe("4321");
  });

  it("prefers an Android host override, then an explicit dev URL host", () => {
    expect(
      resolveDeviceDevHost(
        "http://192.168.1.20:5173",
        "10.1.2.3",
        "172.17.0.1",
      ),
    ).toBe("10.1.2.3");
    expect(
      resolveDeviceDevHost(
        "http://192.168.1.20:5173",
        undefined,
        "172.17.0.1",
      ),
    ).toBe("192.168.1.20");
    expect(
      resolveDeviceDevHost(
        "http://localhost:5173",
        undefined,
        "172.17.0.1",
      ),
    ).toBe("172.17.0.1");
  });
});
