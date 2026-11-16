import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTITLEMENTS = path.resolve(
  here,
  "../../templates/react-vite/src/{{projectName}}.Host/Entitlements.plist",
);

const read = (): string => fs.readFileSync(ENTITLEMENTS, "utf8");

describe("template Entitlements.plist", () => {
  it("exists — the hardened runtime signing path depends on it", () => {
    expect(fs.existsSync(ENTITLEMENTS)).toBe(true);
  });

  /**
   * Regression guard. The MacCatalyst SDK parses this file with its own PList
   * reader, which rejects XML comments inside the document body:
   *
   *   error : Error loading Entitlements.plist template 'Entitlements.plist':
   *           Failed to parse PList data type:
   *
   * That failure only surfaces during a real Mac Catalyst build, so an
   * innocuous-looking explanatory comment can break every macOS build. The
   * rationale for these keys lives in the host .csproj instead.
   */
  it("contains no XML comments inside the plist body", () => {
    const body = read().split("<plist")[1] ?? "";
    expect(body).not.toContain("<!--");
  });

  it("grants the entitlements the .NET runtime needs under the hardened runtime", () => {
    const content = read();
    for (const key of [
      "com.apple.security.cs.allow-jit",
      "com.apple.security.cs.allow-unsigned-executable-memory",
      "com.apple.security.cs.disable-library-validation",
    ]) {
      expect(content).toContain(key);
    }
  });

  it("grants the entitlements the WebView and file picker need", () => {
    const content = read();
    expect(content).toContain("com.apple.security.network.client");
    expect(content).toContain("com.apple.security.files.user-selected.read-write");
  });

  it("is well-formed: every key has a following value element", () => {
    const body = read();
    const keys = [...body.matchAll(/<key>([^<]+)<\/key>\s*(<[^>]+>)/g)];
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const [, name, value] of keys) {
      expect(value, `key ${name} has no value element`).toMatch(
        /^<(true\/|false\/|string|integer|array|dict|data|real)/,
      );
    }
  });

  // The app sandbox would break the filesystem module's unrestricted paths, and
  // Developer ID distribution does not require it.
  it("leaves the app sandbox disabled", () => {
    expect(read()).toMatch(/com\.apple\.security\.app-sandbox<\/key>\s*<false\/>/);
  });

  // These keys are Mac Catalyst hardened-runtime entitlements. iOS rejects them,
  // and its SDK would sign with a root Entitlements.plist on its own.
  it("applies to Mac Catalyst only", () => {
    const csproj = fs.readFileSync(
      path.resolve(here, "../../templates/react-vite/src/{{projectName}}.Host/{{projectName}}.Host.csproj"),
      "utf8",
    );
    expect(csproj).toMatch(
      /<CodesignEntitlements Condition="[^"]*== 'maccatalyst'">Entitlements\.plist<\/CodesignEntitlements>/,
    );
    expect(csproj).toMatch(
      /<EnableDefaultCodesignEntitlements Condition="[^"]*== 'ios'">false<\/EnableDefaultCodesignEntitlements>/,
    );
  });
});
