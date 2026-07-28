import { describe, it, expect } from "vitest";
import {
  buildViteArgs,
  buildDotnetWatchArgs,
  classifyWatchLine,
  dotnetWatchEnv,
  watchReaction,
  watchStrategyFor,
  type WatchStrategy,
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

describe("watchStrategyFor", () => {
  // Deltas do work on Mac Catalyst — in about half of sessions; the other half
  // lose the hot-reload agent's WebSocket while idle (dotnet/sdk#55488). That
  // is not predictable from the platform, so every session asks for the real
  // thing and downgrades only on evidence.
  it.each(["macos", "windows"] as const)(
    "starts %s sessions on the delta loop",
    (target) => {
      expect(watchStrategyFor(target)).toBe("delta");
    },
  );
});

describe("buildDotnetWatchArgs", () => {
  const base = {
    csprojPath: "/proj/src/App.Host/App.Host.csproj",
    framework: "net10.0-maccatalyst",
    buildConfig: "Debug",
    verbose: false,
    strategy: "rebuild" as WatchStrategy,
  };

  it("asks the watcher only to build under the rebuild strategy", () => {
    expect(buildDotnetWatchArgs(base)).toEqual([
      "watch",
      "--project",
      "/proj/src/App.Host/App.Host.csproj",
      "--non-interactive",
      "build",
      "-f",
      "net10.0-maccatalyst",
      "-c",
      "Debug",
    ]);
  });

  it("spawns the Catalyst app as a child instead of handing it to open(1)", () => {
    // Without this the run target calls `open`, which returns immediately: the
    // app detaches to launchd, `dotnet run` exits 0, and the session never sees
    // the readiness sentinel the app prints.
    expect(
      buildDotnetWatchArgs({
        ...base,
        framework: "net10.0-maccatalyst",
        strategy: "delta",
      }),
    ).toContain("--property:RunWithOpen=false");
  });

  it.each([
    { framework: "net10.0-windows10.0.19041.0", strategy: "delta" as WatchStrategy },
    { framework: "net10.0-maccatalyst", strategy: "rebuild" as WatchStrategy },
  ])("leaves RunWithOpen alone for %o", (opts) => {
    // Windows has no such property, and under "rebuild" the watcher never runs
    // the app at all.
    expect(buildDotnetWatchArgs({ ...base, ...opts })).not.toContain(
      "--property:RunWithOpen=false",
    );
  });

  it("lets the watcher run the app under the delta strategy", () => {
    expect(
      buildDotnetWatchArgs({
        ...base,
        framework: "net10.0-windows10.0.19041.0",
        strategy: "delta",
      }),
    ).toEqual([
      "watch",
      "--project",
      "/proj/src/App.Host/App.Host.csproj",
      "--non-interactive",
      "run",
      "-f",
      "net10.0-windows10.0.19041.0",
      "-c",
      "Debug",
    ]);
  });

  it("places --verbose among the watch options, before the command", () => {
    const args = buildDotnetWatchArgs({ ...base, verbose: true });
    expect(args.indexOf("--verbose")).toBeGreaterThan(-1);
    expect(args.indexOf("--verbose")).toBeLessThan(args.indexOf("build"));
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
      DOTNET_CLI_UI_LANGUAGE: "en",
    });
  });

  it("pins the child's language, because the session parses its output", () => {
    // A localized SDK prints "Génération réussie" instead of "Build succeeded",
    // which would leave the rebuild loop with nothing to trigger on.
    expect(dotnetWatchEnv("http://localhost:5173").DOTNET_CLI_UI_LANGUAGE).toBe(
      "en",
    );
  });
});

