import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execFileSyncMock = vi.fn();

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

const { resolveMacCodeSigningIdentity, signMacAppBundleIfPossible } = await import(
  "../signing.js"
);

const findIdentityOutput = (identities: string[]): string =>
  identities
    .map((name, i) => `  ${i + 1}) ${"A".repeat(40)} "${name}"`)
    .join("\n");

describe("resolveMacCodeSigningIdentity", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    delete process.env.UINET_MACOS_CODESIGN_KEY;
  });

  it("honours UINET_MACOS_CODESIGN_KEY override", () => {
    process.env.UINET_MACOS_CODESIGN_KEY = "  Apple Development: Override (ABC) ";
    expect(resolveMacCodeSigningIdentity()).toBe(
      "Apple Development: Override (ABC)",
    );
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("prefers 'Apple Development:' over 'Developer ID Application:'", () => {
    execFileSyncMock.mockReturnValue(
      findIdentityOutput([
        "Developer ID Application: Acme Corp (ZZZZZZZZZZ)",
        "Apple Development: Jane Doe (XXXXXXXXXX)",
      ]),
    );
    expect(resolveMacCodeSigningIdentity()).toBe(
      "Apple Development: Jane Doe (XXXXXXXXXX)",
    );
  });

  it("falls back to 'Developer ID Application:' when no Apple Development is present", () => {
    execFileSyncMock.mockReturnValue(
      findIdentityOutput([
        "Mac Developer: Someone Else",
        "Developer ID Application: Acme Corp (ZZZZZZZZZZ)",
      ]),
    );
    expect(resolveMacCodeSigningIdentity()).toBe(
      "Developer ID Application: Acme Corp (ZZZZZZZZZZ)",
    );
  });

  it("returns null when no suitable identity is present", () => {
    execFileSyncMock.mockReturnValue(
      findIdentityOutput(["Mac Developer: Not Useful"]),
    );
    expect(resolveMacCodeSigningIdentity()).toBeNull();
  });

  it("returns null when the security tool throws", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not available");
    });
    expect(resolveMacCodeSigningIdentity()).toBeNull();
  });
});

describe("signMacAppBundleIfPossible", () => {
  const originalPlatform = process.platform;
  const setPlatform = (p: NodeJS.Platform): void => {
    Object.defineProperty(process, "platform", { value: p });
  };

  const log = vi.fn();
  const warn = vi.fn();

  beforeEach(() => {
    execFileSyncMock.mockReset();
    log.mockReset();
    warn.mockReset();
    delete process.env.UINET_MACOS_CODESIGN_KEY;
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("is a no-op on non-darwin platforms", () => {
    setPlatform("linux");
    signMacAppBundleIfPossible("/some/app.app", { verbose: false, log, warn });
    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("warns and returns when no signing identity is discovered", () => {
    setPlatform("darwin");
    execFileSyncMock.mockReturnValue(
      findIdentityOutput(["Mac Developer: None Useful"]),
    );

    signMacAppBundleIfPossible("/some/app.app", { verbose: false, log, warn });

    expect(warn).toHaveBeenCalled();
    // Only the security find-identity call - no codesign.
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("codesigns using the resolved identity on darwin", () => {
    setPlatform("darwin");
    process.env.UINET_MACOS_CODESIGN_KEY = "Apple Development: Test";

    signMacAppBundleIfPossible("/some/app.app", { verbose: false, log, warn });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "codesign",
      [
        "--force",
        "--deep",
        "--sign",
        "Apple Development: Test",
        "/some/app.app",
      ],
      expect.any(Object),
    );
    expect(log).toHaveBeenCalled();
  });

  it("logs a warning if codesign fails", () => {
    setPlatform("darwin");
    process.env.UINET_MACOS_CODESIGN_KEY = "Apple Development: Test";
    execFileSyncMock.mockImplementation(() => {
      throw new Error("codesign exploded");
    });

    signMacAppBundleIfPossible("/some/app.app", { verbose: false, log, warn });

    expect(warn).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
