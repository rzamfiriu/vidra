import prompts from "prompts";
import fs from "fs-extra";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  toPascalCase,
  toKebabCase,
  toTitleCase,
  toTextPath,
  parseArgs,
} from "./utils.js";
import { exec, tryExecAsync } from "./exec.js";
import { scaffoldDir, type Replacements } from "./scaffold.js";
import { ensureMauiWorkload } from "./doctor.js";
import { dim, footer, kv, lime, row, value, wordmark } from "./theme.js";

/** A dim "label   body" note line (body may contain its own colors). */
const note = (label: string, body: string): string =>
  `  ${dim(label.padEnd(7))} ${body}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, "..");
const TEMPLATES_DIR = path.join(CLI_ROOT, "templates");
const VIDRA_REPO_ROOT = path.resolve(CLI_ROOT, "..", "..", "..");
const LOCAL_FEED_DIR = path.join(VIDRA_REPO_ROOT, "dist", "packages");
const LOCAL_CLI_DIR = CLI_ROOT;
const LOCAL_SDK_DIR = path.join(VIDRA_REPO_ROOT, "src", "sdk", "vidra-js");
const VIDRA_VERSION = "0.3.1";
const SDK_VERSION = "0.2.0";

const main = async (): Promise<void> => {
  console.log();
  console.log(`  create-${lime("vidra")}-app`);
  console.log(footer(dim("scaffold a new vidra application")));
  console.log();

  const args = parseArgs(process.argv);
  let projectDir = args._[0] as string | undefined;
  let appId = args["app-id"] as string | undefined;

  if (!projectDir) {
    const res = await prompts(
      {
        type: "text",
        name: "projectDir",
        message: "Project name:",
        initial: "my-vidra-app",
        validate: (v: string) =>
          /^[a-zA-Z][\w-]*$/.test(v) ||
          "Must start with a letter, alphanumeric/hyphens only",
      },
      { onCancel: () => process.exit(1) },
    );
    projectDir = res.projectDir as string;
  }

  const projectName = toPascalCase(projectDir);
  const projectNameKebab = toKebabCase(projectDir);
  const appTitle = toTitleCase(projectDir);
  const appGuid = randomUUID().toUpperCase();

  if (!appId) {
    const res = await prompts(
      {
        type: "text",
        name: "appId",
        message: "App ID (reverse domain):",
        initial: `com.vidra.${projectNameKebab.replace(/-/g, "")}`,
        validate: (v: string) =>
          /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(v) ||
          "Must be reverse-domain (e.g. com.company.app)",
      },
      { onCancel: () => process.exit(1) },
    );
    appId = res.appId as string;
  }

  const root = path.resolve(projectDir);

  if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
    console.error();
    console.error(
      row({
        glyph: "error",
        detail: dim(`directory "${projectDir}" already exists and is not empty`),
      }),
    );
    console.error();
    process.exit(1);
  }

  console.log();
  console.log(kv("project", projectName));
  console.log(kv("directory", root));
  console.log(kv("app id", appId));
  console.log();

  // Path values get textually substituted into JSON (ui/package.json) and
  // XML (NuGet.Config). On Windows, native separators are `\`, which JSON
  // rejects as invalid escapes (\a, \u, ...). `toTextPath` normalizes to
  // forward slashes, which npm and NuGet accept on every OS.
  // Detect whether we're running from the Vidra monorepo (source) vs installed
  // from npm. The SDK source tree only exists in the monorepo, so it's the
  // reliable signal — unlike the CLI's own package.json, which is always present.
  // In the monorepo we wire to local file/feed refs so changes can be tested
  // without publishing; otherwise we pin published versions.
  const isMonorepo = fs.existsSync(path.join(LOCAL_SDK_DIR, "package.json"));

  const localFeedExists = isMonorepo && fs.existsSync(LOCAL_FEED_DIR);
  // Only emit the <add> local NuGet source when a local feed is actually
  // present (monorepo dev). In published mode an empty source value breaks
  // `dotnet restore`, so the element is omitted entirely.
  const localFeedSource = localFeedExists
    ? `    <add key="vidra-local" value="${toTextPath(LOCAL_FEED_DIR)}" />`
    : "";

  const cliRef = isMonorepo
    ? `file:${toTextPath(LOCAL_CLI_DIR)}`
    : `^${VIDRA_VERSION}`;

  const sdkRef = isMonorepo
    ? `file:${toTextPath(LOCAL_SDK_DIR)}`
    : `^${SDK_VERSION}`;

  const replacements: Replacements = {
    "{{projectName}}": projectName,
    "{{projectNameKebab}}": projectNameKebab,
    "{{appId}}": appId,
    "{{appGuid}}": appGuid,
    "{{appTitle}}": appTitle,
    "{{cliVersion}}": cliRef,
    "{{vidraVersion}}": VIDRA_VERSION,
    "{{sdkVersion}}": sdkRef,
    "{{localFeedSource}}": localFeedSource,
  };

  const templateDir = path.join(TEMPLATES_DIR, "react-vite");
  await scaffoldDir(templateDir, root, replacements);

  console.log(row({ glyph: "active", detail: dim("creating solution\u2026") }));
  exec(`dotnet new sln -n ${projectName} --force`, root);

  const slnFile = fs.existsSync(path.join(root, `${projectName}.slnx`))
    ? `${projectName}.slnx`
    : `${projectName}.sln`;
  exec(
    `dotnet sln ${slnFile} add src/${projectName}.Host/${projectName}.Host.csproj`,
    root,
  );

  console.log(row({ glyph: "active", detail: dim("installing dependencies\u2026") }));
  // The root install provides the `vidra` CLI binary (via the create-vidra-app
  // devDependency) that the `dev`/`build` scripts call; the ui install provides
  // React/Vite/@vidra-dev/sdk. They are separate package roots, not workspaces,
  // so the two installs are independent and run concurrently.
  const uiDir = path.join(root, "ui");
  const [rootNpmOk, uiNpmOk] = await Promise.all([
    tryExecAsync("npm install", root),
    tryExecAsync("npm install", uiDir),
  ]);
  const npmOk = rootNpmOk && uiNpmOk;

  console.log();
  console.log(
    row({
      glyph: "done",
      detail: `${dim("your")} ${wordmark()} ${dim("app is ready")}`,
    }),
  );
  console.log();

  if (localFeedExists) {
    console.log(note("nuget", `${dim("local feed \u2192")} ${value(LOCAL_FEED_DIR)}`));
  } else if (isMonorepo) {
    console.log(
      row({
        glyph: "manual",
        detail: `${dim("local NuGet feed not found. run")} ${lime("./pack-local.sh")} ${dim("in the vidra repo, then update NuGet.Config.")}`,
      }),
    );
  }

  if (isMonorepo) {
    console.log(note("npm", `${dim("@vidra-dev/sdk \u2192")} ${value(LOCAL_SDK_DIR)}`));
    console.log(note("npm", `${dim("create-vidra-app \u2192")} ${value(LOCAL_CLI_DIR)}`));
  }
  console.log();

  if (!npmOk) {
    console.log(
      row({
        glyph: "manual",
        detail: `${dim("npm install had errors. re-run")} ${lime("npm install")} ${dim("in the project root and in")} ${value("ui/")} ${dim("to retry.")}`,
      }),
    );
    console.log();
  }

  // Surface a missing MAUI workload now, while we can guide the fix, rather
  // than letting `npm run dev` fail later with a raw MSBuild error.
  const hostCsproj = path.join(
    root,
    "src",
    `${projectName}.Host`,
    `${projectName}.Host.csproj`,
  );
  const prereqsReady = await ensureMauiWorkload({ csprojPath: hostCsproj });

  console.log(footer(dim("next steps")));
  console.log(`    ${value(`cd ${projectDir}`)}`);
  console.log(
    `    ${value("npm run dev")}  ${dim("# starts vite + the MAUI host together")}`,
  );
  if (!prereqsReady) {
    console.log(
      `    ${dim("tip: run")} ${lime("npm run doctor")} ${dim("to verify your setup first")}`,
    );
  }
  console.log();
};

main().catch((e: Error) => {
  console.error(row({ glyph: "error", detail: dim(e.message) }));
  process.exit(1);
});
