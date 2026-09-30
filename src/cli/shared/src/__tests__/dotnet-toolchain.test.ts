import { describe, it, expect } from "vitest";
import {
  hasNet10Sdk,
  mauiWorkloadFor,
  newestNet10Sdk,
  outputMentionsMaui,
  outputMentionsMauiTarget,
} from "../dotnet-toolchain.js";

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

describe("outputMentionsMauiTarget", () => {
  it("accepts the umbrella workload for Android", () => {
    expect(outputMentionsMauiTarget("[maui]\n", "android")).toBe(true);
  });

  it("accepts the Android component workload", () => {
    expect(outputMentionsMauiTarget("maui-android  10.0.0  SDK\n", "android")).toBe(true);
  });

  it("rejects a different platform-only workload", () => {
    expect(
      outputMentionsMauiTarget("maui-maccatalyst  10.0.0  SDK\n", "android"),
    ).toBe(false);
  });
});

describe("mauiWorkloadFor", () => {
  it("returns the target-specific remediation workload", () => {
    expect(mauiWorkloadFor("android")).toBe("maui-android");
    expect(mauiWorkloadFor("windows")).toBe("maui-windows");
    expect(mauiWorkloadFor("macos")).toBe("maui-maccatalyst");
    expect(mauiWorkloadFor()).toBe("maui");
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