describe("classifyWatchLine", () => {
  it.each([
    "dotnet watch \u{1F525} [App (net10.0-maccatalyst)] Further changes won't be applied to this process.",
    "dotnet watch : Further changes won't be applied to this process.",
  ])("recognizes the dead delta channel: %s", (line) => {
    expect(classifyWatchLine(line)).toBe("deltaChannelDead");
  });

  it("does not mistake the debug-level variant for it", () => {
    // "Previous changes failed to apply. Further changes are not applied to
    // this process." is LogDebug, i.e. invisible at the verbosity vidra dev
    // runs the watcher at — matching it would be matching nothing.
    expect(
      classifyWatchLine(
        "dotnet watch : Previous changes failed to apply. Further changes are not applied to this process.",
      ),
    ).not.toBe("deltaChannelDead");
  });

  it.each([
    // The VidraPage sentinel — the version-stable signal (e.g. the .NET
    // 10.0.2xx watcher prints no "Started" message of its own).
    "[vidra] host ready",
    "dotnet watch : Started",
    "dotnet watch \u{1F680} Started",
    "dotnet watch : Application started. Press Ctrl+C to shut down.",
    "dotnet watch ⌚ Launched 'MyApp.Host' with process id 4242",
  ])("recognizes app start: %s", (line) => {
    expect(classifyWatchLine(line)).toBe("appStarted");
  });

  it.each([
    "dotnet watch : Waiting for a file to change before restarting dotnet...",
    "dotnet watch ⌚ Waiting for a file to change before restarting ...",
  ])("recognizes the idle-after-exit state: %s", (line) => {
    expect(classifyWatchLine(line)).toBe("appWaiting");
  });

  it("flags a blocking build failure", () => {
    expect(
      classifyWatchLine("dotnet watch : Fix the error to continue or press Ctrl+C to exit."),
    ).toBe("buildBlocked");
  });

  it.each(["Build succeeded.", "    Build succeeded."])(
    "reads MSBuild's success summary: %s",
    (line) => {
      expect(classifyWatchLine(line)).toBe("buildSucceeded");
    },
  );

  it.each(["Build FAILED.", "    Build FAILED."])(
    "reads MSBuild's failure summary: %s",
    (line) => {
      expect(classifyWatchLine(line)).toBe("buildFailed");
    },
  );

  it.each([
    // The summary is anchored to the start of the line, so prose that merely
    // mentions it — an app log, a compiler message — is not the summary.
    "[MainPage] the build succeeded earlier",
    "warning: this build failed to embed a resource",
  ])("does not mistake prose for the build summary: %s", (line) => {
    expect(classifyWatchLine(line)).toBeNull();
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

describe("watchReaction", () => {
  const rebuild = (
    over: Partial<Parameters<typeof watchReaction>[1]> = {},
  ): Parameters<typeof watchReaction>[1] => ({
    strategy: "rebuild",
    hostLaunched: false,
    buildOutcome: null,
    everBuilt: false,
    ...over,
  });
  const delta = (
    over: Partial<Parameters<typeof watchReaction>[1]> = {},
  ): Parameters<typeof watchReaction>[1] => ({
    strategy: "delta",
    hostLaunched: false,
    buildOutcome: null,
    everBuilt: false,
    ...over,
  });

  describe("rebuild strategy (macOS)", () => {
    // This is the fix for the bug: nothing else launches the app, so the
    // successful build has to.
    it("launches the app on the first successful build", () => {
      expect(watchReaction("buildSucceeded", rebuild())).toBe("launchHost");
    });

    it("relaunches on every later successful build", () => {
      expect(watchReaction("buildSucceeded", rebuild({ hostLaunched: true }))).toBe(
        "launchHost",
      );
    });

    it("reports a failed build as soon as MSBuild says so", () => {
      expect(watchReaction("buildFailed", rebuild())).toBe("reportBuildFailed");
    });

    it.each(["appWaiting", "buildBlocked"] as const)(
      "stays quiet on %s once the cycle's outcome was reported",
      (event) => {
        expect(
          watchReaction(event, rebuild({ buildOutcome: "succeeded", everBuilt: true })),
        ).toBe("none");
        expect(
          watchReaction(event, rebuild({ buildOutcome: "failed", everBuilt: true })),
        ).toBe("none");
      },
    );

    it("speaks up if the watcher goes idle without ever building", () => {
      expect(watchReaction("appWaiting", rebuild())).toBe("reportEarlyExit");
    });

    it("does not cry stuck on a quiet cycle once something has built", () => {
      // watch writes the idle line to stderr and MSBuild the summary to stdout;
      // a session that has built before is not parked, whatever order they land
      // in.
      expect(
        watchReaction("appWaiting", rebuild({ everBuilt: true })),
      ).toBe("none");
    });

    it("marks the host ready when it announces itself", () => {
      expect(watchReaction("appStarted", rebuild())).toBe("markHostReady");
    });
  });

  describe("delta strategy (Windows)", () => {
    it("marks the host ready on the first start, then stays quiet", () => {
      expect(watchReaction("appStarted", delta())).toBe("markHostReady");
      expect(watchReaction("appStarted", delta({ hostLaunched: true }))).toBe(
        "none",
      );
    });

    it("treats an idle line after a launch as the app being gone", () => {
      expect(watchReaction("appWaiting", delta({ hostLaunched: true }))).toBe(
        "reportAppIdle",
      );
    });

    it("blames the build when it failed before the first launch", () => {
      expect(watchReaction("appWaiting", delta({ buildOutcome: "failed" }))).toBe(
        "reportBuildFailed",
      );
      expect(
        watchReaction("buildBlocked", delta({ buildOutcome: "failed" })),
      ).toBe("reportBuildFailed");
    });

    it("does not blame the build when the app simply died young", () => {
      expect(watchReaction("appWaiting", delta())).toBe("reportEarlyExit");
    });

    it("ignores build summaries — the watcher owns the launch here", () => {
      expect(watchReaction("buildSucceeded", delta())).toBe("none");
      expect(watchReaction("buildFailed", delta())).toBe("none");
    });
  });

  describe("the delta channel dying", () => {
    it("moves a delta session to the rebuild loop", () => {
      expect(watchReaction("deltaChannelDead", delta())).toBe("switchToRebuild");
      expect(
        watchReaction("deltaChannelDead", delta({ hostLaunched: true })),
      ).toBe("switchToRebuild");
    });

    it("is inert once the session is already rebuilding", () => {
      // The warning outlives the watcher that printed it; reacting again would
      // restart the loop we just switched to.
      expect(watchReaction("deltaChannelDead", rebuild())).toBe("none");
    });
  });

  it("does nothing for unclassified output", () => {
    expect(watchReaction(null, rebuild())).toBe("none");
    expect(watchReaction(null, delta())).toBe("none");
  });
});
