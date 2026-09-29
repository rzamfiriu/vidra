import path from "node:path";
import { resolveAppVersionOrDefault } from "./version.js";
import fs from "fs-extra";
import { dim, footer, row } from "@vidra-dev/cli-shared/theme";

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
      return "android";
    default:
      return process.platform;
  }
};

export const detectProject = (cwd: string): ProjectInfo => {
  const project = tryDetectProject(cwd);
  if (project) return project;

  console.error(
    row({
      glyph: "error",
      detail: dim(
        "Could not detect Vidra project. Run this command from your project root.",
      ),
    }),
  );
  console.error(
    footer(dim("expected: package.json, ui/, src/<Name>.Host/<Name>.Host.csproj")),
  );
  process.exit(1);
};

/**
 * The same search, without the exit. `vidra doctor` runs anywhere, including a
 * repo root that is not an app, and "no project here" is a fact about the
 * directory rather than a failure of the command.
 */
export const tryDetectProject = (cwd: string): ProjectInfo | null => {
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
        const displayVersion = resolveAppVersionOrDefault(dir, csproj.path);
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

  return null;
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

