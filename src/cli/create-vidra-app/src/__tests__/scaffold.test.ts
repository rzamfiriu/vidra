import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { scaffoldDir, applyReplacements } from "../scaffold.js";

describe("applyReplacements", () => {
  it("substitutes every occurrence of every key", () => {
    const result = applyReplacements("{{a}} {{b}} {{a}}", {
      "{{a}}": "X",
      "{{b}}": "Y",
    });
    expect(result).toBe("X Y X");
  });

  it("returns the input unchanged when no keys match", () => {
    expect(applyReplacements("plain", { foo: "bar" })).toBe("plain");
  });

  it("supports empty replacement maps", () => {
    expect(applyReplacements("anything", {})).toBe("anything");
  });
});

describe("scaffoldDir", () => {
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    srcDir = await fs.mkdtemp(path.join(os.tmpdir(), "vidra-scaffold-src-"));
    destDir = await fs.mkdtemp(path.join(os.tmpdir(), "vidra-scaffold-dest-"));
  });

  afterEach(async () => {
    await fs.remove(srcDir);
    await fs.remove(destDir);
  });

  it("copies directory structure and substitutes text content", async () => {
    await fs.outputFile(
      path.join(srcDir, "src", "{{projectName}}.Host", "{{projectName}}.Host.csproj"),
      "<Project>{{projectName}}</Project>",
    );
    await fs.outputFile(path.join(srcDir, "README.md"), "# {{displayName}}");

    await scaffoldDir(srcDir, destDir, {
      "{{projectName}}": "MyApp",
      "{{displayName}}": "My App",
    });

    const csproj = await fs.readFile(
      path.join(destDir, "src", "MyApp.Host", "MyApp.Host.csproj"),
      "utf8",
    );
    const readme = await fs.readFile(path.join(destDir, "README.md"), "utf8");

    expect(csproj).toBe("<Project>MyApp</Project>");
    expect(readme).toBe("# My App");
  });

  it("does not substitute into binary files (images, etc.)", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.outputFile(path.join(srcDir, "logo.png"), bytes);

    await scaffoldDir(srcDir, destDir, { "{{a}}": "X" });

    const result = await fs.readFile(path.join(destDir, "logo.png"));
    expect(result.equals(bytes)).toBe(true);
  });

  it("rewrites text files whose extension is listed", async () => {
    const exts = [
      "file.cs",
      "file.csproj",
      "file.xaml",
      "file.json",
      "file.ts",
      "file.tsx",
      "file.css",
      "file.html",
      "file.md",
      "file.plist",
      "NuGet.Config",
    ];
    for (const f of exts) {
      await fs.outputFile(path.join(srcDir, f), "{{key}}");
    }

    await scaffoldDir(srcDir, destDir, { "{{key}}": "REPLACED" });

    for (const f of exts) {
      const out = await fs.readFile(path.join(destDir, f), "utf8");
      expect(out, f).toBe("REPLACED");
    }
  });
});
