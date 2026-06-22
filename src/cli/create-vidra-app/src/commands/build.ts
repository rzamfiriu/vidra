import path from "node:path";
import fs from "fs-extra";
import { execSync } from "node:child_process";
import { parseArgs } from "../utils.js";
import { formatBuildError, formatProcessError } from "../exec.js";
import {
  detectPlatform,
  detectProject,
  type ProjectInfo,
} from "../project.js";
import type { BuildTarget } from "../targets/types.js";
import { macosTarget } from "../targets/macos.js";
import { signMacAppBundleIfPossible } from "../signing.js";
import { windowsTarget } from "../targets/windows.js";
import {
  ensureMauiWorkload,
  looksLikeMissingWorkload,
  looksLikeMissingXcode,
  printWorkloadHint,
  printXcodeHint,
} from "../doctor.js";
import {
  dim,
  footer,
  header,
  kv,
  lime,
  planBadge,
  row,
  STEP_LABEL_WIDTH as LABEL_WIDTH,
  value,
} from "../theme.js";

const TARGETS: Record<string, BuildTarget> = {
  macos: macosTarget,
  windows: windowsTarget,
};

const packageLabel = (target: BuildTarget): string =>
  target.name === "macos" ? "package DMG" : "package ZIP";

const artifactName = (project: ProjectInfo, target: BuildTarget): string =>
  `${project.projectName}-${project.displayVersion}-${target.name}.${
    target.name === "macos" ? "dmg" : "zip"
  }`;

export const buildCommand = async (argv: string[]): Promise<void> => {
  const args = parseArgs(["_", "_", ...argv]);
  const verbose = !!args["verbose"];
  const plan = !!args["plan"] || !!args["dry-run"];
  const targetName = (args["target"] as string) || detectPlatform();

  const target = TARGETS[targetName];
  if (!target) {
    const supported = Object.keys(TARGETS).join(", ");
    console.error();
    console.error(
      row({
        glyph: "error",
        detail: dim(`unsupported target: ${targetName} — supported: ${supported}`),
      }),
    );
    process.exit(1);
  }

  const project = detectProject(process.cwd());

  console.log();
  console.log(
    header("build", `${target.name} \u00b7 Release${plan ? " \u00b7 plan" : ""}`),
  );
  console.log(kv("project", project.projectName));
  console.log(kv("target", target.framework));
  console.log();

  // The plan view prints every step and artifact name without running anything
  // — the dim footer says how to commit. `--execute` is the default; `--plan`
  // (alias `--dry-run`) opts into the preview.
  if (plan) {
    printBuildPlan(project, target);
    console.log();
    console.log(
      footer(`${dim("nothing has run. re-run without")} ${lime("--plan")} ${dim("to apply.")}`),
    );
    console.log();
    return;
  }

  // Verify the MAUI workload before the (slow) UI build so we fail fast.
  if (!(await ensureMauiWorkload({ csprojPath: project.csprojPath }))) {
    process.exit(1);
  }

  stepBuildUi(project, verbose);
  stepCopyAssets(project);
  const publishDir = stepDotnetPublish(project, target, verbose);

  const bundlePath = target.findBundle(publishDir, project.projectName);
  if (!bundlePath) {
    console.error(
      row({
        glyph: "error",
        detail: dim(`could not find build artifact in ${publishDir}`),
      }),
    );
    process.exit(1);
  }

  if (target.name === "macos") {
    signMacAppBundleIfPossible(bundlePath, {
      verbose,
      log: console.log,
      warn: console.warn,
    });
  }

  const outputPath = await stepPackage(project, target, bundlePath);

  console.log();
  console.log(
    footer(
      `${dim("done \u2014")} ${value(path.relative(project.root, outputPath))}`,
    ),
  );
  console.log();
};

