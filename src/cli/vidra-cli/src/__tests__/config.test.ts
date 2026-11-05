import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadVidraConfig,
  serializeBridgePolicy,
  writeFrontendAccessFingerprint,
  writeVidraUpdateConfig,
  type BridgePolicyDocument,
  type VidraConfigContext,
} from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const context: VidraConfigContext = {
  command: "build",
  mode: "production",
  target: "macos",
};

describe("vidra.config.ts", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
  });

  const project = async (source: string): Promise<string> => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vidra-config-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "vidra.config.ts"), source);
    return root;
  };

  it("loads TypeScript and normalizes generated access tokens", async () => {
    const root = await project(`
      type Token = { kind: string; contract: string; member: string };
      const getText: Token = { kind: "vidra.native-method", contract: "clipboard", member: "getText" };
      export default {
        bridge: { allow: [getText, getText] },
        updates: { feed: " https://cdn.example/app/ " },
      };
    `);

    const loaded = await loadVidraConfig(root, context);

    expect(loaded.bridgePolicy.nativeMethods).toEqual([
      { contract: "clipboard", member: "getText" },
    ]);
    expect(loaded.updates?.feed).toBe("https://cdn.example/app/");
    expect(loaded.accessFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes the exact serialized policy bytes across languages", async () => {
    const policy: BridgePolicyDocument = {
      version: 1,
      nativeMethods: [
        { contract: "café", member: "open&show" },
        { contract: "café", member: "ouvrir" },
      ],
      events: [{ contract: "état", member: "changé" }],
      filesystem: [
        {
          root: "appData",
          relativePath: "crème/notes&data",
          methods: [{ contract: "filesystem", member: "readText" }],
        },
      ],
    };
    const serialized = serializeBridgePolicy(policy);
    const fixture = await fs.readFile(
      path.resolve(
        __dirname,
        "../../../../../tests/contract/fixtures/bridge-policy.unicode.json",
      ),
      "utf8",
    );

    expect(serialized).toBe(fixture);
    expect(crypto.createHash("sha256").update(serialized).digest("hex")).toBe(
      "1f592f6d8340ab89ca6e0c3e35193c87a017410a840df2fb333aaf05bbd61c36",
    );
  });

  it("pins the empty policy byte fingerprint", async () => {
    const root = await project("export default {};");

    const loaded = await loadVidraConfig(root, context);

    expect(loaded.accessFingerprint).toBe(
      "3ac090de6154b840ef518755f7cf4e16b5860c26805d60cb878574b086947387",
    );
  });

  it("evaluates a contextual config callback", async () => {
    const root = await project(`
      export default (context: { target: string | null }) => ({
        updates: { feed: context.target === "macos" ? "https://mac/" : "https://other/" },
      });
    `);

    const loaded = await loadVidraConfig(root, context);

    expect(loaded.updates?.feed).toBe("https://mac/");
  });

  it("rejects traversal in symbolic filesystem roots", async () => {
    const root = await project(`
      export default {
        bridge: {
          filesystem: [{
            root: { kind: "vidra.filesystem-root", name: "appData", relativePath: "../outside" },
            allow: [{ kind: "vidra.native-method", contract: "filesystem", member: "readText" }],
          }],
        },
      };
    `);

    await expect(loadVidraConfig(root, context)).rejects.toThrow("relativePath");
  });

  it("requires filesystem methods to have a resource scope", async () => {
    const root = await project(`
      export default {
        bridge: {
          allow: [{ kind: "vidra.native-method", contract: "filesystem", member: "readText" }],
        },
      };
    `);

    await expect(loadVidraConfig(root, context)).rejects.toThrow(
      "without a resource scope",
    );
  });

  it("reports filesystem token locations without duplicating the filename", async () => {
    const root = await project(`
      export default {
        bridge: {
          filesystem: [{
            root: { kind: "vidra.filesystem-root", name: "appData" },
            allow: [{ kind: "wrong", contract: "filesystem", member: "readText" }],
          }],
        },
      };
    `);

    await expect(loadVidraConfig(root, context)).rejects.toThrow(
      "vidra.config.ts.bridge.filesystem[0].allow[0]",
    );
    await expect(loadVidraConfig(root, context)).rejects.not.toThrow(
      "vidra.config.ts.vidra.config.ts",
    );
  });

  it("edits only the updates property of direct defineConfig objects", async () => {
    const root = await project(`
      const defineConfig = (value: unknown) => value;
      export default defineConfig({
        bridge: { allow: [] },
        updates: { feed: "" },
      });
    `);

    writeVidraUpdateConfig(root, {
      feed: "https://cdn.example/app/",
      publicKeys: ["key"],
    });

    const source = await fs.readFile(path.join(root, "vidra.config.ts"), "utf8");
    expect(source).toContain("bridge: { allow: [] }");
    expect(source).toContain('feed: "https://cdn.example/app/"');
    expect(source).toContain('publicKeys: [');
  });

  it("preserves the scaffold's blank feed when adding a key", async () => {
    const root = await project(`
      const defineConfig = (value: unknown) => value;
      export default defineConfig({
        updates: { feed: "" },
      });
    `);

    writeVidraUpdateConfig(root, { feed: "", publicKeys: ["key"] });

    const source = await fs.readFile(path.join(root, "vidra.config.ts"), "utf8");
    expect(source).toContain('feed: ""');
    expect(source).toContain('"key"');
  });

  it("does not rewrite an unchanged generated fingerprint", async () => {
    const root = await project("export default {};");
    const uiDir = path.join(root, "ui");

    const first = writeFrontendAccessFingerprint(uiDir, "fingerprint");
    const second = writeFrontendAccessFingerprint(uiDir, "fingerprint");

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
  });

  it("declares the access fingerprint into the SDK's expectations", async () => {
    const root = await project("export default {};");
    const uiDir = path.join(root, "ui");

    const written = writeFrontendAccessFingerprint(uiDir, "fingerprint");
    const source = await fs.readFile(written.path, "utf8");

    expect(source).toContain('import { expectations } from "@vidra-dev/sdk";');
    expect(source).toContain('expectations.declare("access", "fingerprint");');
    expect(source).not.toContain("register");
  });
});
