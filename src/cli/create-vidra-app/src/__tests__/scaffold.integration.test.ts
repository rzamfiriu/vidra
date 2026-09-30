import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { scaffoldDir, type Replacements } from "../scaffold.js";
import { toPascalCase, toKebabCase, toTitleCase } from "@vidra-dev/cli-shared/utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, "../..");
const TEMPLATE_DIR = path.join(CLI_ROOT, "templates", "react-vite");
const SHOULD_RUN_DOTNET = process.env.VIDRA_E2E_DOTNET === "1";

/**
 * The template explains itself, and those explanations name the very calls
 * being asserted below — so a plain substring search would pass on a file where
 * every one of them is commented out.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

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
      "vidra.config.ts",
      "README.md",
      path.join("ui", "package.json"),
      path.join("ui", "vite.config.ts"),
      path.join("ui", "src", "main.tsx"),
      path.join("ui", "src", "App.tsx"),
      path.join("ui", "src", "generated", "counter.ts"),
      path.join("ui", "src", "generated", "index.ts"),
      path.join("ui", "src", "generated", "manifest.json"),
      path.join("ui", "src", "generated", "vidra-access-policy.ts"),
      path.join("ui", "index.html"),
      path.join("src", `${projectName}.Host`, `${projectName}.Host.csproj`),
      path.join("src", `${projectName}.Host`, "MauiProgram.cs"),
      path.join("src", `${projectName}.Host`, "App.xaml.cs"),
      path.join("src", `${projectName}.Host`, "CounterJsContract.cs"),
      path.join("src", `${projectName}.Host`, "Platforms", "Android", "MainActivity.cs"),
      path.join("src", `${projectName}.Host`, "Platforms", "Android", "MainApplication.cs"),
      path.join("src", `${projectName}.Host`, "Platforms", "Android", "AndroidManifest.xml"),
      path.join("src", `${projectName}.Host`, "Platforms", "Android", "Resources", "drawable", "vidra_notification.xml"),
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

  /**
   * The updater ships live in every scaffolded app, doing nothing until
   * `vidra.config.ts` names a feed. That is what makes a feed URL the only switch
   * — so if any of these four ever regress to being commented out, an app that
   * configures a feed goes quietly back to never updating, and nothing else in
   * the suite would notice.
   */
  describe("the updater ships live", () => {
    const host = (...rel: string[]): string =>
      path.join(root, "src", `${projectName}.Host`, ...rel);

    it("references Vidra.Updates.Native", async () => {
      const csproj = await fs.readFile(host(`${projectName}.Host.csproj`), "utf8");
      expect(csproj).toContain('<PackageReference Include="Vidra.Updates.Native"');
      expect(csproj).toContain("GetTargetPlatformIdentifier('$(TargetFramework)')) != 'android'");
    });

    it("calls both builder extensions", async () => {
      const live = stripComments(await fs.readFile(host("MauiProgram.cs"), "utf8"));
      expect(live).toContain(".UseVidraUpdates()");
      expect(live).toContain(".UseVidraNativeUpdates()");
      expect(await fs.readFile(host("MauiProgram.cs"), "utf8")).toContain("#if !ANDROID");
    });

    it.each(["MacCatalyst", "Windows"])(
      "runs VelopackApp before the UI framework on %s",
      async (platform) => {
        const live = stripComments(await fs.readFile(host("Platforms", platform, "Program.cs"), "utf8"));
        expect(live).toContain("VelopackApp.Build().UseVidraLocator().Run();");
      },
    );

    /**
     * The switches are in vidra.config.ts from the first scaffold, spelled
     * correctly and empty. Filling one in is the entire opt-in, and there is
     * no key left to misspell.
     */
    it("ships the switch, blank", async () => {
      const config = await fs.readFile(path.join(root, "vidra.config.ts"), "utf8");
      expect(config).toContain('feed: ""');
    });

    it("keeps update settings out of package.json", async () => {
      const pkg = await fs.readJson(path.join(root, "package.json"));
      expect(pkg.vidra).toBeUndefined();
    });
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

  it("leaves the generated native token name available to bridge tutorials", async () => {
    const config = await fs.readFile(path.join(root, "vidra.config.ts"), "utf8");

    expect(config).toContain("native as builtInNative");
    expect(config).toContain("events as builtInEvents");
    expect(config).not.toMatch(/\bnative\s*(?:,|\})/);
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
