import { execFileSync } from "node:child_process";
import { dim, taggedRow, value } from "@vidra-dev/cli-shared/theme";
import { spawnPiped } from "../processes.js";
import { dotnetBuild, requireApplicationId } from "./dotnet-build.js";
import { HostLaunchError, type HostContext, type HostLauncher } from "./host.js";
import { localNetworkAddress, resolveDeviceDevHost } from "./network.js";

/** `logcat --pid` arrived in API 24 (Android 7.0). */
const LOGCAT_PID_FILTER_MIN_API = 24;

export const parseAdbDevices = (output: string): string[] =>
  output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]);

export const selectAndroidDevUrl = (
  serial: string,
  port: string,
  reverseSucceeded: boolean,
  lanAddress?: string,
): string => {
  if (reverseSucceeded) return `http://127.0.0.1:${port}`;
  if (serial.startsWith("emulator-")) return `http://10.0.2.2:${port}`;
  if (lanAddress) return `http://${lanAddress}:${port}`;
  throw new HostLaunchError(
    "adb reverse failed and no LAN address is available; connect the device by USB or set up host networking",
  );
};

export const parseAndroidPid = (output: string, applicationId: string): string => {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return "";

  const pidIndex = lines[0].split(/\s+/).indexOf("PID");
  const columns = lines
    .slice(1)
    .map((line) => line.split(/\s+/))
    .find((fields) => fields.at(-1) === applicationId);
  return columns?.[pidIndex >= 0 ? pidIndex : 1] ?? "";
};

/** The device to deploy to: `ANDROID_SERIAL`, else the only one connected. */
const resolveAndroidDevice = (): string => {
  let devices: string[];
  try {
    devices = parseAdbDevices(execFileSync("adb", ["devices"], { encoding: "utf8" }));
  } catch {
    throw new HostLaunchError("adb is not installed or not on PATH");
  }

  const requested = process.env.ANDROID_SERIAL?.trim();
  if (requested) {
    if (devices.includes(requested)) return requested;
    throw new HostLaunchError(`ANDROID_SERIAL device is not connected: ${requested}`);
  }
  if (devices.length === 1) return devices[0];
  throw new HostLaunchError(
    devices.length === 0
      ? "no Android emulator or device is connected"
      : `multiple Android devices are connected — set ANDROID_SERIAL (${devices.join(", ")})`,
  );
};

/**
 * Installs with MSBuild's `Install` target, starts the app with `am start`, and
 * streams its logcat. Killing logcat does not stop the app, hence `stopApp`.
 *
 * Install is an MSBuild target, so every launch goes through `dotnet build`,
 * even straight after `dotnet watch build`; that second build is incremental.
 */
export const createAndroidHostLauncher = (ctx: HostContext): HostLauncher => {
  const serial = resolveAndroidDevice();
  const applicationId = requireApplicationId(ctx.project.csprojPath);

  const adb = (...args: string[]): string =>
    execFileSync("adb", ["-s", serial, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const tryAdb = (...args: string[]): string => {
    try {
      return adb(...args);
    } catch {
      return "";
    }
  };

  /** Points the device at the dev server: through `adb reverse` if it works. */
  const forwardDevServer = (): string => {
    const port = new URL(ctx.devUrl).port;
    let reversed = true;
    if (port) {
      try {
        adb("reverse", `tcp:${port}`, `tcp:${port}`);
      } catch {
        reversed = false;
      }
    }
    const deviceDevUrl = selectAndroidDevUrl(
      serial,
      port,
      reversed,
      resolveDeviceDevHost(ctx.devUrl, process.env.VIDRA_ANDROID_HOST, localNetworkAddress()),
    );
    if (!reversed) {
      console.log(
        taggedRow("manual", "host", `${dim("adb reverse unavailable — using")} ${value(deviceDevUrl)}`),
      );
    }
    return deviceDevUrl;
  };

  const startApp = (deviceDevUrl: string): string => {
    adb("logcat", "-c");
    adb("shell", "am", "force-stop", applicationId);
    adb(
      "shell", "am", "start", "-W",
      "-a", "android.intent.action.MAIN",
      "-c", "android.intent.category.LAUNCHER",
      "-p", applicationId,
      "--es", "VIDRA_DEV_URL", deviceDevUrl,
    );
    const pid =
      tryAdb("shell", "pidof", "-s", applicationId) ||
      parseAndroidPid(adb("shell", "ps"), applicationId);
    if (!pid) throw new HostLaunchError(`Android app ${applicationId} did not start`);
    return pid;
  };

  const logcatArgs = (pid: string): string[] => {
    const api = Number(tryAdb("shell", "getprop", "ro.build.version.sdk"));
    if (api >= LOGCAT_PID_FILTER_MIN_API) return ["-s", serial, "logcat", "--pid", pid];

    console.log(
      taggedRow(
        "manual",
        "host",
        dim("API 21–23: logcat cannot filter by process; showing device-wide logs"),
      ),
    );
    return ["-s", serial, "logcat"];
  };

  return {
    launch: () => {
      console.log(
        taggedRow(
          "active",
          "host",
          `${dim("building and installing")} ${value(ctx.target.framework)} ${dim(`on ${serial}…`)}`,
        ),
      );
      dotnetBuild(
        ctx,
        ["-t:Install", `-p:AndroidDeviceSerial=${serial}`],
        "Android build/install failed",
      );

      const pid = startApp(forwardDevServer());
      console.log(
        taggedRow("active", "host", `${dim("launched")} ${value(applicationId)} ${dim(`· logcat pid ${pid}`)}`),
      );
      const logcat = spawnPiped("adb", logcatArgs(pid), { cwd: ctx.project.root });
      return { child: logcat, label: applicationId };
    },
    stopApp: () => {
      try {
        adb("shell", "am", "force-stop", applicationId);
      } catch {
        // The device may already be disconnected; child cleanup still proceeds.
      }
    },
  };
};
