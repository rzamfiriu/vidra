import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { execFileSync } from "node:child_process";
import type { AppMeta, BuildTarget } from "./types.js";

/**
 * The scaffolded host is an unpackaged Win32 app (`WindowsPackageType=None`, no
 * `Package.appxmanifest`), so we can't emit an MSIX without re-authoring the
 * project and signing it. Instead we publish a self-contained, unpackaged build
 * — a folder with the `.exe`, the .NET runtime, and a bundled WindowsAppSDK —
 * and zip it. The result runs on any Windows machine once unzipped: no runtime
 * install, and no code-signing / certificate-trust dance.
 */
export const windowsTarget: BuildTarget = {
  name: "windows",
  framework: "net10.0-windows10.0.19041.0",
  // `RuntimeIdentifierOverride` (rather than `-r`/`RuntimeIdentifier`) is the
  // MAUI-recommended way to set the Windows RID — it sidesteps WindowsAppSDK
  // issue #3337, which otherwise pulls in the wrong packaging assets.
  extraPublishArgs:
    "-p:WindowsPackageType=None -p:SelfContained=true -p:WindowsAppSDKSelfContained=true -p:RuntimeIdentifierOverride=win-x64",

  findBundle(publishDir: string, _projectName: string): string | null {
    // `dotnet publish` writes the self-contained output to <rid>/publish/. The
    // app executable is named after the host *assembly* (e.g. `<Name>.Host.exe`),
    // not the stripped project name, so match any `.exe` rather than a specific
    // filename.
    const preferred = path.join(publishDir, "win-x64", "publish");
    if (dirContainsExe(preferred)) return preferred;
    // Fall back to a recursive search so we stay resilient to SDK layout
    // changes, preferring a directory literally named `publish`.
    return findDirWithExe(publishDir);
  },

  async package(
    publishOutputDir: string,
    outputDir: string,
    meta: AppMeta,
  ): Promise<string> {
    const outName = `${meta.projectName}-${meta.displayVersion}-windows.zip`;
    const outPath = path.join(outputDir, outName);
    if (fs.existsSync(outPath)) fs.removeSync(outPath);

    // Stage under a single <ProjectName>/ folder so unzipping yields one tidy
    // directory instead of spraying the runtime files into the current folder.
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "vidra-zip-"));
    const stagedApp = path.join(staging, meta.projectName);
    try {
      fs.copySync(publishOutputDir, stagedApp);
      // `Compress-Archive` ships with Windows PowerShell, so packaging needs no
      // extra tooling on the build machine.
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Compress-Archive -Path "${stagedApp}" -DestinationPath "${outPath}" -Force`,
        ],
        { stdio: "pipe" },
      );
    } finally {
      fs.removeSync(staging);
    }

    return outPath;
  },
};

const dirContainsExe = (dir: string): boolean =>
  fs.existsSync(dir) &&
  fs
    .readdirSync(dir, { withFileTypes: true })
    .some((e) => e.isFile() && e.name.toLowerCase().endsWith(".exe"));

/**
 * Depth-first search for a directory that contains an `.exe`. Prefers a
 * directory named `publish` (the canonical `dotnet publish` output) and falls
 * back to the first match found anywhere under {@link root}.
 */
const findDirWithExe = (root: string): string | null => {
  if (!fs.existsSync(root)) return null;
  let fallback: string | null = null;

  const walk = (dir: string): string | null => {
    if (dirContainsExe(dir)) {
      if (path.basename(dir) === "publish") return dir;
      fallback ??= dir;
    }
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const found = walk(path.join(dir, e.name));
        if (found) return found;
      }
    }
    return null;
  };

  return walk(root) ?? fallback;
};
