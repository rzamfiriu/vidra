import { describe, it, expect } from "vitest";
import {
  toPascalCase,
  toKebabCase,
  toTitleCase,
  toTextPath,
  parseArgs,
} from "../utils.js";

describe("toPascalCase", () => {
  it.each([
    ["my-app", "MyApp"],
    ["my_cool_app", "MyCoolApp"],
    ["already", "Already"],
    ["Already", "Already"],
    ["hello-world-cli", "HelloWorldCli"],
  ])("converts %s to %s", (input, expected) => {
    expect(toPascalCase(input)).toBe(expected);
  });

  it("leaves an empty string alone", () => {
    expect(toPascalCase("")).toBe("");
  });
});

describe("toKebabCase", () => {
  it.each([
    ["MyApp", "my-app"],
    ["myCoolApp", "my-cool-app"],
    ["my_thing", "my-thing"],
    ["already-kebab", "already-kebab"],
    ["Spaces And Words", "spaces-and-words"],
  ])("converts %s to %s", (input, expected) => {
    expect(toKebabCase(input)).toBe(expected);
  });
});

describe("toTitleCase", () => {
  it.each([
    ["my-cool-app", "My Cool App"],
    ["hello_world", "Hello World"],
    ["already Title", "Already Title"],
  ])("converts %s to %s", (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });
});

describe("toTextPath", () => {
  it("rewrites Windows backslash paths to forward slashes", () => {
    expect(toTextPath("D:\\a\\vidra\\vidra\\src\\sdk\\vidra-js")).toBe(
      "D:/a/vidra/vidra/src/sdk/vidra-js",
    );
  });

  it("is a no-op on POSIX-shaped paths", () => {
    const p = "/Users/runner/work/_temp/vidra-smoke/src/sdk";
    expect(toTextPath(p)).toBe(p);
  });

  // Regression: substituting a raw Windows path into ui/package.json
  // produced invalid JSON because `\a`, `\u`, etc. were read as escape
  // sequences. The normalized form must survive a JSON round-trip
  // verbatim, since that's what npm reads at install time.
  it("produces a string that is valid inside a JSON value", () => {
    const winPath = "D:\\a\\vidra\\vidra\\src\\sdk\\vidra-js";
    expect(() => JSON.parse(`{"x":"file:${winPath}"}`)).toThrow();
    expect(() =>
      JSON.parse(`{"x":"file:${toTextPath(winPath)}"}`),
    ).not.toThrow();
  });
});

describe("parseArgs", () => {
  const call = (...extra: string[]) => parseArgs(["node", "cli.mjs", ...extra]);

  it("collects positional arguments in _", () => {
    expect(call("build", "./out")).toEqual({ _: ["build", "./out"] });
  });

  it("parses --key=value pairs", () => {
    const parsed = call("--platform=mac");
    expect(parsed.platform).toBe("mac");
    expect(parsed._).toEqual([]);
  });

  it("parses --key value pairs", () => {
    const parsed = call("--platform", "mac");
    expect(parsed.platform).toBe("mac");
  });

  it("treats a trailing bare flag as true", () => {
    const parsed = call("--verbose");
    expect(parsed.verbose).toBe(true);
  });

  // A bare flag does not swallow a following flag: `--verbose --platform mac`
  // reads `verbose` as a boolean and `platform` as `mac`.
  it("treats a bare flag followed by another flag as boolean", () => {
    const parsed = call("--verbose", "--platform", "mac");
    expect(parsed.verbose).toBe(true);
    expect(parsed.platform).toBe("mac");
    expect(parsed._).toEqual([]);
  });

  it("mixes positional and flag args", () => {
    const parsed = call("dev", "--platform=mac", "--verbose");
    expect(parsed._).toEqual(["dev"]);
    expect(parsed.platform).toBe("mac");
    expect(parsed.verbose).toBe(true);
  });
});
