import { describe, it, expect } from "vitest";
import {
  hasNet10Sdk,
  newestNet10Sdk,
  outputMentionsMaui,
  looksLikeMissingWorkload,
  looksLikeMissingXcode,
  looksLikeXcodeTooOld,
  workloadSetVersion,
  workloadSetSupportsCSharpHotReload,
  sdkSupportsCSharpHotReload,
} from "../doctor.js";

describe("hasNet10Sdk", () => {
  it("detects a 10.x SDK in `dotnet --list-sdks` output", () => {
    const out = [
      "8.0.404 [/usr/local/share/dotnet/sdk]",
      "10.0.300 [/usr/local/share/dotnet/sdk]",
    ].join("\n");
    expect(hasNet10Sdk(out)).toBe(true);
  });

  it("is false when only older SDKs are present", () => {
    const out = ["8.0.404 [/usr/local/share/dotnet/sdk]", "9.0.100 [/x]"].join(
      "\n",
    );
    expect(hasNet10Sdk(out)).toBe(false);
  });

  it("does not match a 9.x SDK that merely contains '10'", () => {
    expect(hasNet10Sdk("9.0.110 [/usr/local/share/dotnet/sdk]")).toBe(false);
  });

  it("is false for empty output", () => {
    expect(hasNet10Sdk("")).toBe(false);
  });
});

describe("newestNet10Sdk", () => {
  it("returns the highest 10.x version, ignoring others", () => {
    const out = [
      "8.0.404 [/x]",
      "10.0.100 [/x]",
      "10.0.300 [/x]",
    ].join("\n");
    expect(newestNet10Sdk(out)).toBe("10.0.300");
  });

  it("returns undefined when no 10.x SDK exists", () => {
    expect(newestNet10Sdk("9.0.100 [/x]")).toBeUndefined();
  });
});

describe("outputMentionsMaui", () => {
  it("matches a maui workload row", () => {
    const out = [
      "Installed Workload Id      Manifest Version      Installation Source",
      "----------------------------------------------------------------",
      "maui                       10.0.0/10.0.100       SDK 10.0.100",
    ].join("\n");
    expect(outputMentionsMaui(out)).toBe(true);
  });

  it("matches component workloads like maui-maccatalyst", () => {
    expect(outputMentionsMaui("maui-maccatalyst   10.0.0   SDK")).toBe(true);
  });

  it("is false when no workloads are installed", () => {
    const out = [
      "Installed Workload Id      Manifest Version      Installation Source",
      "----------------------------------------------------------------",
      "",
      "Use `dotnet workload search` to find additional workloads to install.",
    ].join("\n");
    expect(outputMentionsMaui(out)).toBe(false);
  });
});

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

describe("workloadSetSupportsCSharpHotReload", () => {
  it.each(["10.0.203", "10.0.203.1", "10.0.300.3", "10.1.0", "11.0.100-preview.5.26309.3"])(
    "accepts %s",
    (version) => {
      expect(workloadSetSupportsCSharpHotReload(version)).toBe(true);
    },
  );

  it.each(["10.0.201", "10.0.202.9", "10.0.100", "9.0.314.3", "8.0.404"])(
    "rejects %s",
    (version) => {
      expect(workloadSetSupportsCSharpHotReload(version)).toBe(false);
    },
  );

  it("rejects unparseable versions", () => {
    expect(workloadSetSupportsCSharpHotReload("unknown")).toBe(false);
  });
});

describe("sdkSupportsCSharpHotReload", () => {
  // The 10.0.2xx watcher's startup hook crashes Mac Catalyst apps on launch;
  // the fix pairs with the 10.0.3xx feature band.
  it.each(["10.0.300", "10.0.301", "10.1.100", "11.0.100"])(
    "accepts %s",
    (version) => {
      expect(sdkSupportsCSharpHotReload(version)).toBe(true);
    },
  );

  it.each(["10.0.201", "10.0.204", "10.0.100", "9.0.304", "8.0.411"])(
    "rejects %s",
    (version) => {
      expect(sdkSupportsCSharpHotReload(version)).toBe(false);
    },
  );
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
