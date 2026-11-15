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
      path.join("src", `${projectName}.Host`, "Platforms", "iOS", "AppDelegate.cs"),
      path.join("src", `${projectName}.Host`, "Platforms", "iOS", "Program.cs"),
      path.join("src", `${projectName}.Host`, "Platforms", "iOS", "Info.plist"),
      path.join("src", `${projectName}.Host`, "Platforms", "iOS", "Info.LocalNetwork.plist"),
      path.join("src", `${projectName}.Host`, "Platforms", "iOS", "PrivacyInfo.xcprivacy"),
      path.join("src", `${projectName}.Host`, "Resources", "AppIcon", "appicon.svg"),
      path.join("src", `${projectName}.Host`, "Resources", "AppIcon", "appiconfg.svg"),
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
      expect(csproj).toContain("GetTargetPlatformIdentifier('$(TargetFramework)')) != 'ios'");
    });

    it("calls both builder extensions", async () => {
      const live = stripComments(await fs.readFile(host("MauiProgram.cs"), "utf8"));
      expect(live).toContain(".UseVidraUpdates()");
      expect(live).toContain(".UseVidraNativeUpdates()");
      expect(await fs.readFile(host("MauiProgram.cs"), "utf8")).toContain("#if !ANDROID && !IOS");
    });

    it("leaves Velopack out of the iOS entry point", async () => {
      const live = stripComments(await fs.readFile(host("Platforms", "iOS", "Program.cs"), "utf8"));
      expect(live).not.toContain("VelopackApp");
      expect(live).toContain("UIApplication.Main(args, null, typeof(AppDelegate));");
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

  describe("the app icon", () => {
    const host = (...rel: string[]): string =>
      path.join(root, "src", `${projectName}.Host`, ...rel);

    // App Store Connect rejects an icon with transparency; Color is what fills it.
    it("is one MauiIcon with an opaque background", async () => {
      const csproj = await fs.readFile(host(`${projectName}.Host.csproj`), "utf8");
      expect(csproj).toMatch(
        /<MauiIcon Include="Resources\\AppIcon\\appicon\.svg" ForegroundFile="Resources\\AppIcon\\appiconfg\.svg" Color="#[0-9A-Fa-f]{6}" \/>/,
      );
    });

    it.each(["iOS", "MacCatalyst"])("is named in the %s Info.plist", async (platform) => {
      const plist = await fs.readFile(host("Platforms", platform, "Info.plist"), "utf8");
      expect(plist).toMatch(
        /<key>XSAppIconAssets<\/key>\s*<string>Assets\.xcassets\/appicon\.appiconset<\/string>/,
      );
    });

    it("is named in the Android manifest", async () => {
      const manifest = await fs.readFile(host("Platforms", "Android", "AndroidManifest.xml"), "utf8");
      expect(manifest).toContain('android:icon="@mipmap/appicon"');
      expect(manifest).toContain('android:roundIcon="@mipmap/appicon_round"');
    });
  });

  describe("iOS", () => {
    const host = (...rel: string[]): string =>
      path.join(root, "src", `${projectName}.Host`, ...rel);

    it("targets iOS 17 on iPhone and iPad", async () => {
      const csproj = await fs.readFile(host(`${projectName}.Host.csproj`), "utf8");
      expect(csproj).toContain("net10.0-maccatalyst;net10.0-ios;net10.0-android");
      expect(csproj).toMatch(/== 'ios'">17\.0<\/SupportedOSPlatformVersion>/);
      const plist = await fs.readFile(host("Platforms", "iOS", "Info.plist"), "utf8");
      expect(plist).toMatch(/<key>UIDeviceFamily<\/key>\s*<array>\s*<integer>1<\/integer>\s*<integer>2<\/integer>/);
    });

    // The Catalyst hardened-runtime entitlements are rejected on iOS, and the
    // SDK picks up a root Entitlements.plist on its own unless told not to.
    it("signs without the Mac Catalyst entitlements", async () => {
      const csproj = await fs.readFile(host(`${projectName}.Host.csproj`), "utf8");
      expect(csproj).toMatch(
        /<EnableDefaultCodesignEntitlements Condition="[^"]*== 'ios'">false<\/EnableDefaultCodesignEntitlements>/,
      );
    });

    // Plain HTTP to the local network is how a device reaches Vite; it must
    // never ride along into an App Store build.
    it("allows local networking only in Debug and simulator builds", async () => {
      const csproj = await fs.readFile(host(`${projectName}.Host.csproj`), "utf8");
      expect(csproj).toContain(
        `Condition="'$(Configuration)' == 'Debug' Or '$(VidraAllowLocalNetworking)' == 'true'"`,
      );
      const release = await fs.readFile(host("Platforms", "iOS", "Info.plist"), "utf8");
      expect(release).not.toContain("NSAppTransportSecurity");
    });

    it("bundles a privacy manifest declaring the APIs .NET and MAUI use", async () => {
      const csproj = await fs.readFile(host(`${projectName}.Host.csproj`), "utf8");
      expect(csproj).toContain(
        '<BundleResource Include="Platforms\\iOS\\PrivacyInfo.xcprivacy" LogicalName="PrivacyInfo.xcprivacy" />',
      );
      const manifest = await fs.readFile(host("Platforms", "iOS", "PrivacyInfo.xcprivacy"), "utf8");
      for (const reason of ["C617.1", "35F9.1", "E174.1", "CA92.1"]) {
        expect(manifest).toContain(`<string>${reason}</string>`);
      }
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
