import path from "node:path";
import fs from "fs-extra";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { parseArgs } from "../utils.js";
import {
  detectPlatform,
  detectProject,
  type ProjectInfo,
} from "../project.js";
import type { BuildTarget } from "../targets/types.js";
import { macosTarget } from "../targets/macos.js";
import { signMacAppBundleIfPossible } from "../signing.js";
import { windowsTarget } from "../targets/windows.js";

const VERSION = "0.1.0";

const TARGETS: Record<string, BuildTarget> = {
  macos: macosTarget,
  windows: windowsTarget,
};

export const buildCommand = async (argv: string[]): Promise<void> => {
  const args = parseArgs(["_", "_", ...argv]);
  const verbose = !!args["verbose"];
  const targetName = (args["target"] as string) || detectPlatform();

  console.log();
  console.log(
    `  ${chalk.bold.cyan("uinet build")} ${chalk.dim(`v${VERSION}`)}`,
  );
  console.log();

  const target = TARGETS[targetName];
  if (!target) {
    const supported = Object.keys(TARGETS).join(", ");
    console.error(
      chalk.red(
        `  Unsupported target: ${targetName}. Supported: ${supported}`,
      ),
    );
    process.exit(1);
  }

  const project = detectProject(process.cwd());

  console.log(`  ${chalk.dim("Project:")}  ${chalk.cyan(project.projectName)}`);
  console.log(`  ${chalk.dim("Target:")}   ${chalk.cyan(target.name)} (${target.framework})`);
  console.log();

  // Step 1: Build UI
  stepBuildUi(project, verbose);

  // Step 2: Copy assets
  stepCopyAssets(project);

  // Step 3: dotnet publish
  const publishDir = stepDotnetPublish(project, target, verbose);

  // Step 4: Find build artifact
  const bundlePath = target.findBundle(publishDir, project.projectName);
  if (!bundlePath) {
    console.error(
      chalk.red(`  Could not find build artifact in ${publishDir}`),
    );
    process.exit(1);
  }
  console.log(
    `  ${chalk.dim("Bundle:")}   ${chalk.cyan(path.basename(bundlePath))}`,
  );

  if (target.name === "macos") {
    signMacAppBundleIfPossible(bundlePath, {
      verbose,
      log: console.log,
      warn: console.warn,
    });
  }

  // Step 5: Package for distribution
  const outputDir = path.join(project.root, "dist");
  fs.ensureDirSync(outputDir);

  console.log();
  console.log(`  ${chalk.dim(`Packaging for ${target.name}...`)}`);
  const startPkg = Date.now();

  let outputPath: string;
  try {
    outputPath = await target.package(bundlePath, outputDir, {
      projectName: project.projectName,
      displayVersion: project.displayVersion,
    });
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; message: string };
    console.error(chalk.red(`  Packaging failed.`));
    console.error(chalk.dim(err.stderr?.toString() || err.message));
    process.exit(1);
  }

  const pkgTime = ((Date.now() - startPkg) / 1000).toFixed(1);
  const sizeBytes = fs.statSync(outputPath).size;
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);

  console.log(
    `  ${chalk.green(">")} ${path.basename(outputPath)} ${chalk.dim(`(${sizeMB} MB, ${pkgTime}s)`)}`,
  );

  console.log();
  console.log(
    `  ${chalk.green("Done!")} Output: ${chalk.cyan(path.relative(project.root, outputPath))}`,
  );
  console.log();
};

const stepBuildUi = (project: ProjectInfo, verbose: boolean): void => {
  console.log(`  ${chalk.dim("Building UI...")}`);
  const start = Date.now();
  try {
    execSync("npm run build", {
      cwd: project.uiDir,
      stdio: verbose ? "inherit" : "pipe",
    });
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; message: string };
    console.error(chalk.red("  Vite build failed."));
    console.error(chalk.dim(err.stderr?.toString() || err.message));
    process.exit(1);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ${chalk.green(">")} Vite build complete ${chalk.dim(`(${elapsed}s)`)}`);
  console.log();
};

const stepCopyAssets = (project: ProjectInfo): void => {
  console.log(`  ${chalk.dim("Copying assets to host project...")}`);

  const viteDist = path.join(project.uiDir, "dist");
  if (!fs.existsSync(viteDist)) {
    console.error(chalk.red(`  ui/dist not found. Vite build may have failed.`));
    process.exit(1);
  }

  const wwwroot = path.join(project.hostDir, "Resources", "Raw", "wwwroot");
  fs.removeSync(wwwroot);
  fs.copySync(viteDist, wwwroot);

  const fileCount = countFiles(wwwroot);
  console.log(
    `  ${chalk.green(">")} ${fileCount} files -> ${chalk.dim("Resources/Raw/wwwroot/")}`,
  );
  console.log();
};

const countFiles = (dir: string): number => {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
};

const stepDotnetPublish = (
  project: ProjectInfo,
  target: BuildTarget,
  verbose: boolean,
): string => {
  console.log(
    `  ${chalk.dim(`Publishing .NET host (${target.framework})...`)}`,
  );
  const start = Date.now();

  const extraArgs = target.extraPublishArgs ?? "-p:CreatePackage=false";
  try {
    execSync(
      `dotnet publish "${project.csprojPath}" -c Release -f ${target.framework} ${extraArgs}`,
      {
        cwd: project.root,
        stdio: verbose ? "inherit" : "pipe",
      },
    );
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; message: string };
    console.error(chalk.red("  dotnet publish failed."));
    console.error(chalk.dim(err.stderr?.toString() || err.message));
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `  ${chalk.green(">")} dotnet publish complete ${chalk.dim(`(${elapsed}s)`)}`,
  );

  const publishDir = path.join(
    project.hostDir,
    "bin",
    "Release",
    target.framework,
  );

  return publishDir;
};
