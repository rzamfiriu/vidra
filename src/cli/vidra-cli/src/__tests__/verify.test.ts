import { describe, it, expect } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

const { artifactKind } = await import("../commands/verify.js");
const { extractArchive } = await import("../artifacts.js");

/**
 * `vidra verify` advertises four inputs — `.dmg`, `.zip`, `.app`, `.exe` — and
 * two of them were broken in ways CI could not see: the Windows leg only ever
 * passes an already-extracted `.exe`, and nothing exercised `.app` at all.
 */
describe("artifactKind", () => {
  it("routes a .dmg to the macOS checks", () => {
    expect(artifactKind("/out/App-1.0-macos.dmg")).toBe("macos");
  });

  // The regression that mattered: a .app *is* a directory, so a routing rule
  // that asks "is this a directory?" hands a macOS bundle to the Windows path,
  // which then fails looking for an .exe inside it.
  it("routes a .app bundle to the macOS checks, not the Windows ones", () => {
    expect(artifactKind("/out/App.app")).toBe("macos");
  });

  it("routes a .zip to the Windows checks", () => {
    expect(artifactKind("/out/App-1.0-windows.zip")).toBe("windows");
  });

  it("routes a bare .exe to the Windows checks", () => {
    expect(artifactKind("/out/App.Host.exe")).toBe("windows");
  });

  it.each(["apk", "aab"])("routes an .%s to the Android checks", (extension) => {
    expect(artifactKind(`/out/App-1.0-android.${extension}`)).toBe("android");
  });

  it("treats a plain directory as a Windows publish folder", () => {
    expect(artifactKind("/out/publish")).toBe("windows");
  });
});

describe("extractArchive", () => {
  // Passing a zip path straight to readdir used to throw a raw ENOTDIR that
  // surfaced as an unhandled error. Whatever goes wrong now, it must not leave
  // a temp directory behind.
  it("fails cleanly on something that is not a zip, leaving no temp dir", () => {
    const scratch = nodeFs.mkdtempSync(path.join(os.tmpdir(), "vidra-notzip-"));
    const bogus = path.join(scratch, "not-really.zip");
    nodeFs.writeFileSync(bogus, "this is not a zip archive");

    const before = tempEntryCount();
    expect(() => extractArchive(bogus)).toThrow();
    expect(tempEntryCount()).toBe(before);

    nodeFs.rmSync(scratch, { recursive: true, force: true });
  });
});

/** How many `vidra-zip-*` staging directories currently exist. */
const tempEntryCount = (): number =>
  nodeFs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("vidra-zip-")).length;
