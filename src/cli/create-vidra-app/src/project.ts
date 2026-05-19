import path from "node:path";
import fs from "fs-extra";
import chalk from "chalk";

export interface ProjectInfo {
  root: string;
  hostDir: string;
  csprojPath: string;
  projectName: string;
  displayVersion: string;
  uiDir: string;
}

export const detectPlatform = (): string => {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "macos";
  }
};

export const detectProject = (cwd: string): ProjectInfo => {
  let dir = cwd;
  while (true) {
    const uiDir = path.join(dir, "ui");
    const srcDir = path.join(dir, "src");
    const pkgJson = path.join(dir, "package.json");

    if (
      fs.existsSync(pkgJson) &&
      fs.existsSync(uiDir) &&
      fs.existsSync(srcDir)
    ) {
      const csproj = findHostCsproj(srcDir);
      if (csproj) {
        const projectName = path.basename(csproj.dir).replace(/\.Host$/, "");
        const displayVersion = readCsprojVersion(csproj.path);
        return {
          root: dir,
          hostDir: csproj.dir,
          csprojPath: csproj.path,
          projectName,
          displayVersion,
          uiDir,
        };
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  console.error(
    chalk.red(
      "  Could not detect Vidra project. Run this command from your project root.\n" +
        "  Expected: package.json, ui/, src/<Name>.Host/<Name>.Host.csproj",
    ),
  );
  process.exit(1);
};

const findHostCsproj = (
  srcDir: string,
): { dir: string; path: string } | null => {
  if (!fs.existsSync(srcDir)) return null;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith(".Host")) {
      const csprojPath = path.join(
        srcDir,
        entry.name,
        `${entry.name}.csproj`,
      );
      if (fs.existsSync(csprojPath)) {
        return { dir: path.join(srcDir, entry.name), path: csprojPath };
      }
    }
  }
  return null;
};

const readCsprojVersion = (csprojPath: string): string => {
  const content = fs.readFileSync(csprojPath, "utf-8");
  const match = content.match(
    /<ApplicationDisplayVersion>(.*?)<\/ApplicationDisplayVersion>/,
  );
  return match?.[1] ?? "0.1.0";
};
