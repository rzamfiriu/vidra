import path from "node:path";
import fs from "fs-extra";
import type { AppMeta, BuildTarget } from "./types.js";

export const windowsTarget: BuildTarget = {
  name: "windows",
  framework: "net10.0-windows10.0.19041.0",
  extraPublishArgs:
    "-p:RuntimeIdentifierOverride=win-x64 -p:WindowsPackageType=MSIX",

  findBundle(publishDir: string, _projectName: string): string | null {
    const appPackagesDir = path.join(publishDir, "win-x64", "AppPackages");
    if (!fs.existsSync(appPackagesDir)) return null;

    for (const entry of fs.readdirSync(appPackagesDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(appPackagesDir, entry.name);
      for (const file of fs.readdirSync(subDir)) {
        if (file.endsWith(".msix")) {
          return path.join(subDir, file);
        }
      }
    }
    return null;
  },

  async package(
    msixPath: string,
    outputDir: string,
    meta: AppMeta,
  ): Promise<string> {
    const outName = `${meta.projectName}-${meta.displayVersion}-windows.msix`;
    const outPath = path.join(outputDir, outName);

    fs.copySync(msixPath, outPath, { overwrite: true });

    return outPath;
  },
};
