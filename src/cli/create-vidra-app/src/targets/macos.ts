import path from "node:path";
import fs from "fs-extra";
import { execSync } from "node:child_process";
import os from "node:os";
import type { AppMeta, BuildTarget } from "./types.js";

export const macosTarget: BuildTarget = {
  name: "macos",
  framework: "net10.0-maccatalyst",
  extraPublishArgs: "-p:CreatePackage=false",

  findBundle(publishDir: string, _projectName: string): string | null {
    if (!fs.existsSync(publishDir)) return null;
    for (const entry of fs.readdirSync(publishDir, { withFileTypes: true })) {
      if (entry.name.endsWith(".app") && entry.isDirectory()) {
        return path.join(publishDir, entry.name);
      }
    }
    return null;
  },

  async package(
    appPath: string,
    outputDir: string,
    meta: AppMeta,
  ): Promise<string> {
    const dmgName = `${meta.projectName}-${meta.displayVersion}-macos.dmg`;
    const dmgPath = path.join(outputDir, dmgName);
    const volName = meta.projectName;

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "vidra-dmg-"));
    try {
      fs.copySync(appPath, path.join(staging, path.basename(appPath)));
      fs.symlinkSync("/Applications", path.join(staging, "Applications"));

      if (fs.existsSync(dmgPath)) {
        fs.removeSync(dmgPath);
      }

      execSync(
        `hdiutil create -volname "${volName}" -srcfolder "${staging}" -ov -format UDZO "${dmgPath}"`,
        { stdio: "pipe" },
      );
    } finally {
      fs.removeSync(staging);
    }

    return dmgPath;
  },
};
