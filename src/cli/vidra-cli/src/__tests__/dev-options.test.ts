import { describe, it, expect } from "vitest";
import { resolveDevOptions, resolveIosDestination } from "../dev/options.js";

describe("resolveIosDestination", () => {
  it("defaults iOS to the Simulator, and leaves other targets without one", () => {
    expect(resolveIosDestination("ios", {})).toBe("simulator");
    expect(resolveIosDestination("ios", { device: true })).toBe("device");
    expect(resolveIosDestination("macos", {})).toBeNull();
  });

  it("rejects the flags off iOS, and together", () => {
    expect(resolveIosDestination("android", { device: true })).toEqual({
      error: "--device only applies to --target ios",
    });
    expect(resolveIosDestination("ios", { device: true, simulator: true })).toEqual({
      error: "--device and --simulator are mutually exclusive",
    });
  });
});

describe("resolveDevOptions", () => {
  it("runs Vite and the C# loop for dev, and neither for run", () => {
    const args = { _: [], target: "macos" };
    expect(resolveDevOptions(args, "dev", "darwin")).toMatchObject({
      vite: true,
      hotReload: true,
    });
    expect(resolveDevOptions(args, "run", "darwin")).toMatchObject({
      vite: false,
      hotReload: false,
    });
  });

  it("honours --no-hot-reload", () => {
    expect(
      resolveDevOptions({ _: [], target: "macos", "no-hot-reload": true }, "dev", "darwin"),
    ).toMatchObject({ vite: true, hotReload: false });
  });

  it.each(["linux", "toString", "__proto__"])("rejects the unknown target %s", (target) => {
    expect(resolveDevOptions({ _: [], target }, "dev", "darwin")).toEqual({
      error: `unsupported target: ${target} — supported: macos, windows, android, ios`,
    });
  });

  it("refuses targets this OS cannot host", () => {
    expect(resolveDevOptions({ _: [], target: "ios" }, "dev", "win32")).toEqual({
      error: "the iOS target needs a Mac with Xcode",
    });
    expect(resolveDevOptions({ _: [], target: "windows" }, "dev", "darwin")).toEqual({
      error: "the Windows target can only run on Windows",
    });
  });

  it("allows Android from any OS", () => {
    expect(resolveDevOptions({ _: [], target: "android" }, "dev", "linux")).toMatchObject({
      target: { name: "android" },
      iosDestination: null,
    });
  });
});