const printBuildPlan = (project: ProjectInfo, target: BuildTarget): void => {
  console.log(
    row({
      glyph: "done",
      label: "build UI",
      labelWidth: LABEL_WIDTH,
      detail: `${dim("vite \u2192")} ${value("ui/dist")}`,
    }),
  );
  console.log(
    row({
      glyph: "done",
      label: "copy assets",
      labelWidth: LABEL_WIDTH,
      detail: `${dim("\u2192")} ${value("Resources/Raw/wwwroot")}`,
    }),
  );
  console.log(
    row({
      glyph: "done",
      label: "publish .NET",
      labelWidth: LABEL_WIDTH,
      detail: `${dim("Release \u00b7")} ${value(target.framework)}`,
    }),
  );

  if (target.name === "macos") {
    console.log(
      row({
        glyph: "done",
        label: "codesign .app",
        labelWidth: LABEL_WIDTH,
        detail: dim("Apple Development, or ad-hoc (-)"),
      }),
    );
    console.log(
      row({
        glyph: "plan",
        label: "notarize",
        labelWidth: LABEL_WIDTH,
        detail: planBadge(),
      }),
    );
    console.log(
      row({
        glyph: "active",
        label: "package DMG",
        labelWidth: LABEL_WIDTH,
        detail: `${dim("hdiutil UDZO \u2192")} ${value(artifactName(project, target))}`,
      }),
    );
  } else {
    console.log(
      row({
        glyph: "active",
        label: "package ZIP",
        labelWidth: LABEL_WIDTH,
        detail: `${dim("self-contained \u2192")} ${value(artifactName(project, target))}`,
      }),
    );
  }
};

const stepBuildUi = (project: ProjectInfo, verbose: boolean): void => {
  const start = Date.now();
  try {
    execSync("npm run build", {
      cwd: project.uiDir,
      stdio: verbose ? "inherit" : "pipe",
    });
  } catch (e: unknown) {
    console.error(
      row({
        glyph: "error",
        label: "build UI",
        labelWidth: LABEL_WIDTH,
        detail: dim("vite build failed"),
      }),
    );
    console.error(dim(formatBuildError(e)));
    process.exit(1);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    row({
      glyph: "done",
      label: "build UI",
      labelWidth: LABEL_WIDTH,
      detail: `${dim("vite \u2192")} ${value("ui/dist")} ${dim(`(${elapsed}s)`)}`,
    }),
  );
};

const stepCopyAssets = (project: ProjectInfo): void => {
  const viteDist = path.join(project.uiDir, "dist");
  if (!fs.existsSync(viteDist)) {
    console.error(
      row({
        glyph: "error",
        label: "copy assets",
        labelWidth: LABEL_WIDTH,
        detail: dim("ui/dist not found — vite build may have failed"),
      }),
    );
    process.exit(1);
  }

  const wwwroot = path.join(project.hostDir, "Resources", "Raw", "wwwroot");
  fs.removeSync(wwwroot);
  fs.copySync(viteDist, wwwroot);

  const fileCount = countFiles(wwwroot);
  console.log(
    row({
      glyph: "done",
      label: "copy assets",
      labelWidth: LABEL_WIDTH,
      detail: `${dim("\u2192")} ${value("Resources/Raw/wwwroot")} ${dim(`(${fileCount} files)`)}`,
    }),
  );
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
    const output = formatBuildError(e);
    console.error(
      row({
        glyph: "error",
        label: "publish .NET",
        labelWidth: LABEL_WIDTH,
        detail: dim("dotnet publish failed"),
      }),
    );
    console.error(dim(output));
    if (looksLikeMissingWorkload(output)) printWorkloadHint();
    else if (looksLikeMissingXcode(output)) printXcodeHint();
    if (!verbose) {
      console.error(footer(dim("re-run with --verbose for the full build log.")));
    }
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    row({
      glyph: "done",
      label: "publish .NET",
      labelWidth: LABEL_WIDTH,
      detail: `${dim("Release \u00b7")} ${value(target.framework)} ${dim(`(${elapsed}s)`)}`,
    }),
  );

  return path.join(project.hostDir, "bin", "Release", target.framework);
};

const stepPackage = async (
  project: ProjectInfo,
  target: BuildTarget,
  bundlePath: string,
): Promise<string> => {
  const outputDir = path.join(project.root, "dist");
  fs.ensureDirSync(outputDir);

  const start = Date.now();
  let outputPath: string;
  try {
    outputPath = await target.package(bundlePath, outputDir, {
      projectName: project.projectName,
      displayVersion: project.displayVersion,
    });
  } catch (e: unknown) {
    console.error(
      row({
        glyph: "error",
        label: packageLabel(target),
        labelWidth: LABEL_WIDTH,
        detail: dim("packaging failed"),
      }),
    );
    console.error(dim(formatProcessError(e)));
    process.exit(1);
  }

  const pkgTime = ((Date.now() - start) / 1000).toFixed(1);
  const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
  console.log(
    row({
      glyph: "done",
      label: packageLabel(target),
      labelWidth: LABEL_WIDTH,
      detail: `${value(path.basename(outputPath))} ${dim(`(${sizeMB} MB, ${pkgTime}s)`)}`,
    }),
  );

  return outputPath;
};
