import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { scaffoldDir, type Replacements } from "../scaffold.js";
import { toPascalCase, toKebabCase, toTitleCase } from "../utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, "../..");
const TEMPLATE_DIR = path.join(CLI_ROOT, "templates", "react-vite");
const SHOULD_RUN_DOTNET = process.env.VIDRA_E2E_DOTNET === "1";

describe("scaffold integration", () => {
  const projectDir = "my-vidra-test-app";
  const projectName = toPascalCase(projectDir);
  let workspace: string;
  let root: string;

  beforeAll(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vidra-e2e-"));
    root = path.join(workspace, projectDir);

    const replacements: Replacements = {
      "{{projectName}}": projectName,
      "{{projectNameKebab}}": toKebabCase(projectDir),
      "{{appId}}": "com.vidra.myvidratestapp",
      "{{appGuid}}": randomUUID().toUpperCase(),
      "{{appTitle}}": toTitleCase(projectDir),
      "{{cliVersion}}": "0.1.0",
      "{{vidraVersion}}": "0.1.0",
      "{{sdkVersion}}": "0.1.0",
      "{{localFeedSource}}": "",
    };

    await scaffoldDir(TEMPLATE_DIR, root, replacements);
  }, 60_000);

  afterAll(async () => {
    if (workspace) await fs.remove(workspace);
  });

  it("creates the expected top-level directory tree", async () => {
    const expected = [
      "package.json",
      "README.md",
      path.join("ui", "package.json"),
      path.join("ui", "vite.config.ts"),
      path.join("ui", "src", "main.tsx"),
      path.join("ui", "src", "App.tsx"),
      path.join("ui", "src", "generated", "counter.ts"),
      path.join("ui", "src", "generated", "index.ts"),
      path.join("ui", "src", "generated", "manifest.json"),
      path.join("ui", "index.html"),
      path.join("src", `${projectName}.Host`, `${projectName}.Host.csproj`),
      path.join("src", `${projectName}.Host`, "MauiProgram.cs"),
      path.join("src", `${projectName}.Host`, "App.xaml.cs"),
      path.join("src", `${projectName}.Host`, "CounterJsContract.cs"),
    ];
    for (const rel of expected) {
      const abs = path.join(root, rel);
      expect(await fs.pathExists(abs), rel).toBe(true);
    }
  });

  it("replaces every {{placeholder}} across every generated text file", async () => {
    const textExts = new Set([
      ".cs",
      ".csproj",
      ".xaml",
      ".json",
      ".ts",
      ".tsx",
      ".js",
      ".mjs",
      ".jsx",
      ".css",
      ".html",
      ".md",
      ".plist",
      ".targets",
      ".props",
      ".txt",
      ".Config",
    ]);

    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const ext = path.extname(entry.name);
        if (!textExts.has(ext)) continue;
        const content = await fs.readFile(full, "utf8");
        if (content.includes("{{") && content.includes("}}")) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    await walk(root);

    expect(offenders).toEqual([]);
  });

  it("emits a parseable package.json referencing the chosen project name", async () => {
    const pkg = await fs.readJson(path.join(root, "package.json"));
    expect(typeof pkg).toBe("object");
    expect(pkg.name).toBe(toKebabCase(projectDir));
  });

  it("emits a parseable host csproj with the expected application name", async () => {
    const csprojPath = path.join(
      root,
      "src",
      `${projectName}.Host`,
      `${projectName}.Host.csproj`,
    );
    const content = await fs.readFile(csprojPath, "utf8");
    expect(content).toContain(`<RootNamespace>${projectName}`);
    expect(content).toContain("<ApplicationDisplayVersion>");
    expect(content).toContain("<VidraTsOutputDir>");
    expect(content).not.toMatch(/\{\{.+?\}\}/);
  });

  it("keeps the capabilities client and result type imported", async () => {
    const app = await fs.readFile(
      path.join(root, "ui", "src", "App.tsx"),
      "utf8",
    );

    expect(app).toMatch(/\bvidra,\s*\n\} from "@vidra-dev\/sdk"/);
    expect(app).toContain("Capabilities, WindowInfo, WindowSupport");
    expect(app).toContain("useState<Capabilities | null>");
    expect(app).toContain("vidra.capabilities()");
  });

  it.skipIf(!SHOULD_RUN_DOTNET)(
    "dotnet restore succeeds on the host project",
    () => {
      const csprojPath = path.join(
        root,
        "src",
        `${projectName}.Host`,
        `${projectName}.Host.csproj`,
      );
      execFileSync("dotnet", ["restore", csprojPath], {
        cwd: root,
        stdio: "inherit",
      });
    },
    300_000,
  );
});
