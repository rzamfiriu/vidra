import fs from "fs-extra";
import path from "node:path";

export type Replacements = Record<string, string>;

// npm strips/renames dotfiles (notably `.gitignore`) from published tarballs, so
// such files are stored under a safe name in the template and restored on copy.
const TEMPLATE_FILE_RENAMES: Record<string, string> = {
  _gitignore: ".gitignore",
};

const TEXT_EXTS = new Set([
  ".cs",
  ".csproj",
  ".xaml",
  ".sln",
  ".json",
  ".xml",
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
  "",
]);

export const scaffoldDir = async (
  srcDir: string,
  destDir: string,
  replacements: Replacements,
): Promise<void> => {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destName =
      TEMPLATE_FILE_RENAMES[entry.name] ??
      applyReplacements(entry.name, replacements);
    const destPath = path.join(destDir, destName);

    if (entry.isDirectory()) {
      await fs.ensureDir(destPath);
      await scaffoldDir(srcPath, destPath, replacements);
    } else {
      const ext = path.extname(entry.name);

      if (TEXT_EXTS.has(ext)) {
        let content = await fs.readFile(srcPath, "utf8");
        content = applyReplacements(content, replacements);
        await fs.outputFile(destPath, content);
      } else {
        await fs.copy(srcPath, destPath);
      }
    }
  }
};

export const applyReplacements = (
  str: string,
  replacements: Replacements,
): string => {
  for (const [key, val] of Object.entries(replacements)) {
    str = str.replaceAll(key, val);
  }
  return str;
};
