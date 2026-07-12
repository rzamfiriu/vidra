import { describe, it, expect } from "vitest";
import {
  buildViteArgs,
  buildDotnetWatchArgs,
  classifyWatchLine,
  dotnetWatchEnv,
} from "../commands/dev.js";

describe("buildViteArgs", () => {
  it("starts Vite on the port selected for the native host", () => {
    expect(buildViteArgs("http://localhost:6000/")).toEqual([
      "run",
      "dev",
      "--",
      "--port",
      "6000",
      "--strictPort",
    ]);
  });
});

describe("buildDotnetWatchArgs", () => {
  const base = {
    csprojPath: "/proj/src/App.Host/App.Host.csproj",
    framework: "net10.0-maccatalyst",
    buildConfig: "Debug",
    verbose: false,
    targetName: "macos" as const,
  };

  it("builds a non-interactive watch-run invocation for macOS", () => {
    expect(buildDotnetWatchArgs(base)).toEqual([
      "watch",
      "--project",
      "/proj/src/App.Host/App.Host.csproj",
      "--non-interactive",
      "run",
      "-f",
      "net10.0-maccatalyst",
      "-c",
      "Debug",
      "--property:RunWithOpen=false",
    ]);
  });

  it("omits the macOS-only RunWithOpen property on Windows", () => {
    const args = buildDotnetWatchArgs({
      ...base,
      framework: "net10.0-windows10.0.19041.0",
      targetName: "windows",
    });
    expect(args).not.toContain("--property:RunWithOpen=false");
    expect(args).toContain("net10.0-windows10.0.19041.0");
  });

  it("places --verbose among the watch options, before the run command", () => {
    const args = buildDotnetWatchArgs({ ...base, verbose: true });
    expect(args.indexOf("--verbose")).toBeGreaterThan(-1);
    expect(args.indexOf("--verbose")).toBeLessThan(args.indexOf("run"));
  });

  it("respects the configured build configuration", () => {
    const args = buildDotnetWatchArgs({ ...base, buildConfig: "Release" });
    expect(args).toContain("Release");
  });
});

describe("dotnetWatchEnv", () => {
  it("passes the dev url and auto-restart settings to dotnet watch", () => {
    expect(dotnetWatchEnv("http://localhost:5173")).toEqual({
      VIDRA_DEV_URL: "http://localhost:5173",
      DOTNET_WATCH_RESTART_ON_RUDE_EDIT: "1",
      DOTNET_WATCH_SUPPRESS_EMOJIS: "1",
      DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER: "1",
    });
  });
});

describe("classifyWatchLine", () => {
  it.each([
    // The VidraPage sentinel — the version-stable signal (e.g. the .NET
    // 10.0.2xx watcher prints no "Started" message of its own).
    "[vidra] host ready",
    "dotnet watch : Started",
    "dotnet watch \u{1F680} Started",
    "dotnet watch : Application started. Press Ctrl+C to shut down.",
    "dotnet watch \u231A Launched 'MyApp.Host' with process id 4242",
  ])("recognizes app start: %s", (line) => {
    expect(classifyWatchLine(line)).toBe("appStarted");
  });

  it.each([
    "dotnet watch : Waiting for a file to change before restarting dotnet...",
    "dotnet watch \u231A Waiting for a file to change before restarting ...",
  ])("recognizes the idle-after-exit state: %s", (line) => {
    expect(classifyWatchLine(line)).toBe("appWaiting");
  });

  it("flags a blocking build failure", () => {
    expect(
      classifyWatchLine("dotnet watch : Fix the error to continue or press Ctrl+C to exit."),
    ).toBe("buildBlocked");
  });

  it.each([
    // Prints before the first build — must NOT count as the app running.
    "dotnet watch : Hot reload enabled. For a list of supported edits, see https://aka.ms/dotnet/hot-reload.",
    // Prints right after a successful launch on .NET 10.0.3xx while the app
    // is still running — ambiguous, so it must NOT count as idle-after-exit.
    "dotnet watch : Waiting for changes",
    "dotnet watch : Building...",
    "dotnet watch : Restart requested.",
    "dotnet watch : [app (net10.0)] Exited",
    "  Determining projects to restore...",
    "  App.Host -> /proj/src/App.Host/bin/Debug/net10.0-maccatalyst/App.Host.dll",
    "error NETSDK1147: To build this project, the following workloads must be installed: maui-maccatalyst",
    "",
  ])("ignores other output: %s", (line) => {
    expect(classifyWatchLine(line)).toBeNull();
  });

  it("does not treat the app's own 'started' logs as a watch event", () => {
    expect(classifyWatchLine("[MainPage] background job started")).toBeNull();
  });
});
