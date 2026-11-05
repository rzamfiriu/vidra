import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : listSourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });

// Declarations only: `function` inside a string or comment is not a violation,
// so match the keyword at a statement start.
const FUNCTION_DECLARATION = /^\s*(?:export\s+)?(?:async\s+)?function\b/m;
const CLASS_DECLARATION = /^\s*(?:export\s+)?(?:abstract\s+)?class\b/m;

// The runtime SDK, including generated output, is written as arrow-function
// factories over plain objects. This pins that rule so it does not drift.
describe("runtime SDK style", () => {
  const files = listSourceFiles(SRC_DIR);

  it("scans the runtime sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [relative(SRC_DIR, file), file]))(
    "%s has no function declarations or classes",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(FUNCTION_DECLARATION);
      expect(source).not.toMatch(CLASS_DECLARATION);
    },
  );
});
