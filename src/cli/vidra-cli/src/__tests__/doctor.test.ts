import { describe, it, expect } from "vitest";
import {
  looksLikeMissingWorkload,
  looksLikeMissingXcode,
  looksLikeXcodeTooOld,
  workloadSetVersion,
  macCatalystPackIsStale,
  newestPackVersion,
  diagnoseUpdateConfiguration,
} from "../doctor.js";

describe("looksLikeMissingWorkload", () => {
  it.each([
    "error NETSDK1147: To build this project, the following workloads must be installed: maui-maccatalyst",
    "The following workloads must be installed: maui-windows",
    "Workload(s) 'maui-maccatalyst' not found. Run `dotnet workload restore`.",
  ])("flags workload-related build errors", (output) => {
    expect(looksLikeMissingWorkload(output)).toBe(true);
  });

  it("ignores unrelated build errors", () => {
    expect(
      looksLikeMissingWorkload("error CS1002: ; expected [App.Host.csproj]"),
    ).toBe(false);
  });
});

describe("workloadSetVersion", () => {
  it("extracts the version from `dotnet workload list` output", () => {
    const out = [
      "Workload version: 10.0.201",
      "",
      "Installed Workload Id      Manifest Version      Installation Source",
      "maui-maccatalyst           10.0.20/10.0.100      SDK 10.0.200",
    ].join("\n");
    expect(workloadSetVersion(out)).toBe("10.0.201");
  });

  it("handles four-part and preview workload set versions", () => {
    expect(workloadSetVersion("Workload version: 10.0.300.3")).toBe("10.0.300.3");
    expect(workloadSetVersion("Workload version: 11.0.100-preview.5.26309.3")).toBe(
      "11.0.100-preview.5.26309.3",
    );
  });

  it("is undefined when the line is absent", () => {
    expect(workloadSetVersion("Installed Workload Id ...")).toBeUndefined();
  });
});

describe("looksLikeMissingXcode", () => {
  it.each([
    "error : A valid Xcode installation was not found at the configured location: '/Library/Developer/CommandLineTools'",
    "error : Could not find a valid Xcode app bundle at '/Library/Developer/CommandLineTools'. Please verify that 'xcode-select -p' points to your Xcode installation.",
    "For more information see https://aka.ms/macios-missing-xcode.",
  ])("flags Xcode-related build errors", (output) => {
    expect(looksLikeMissingXcode(output)).toBe(true);
  });

  it("does not flag a missing-workload error", () => {
    expect(
      looksLikeMissingXcode(
        "error NETSDK1147: the following workloads must be installed: maui-maccatalyst",
      ),
    ).toBe(false);
  });
});

describe("looksLikeXcodeTooOld", () => {
  it("flags the MT0180 version-mismatch error", () => {
    expect(
      looksLikeXcodeTooOld(
        "ILLINK : error MT0180: This version of Microsoft.MacCatalyst requires the MacCatalyst 26.5 SDK (shipped with Xcode 26.5). Either upgrade Xcode to get the required header files or set the managed linker behaviour to Link Framework SDKs Only in your project's iOS Build Options > Linker Behavior (to try to avoid the new APIs).",
      ),
    ).toBe(true);
  });

  it("ignores missing-Xcode and workload errors", () => {
    expect(
      looksLikeXcodeTooOld(
        "error : A valid Xcode installation was not found at the configured location: '/Library/Developer/CommandLineTools'",
      ),
    ).toBe(false);
    expect(
      looksLikeXcodeTooOld(
        "error NETSDK1147: the following workloads must be installed: maui-maccatalyst",
      ),
    ).toBe(false);
  });
});

describe("macCatalystPackIsStale", () => {
  // The boundary was established by reading the run target out of each shipped
  // pack: packs below 26.2.10233 exec `$(AssemblyName).app`, which for a
  // scaffolded app is never the bundle the build produced.
  it.each(["26.0.11017", "26.1.10502", "26.2.10191"])(
    "flags %s, whose dotnet watch run cannot launch the app",
    (version) => {
      expect(macCatalystPackIsStale(version)).toBe(true);
    },
  );

  it.each(["26.2.10233", "26.4.10259", "26.5.10301", "27.0.1"])(
    "accepts %s",
    (version) => {
      expect(macCatalystPackIsStale(version)).toBe(false);
    },
  );

  it("says nothing about a version it cannot parse", () => {
    // Advisory check: a false alarm telling people to update a working
    // toolchain is worse than staying quiet.
    expect(macCatalystPackIsStale("preview")).toBe(false);
    expect(macCatalystPackIsStale("")).toBe(false);
  });
});

describe("newestPackVersion", () => {
  it("compares numerically, not as text", () => {
    // "26.2.9999" sorts after "26.2.10233" as a string, and is older.
    expect(newestPackVersion(["26.2.9999", "26.2.10233"])).toBe("26.2.10233");
  });

  it("picks the newest across pack families", () => {
    expect(newestPackVersion(["26.0.11017", "26.5.10301", "26.1.10502"])).toBe(
      "26.5.10301",
    );
  });

  it("skips entries that are not versions, and empties out", () => {
    expect(newestPackVersion(["not-a-version", "26.4.10259"])).toBe("26.4.10259");
    expect(newestPackVersion([])).toBeUndefined();
    expect(newestPackVersion(["nonsense"])).toBeUndefined();
  });
});

/**
 * A feed URL is the only switch, so these are the states it cannot describe:
 * a block that turns nothing on, and an app scaffolded before the updater
 * shipped live, whose own source is missing a part a package cannot retrofit.
 * The updater is silent by design when nothing is configured, so this is the
 * only place a typo can surface.
 */
