import prompts from "prompts";
import chalk from "chalk";
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
import { exec, tryExec } from "./exec.js";
import { scaffoldDir, type Replacements } from "./scaffold.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, "..");
const TEMPLATES_DIR = path.join(CLI_ROOT, "templates");
const VIDRA_REPO_ROOT = path.resolve(CLI_ROOT, "..", "..", "..");
const LOCAL_FEED_DIR = path.join(VIDRA_REPO_ROOT, "dist", "packages");
const LOCAL_CLI_DIR = CLI_ROOT;
const LOCAL_SDK_DIR = path.join(VIDRA_REPO_ROOT, "src", "sdk", "vidra-js");
const VIDRA_VERSION = "0.1.0";
const SDK_VERSION = "0.1.0";

const main = async (): Promise<void> => {
  console.log();
  console.log(chalk.bold("  create-vidra-app"));
  console.log(chalk.dim("  Scaffold a new Vidra application\n"));

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
    console.error(
      chalk.red(
        `\n  Directory "${projectDir}" already exists and is not empty.\n`,
      ),
    );
    process.exit(1);
  }

  console.log();
  console.log(`  ${chalk.dim("Project:")}    ${chalk.cyan(projectName)}`);
  console.log(`  ${chalk.dim("Directory:")}  ${chalk.cyan(root)}`);
  console.log(`  ${chalk.dim("App ID:")}     ${chalk.cyan(appId)}`);
  console.log();

  // Path values get textually substituted into JSON (ui/package.json) and
  // XML (NuGet.Config). On Windows, native separators are `\`, which JSON
  // rejects as invalid escapes (\a, \u, ...). `toTextPath` normalizes to
  // forward slashes, which npm and NuGet accept on every OS.
  const localFeedExists = fs.existsSync(LOCAL_FEED_DIR);
  const localFeedPath = localFeedExists ? toTextPath(LOCAL_FEED_DIR) : "";

  const localCliExists = fs.existsSync(path.join(LOCAL_CLI_DIR, "package.json"));
  const cliRef = localCliExists
    ? `file:${toTextPath(LOCAL_CLI_DIR)}`
    : `^${VIDRA_VERSION}`;

  const localSdkExists = fs.existsSync(
    path.join(LOCAL_SDK_DIR, "package.json"),
  );
  const sdkRef = localSdkExists
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
    "{{localFeedPath}}": localFeedPath,
  };

  const templateDir = path.join(TEMPLATES_DIR, "react-vite");
  await scaffoldDir(templateDir, root, replacements);

  console.log(chalk.dim("  Creating solution..."));
  exec(`dotnet new sln -n ${projectName} --force`, root);

  const slnFile = fs.existsSync(path.join(root, `${projectName}.slnx`))
    ? `${projectName}.slnx`
    : `${projectName}.sln`;
  exec(
    `dotnet sln ${slnFile} add src/${projectName}.Host/${projectName}.Host.csproj`,
    root,
  );

  const uiDir = path.join(root, "ui");
  console.log(chalk.dim("  Installing npm dependencies..."));
  const npmOk = tryExec("npm install", uiDir);

  console.log();
  console.log(chalk.green("  Done! ") + "Your Vidra app is ready.\n");

  if (localFeedExists) {
    console.log(
      chalk.dim("  NuGet:") +
        " local feed \u2192 " +
        chalk.cyan(LOCAL_FEED_DIR),
    );
  } else {
    console.log(
      chalk.yellow("  Note: ") +
        "Local NuGet feed not found. Run " +
        chalk.cyan("./pack-local.sh") +
        " in the Vidra repo, then update NuGet.Config.",
    );
  }

  if (localSdkExists) {
    console.log(
      chalk.dim("  npm:  ") +
        " @vidra-dev/sdk \u2192 " +
        chalk.cyan(LOCAL_SDK_DIR),
    );
  }
  if (localCliExists) {
    console.log(
      chalk.dim("  npm:  ") +
        " create-vidra-app \u2192 " +
        chalk.cyan(LOCAL_CLI_DIR),
    );
  }
  console.log();

  if (!npmOk) {
    console.log(
      chalk.yellow("  Note: ") +
        "`npm install` had errors. Run " +
        chalk.cyan("cd ui && npm install") +
        " to retry.\n",
    );
  }
  console.log(chalk.bold("  Next steps:\n"));
  console.log(`    cd ${projectDir}`);
  console.log(
    `    npm run dev  ${chalk.dim("# starts Vite + MAUI host together")}`,
  );
  console.log();
};

main().catch((e: Error) => {
  console.error(chalk.red(e.message));
  process.exit(1);
});
