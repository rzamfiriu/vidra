import { describe, it, expect } from "vitest";
import {
  hasNet10Sdk,
  newestNet10Sdk,
  outputMentionsMaui,
  looksLikeMissingWorkload,
  looksLikeMissingXcode,
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