describe("diagnoseUpdateConfiguration", () => {
  const WIRED = "builder.UseVidra().UseVidraUpdates().UseVidraNativeUpdates();";
  const ENTRY_POINTS = {
    MacCatalyst: "VelopackApp.Build().UseVidraLocator().Run();",
    Windows: "VelopackApp.Build().UseVidraLocator().Run();",
  };

  const clean = {
    config: null as Parameters<typeof diagnoseUpdateConfiguration>[0]["config"],
    mauiProgram: WIRED,
    csproj: '<PackageReference Include="Vidra.Updates.Native" Version="0.5.0" />',
    entryPoints: ENTRY_POINTS,
    publishedUnsigned: false,
  };

  const names = (input: Parameters<typeof diagnoseUpdateConfiguration>[0]): string[] =>
    diagnoseUpdateConfiguration(input).map((r) => r.name);

  it("says nothing about an app that never asked for updates", () => {
    expect(diagnoseUpdateConfiguration(clean)).toEqual([]);
  });

  it("says nothing about a scaffolded app with a feed", () => {
    expect(
      diagnoseUpdateConfiguration({ ...clean, config: { feed: "https://cdn/notes/" } }),
    ).toEqual([]);
  });

  it("says so plainly when a feed is switched off rather than missing", () => {
    const [found] = diagnoseUpdateConfiguration({
      ...clean,
      config: { feed: "https://cdn/notes/", enabled: false },
    });

    expect(found.name).toBe("Update feed");
    expect(found.detail).toContain("enabled: false");
  });

  /** A shorthand we do not ship would bake a wrong URL into every install. */
  it("catches a feed it cannot resolve", () => {
    const [found] = diagnoseUpdateConfiguration({
      ...clean,
      config: { feed: "s3://notes-updates/app/" },
    });

    expect(found.name).toBe("Update feed");
    expect(found.detail).toContain("unknown feed scheme");
  });

  /** One tier on and the other off is an ordinary configuration, not a fault. */
  it("says nothing about an app that only publishes web bundles", () => {
    expect(
      diagnoseUpdateConfiguration({
        ...clean,
        config: { feed: { web: "https://cdn/notes/" } },
      }),
    ).toEqual([]);
  });

  it("directs Android whole-app updates to Google Play", () => {
    const [found] = diagnoseUpdateConfiguration({
      ...clean,
      target: "android",
      config: { feed: { app: "https://cdn/notes/" } },
    });

    expect(found.name).toBe("Android app updates");
    expect(found.detail).toContain("Google Play");
  });

  /**
   * Everything below is an app scaffolded before the updater shipped live, when
   * turning updates on took five steps and one of them was skipped. New apps
   * cannot reach these states: the template ships all of it, live.
   */
  it("catches a feed configured with no builder call", () => {
    expect(
      names({
        ...clean,
        config: { feed: { web: "https://cdn/notes/" } },
        mauiProgram: "builder.UseVidra();",
      }),
    ).toEqual(["OTA updates wired up"]);
  });

  it("catches native updates with no builder call, no package, and a dead entry point", () => {
    expect(
      names({
        ...clean,
        config: { feed: "https://cdn/notes/" },
        mauiProgram: "builder.UseVidra().UseVidraUpdates();",
        csproj: '<PackageReference Include="Vidra.Hosting.Maui" Version="0.4.0" />',
        entryPoints: { Windows: "static void Main() { }" },
      }),
    ).toEqual([
      "Native updates wired up",
      "Velopack package",
      "Velopack entry point (Windows)",
    ]);
  });

  /**
   * The one thing a package reference cannot retrofit. Commented out, the app
   * installs and launches perfectly and never handles a Velopack hook.
   */
  it("does not mistake the old commented-out entry point for a live one", () => {
    expect(
      names({
        ...clean,
        config: { feed: "https://cdn/notes/" },
        entryPoints: { MacCatalyst: "// VelopackApp.Build().UseVidraLocator().Run();" },
      }),
    ).toEqual(["Velopack entry point (MacCatalyst)"]);
  });

  /**
   * Configuring a public key makes signatures mandatory: the app will refuse
   * an unsigned feed. Publishing one anyway produces an app that checks, finds
   * an update, and silently refuses it forever.
   */
  it("catches a signed-only app publishing an unsigned feed", () => {
    expect(
      names({
        ...clean,
        config: { feed: "https://cdn/notes/", publicKeys: ["k"] },
        publishedUnsigned: true,
      }),
    ).toEqual(["Feed signature"]);
  });

  it("does not complain about an unsigned feed when no key is configured", () => {
    expect(
      diagnoseUpdateConfiguration({
        ...clean,
        config: { feed: "https://cdn/notes/" },
        publishedUnsigned: true,
      }),
    ).toEqual([]);
  });

  /**
   * The scaffolded MauiProgram explains how to turn updates on, and that
   * explanation names the very call being looked for. A substring search
   * reported every fresh app as already wired up.
   */
  it("does not mistake the template's own comment for a builder call", () => {
    const template = [
      "// Write it with `npx vidra updates init --feed <url>`, then",
      "// `.UseVidraUpdates()` is already called below.",
      "builder.UseMauiApp<App>().UseVidra();",
    ].join("\n");

    expect(
      names({
        ...clean,
        config: { feed: { web: "https://cdn/notes/" } },
        mauiProgram: template,
      }),
    ).toEqual(["OTA updates wired up"]);
  });

  /**
   * A source file that could not be read is not evidence of a missing call.
   * Reporting one would make `vidra doctor` fail on a project layout it simply
   * does not understand.
   */
  it("does not accuse an app whose sources could not be read", () => {
    expect(
      names({
        ...clean,
        config: { feed: "https://cdn/notes/" },
        mauiProgram: null,
        csproj: null,
        entryPoints: {},
      }),
    ).toEqual([]);
  });
});
