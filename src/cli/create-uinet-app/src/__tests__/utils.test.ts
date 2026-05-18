import { describe, it, expect } from "vitest";
import { toPascalCase, toKebabCase, toTitleCase, parseArgs } from "../utils.js";

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

  // Current behavior: a bare flag ALWAYS consumes the next argv token,
  // even when that token is another flag. This is a minor quirk; if we
  // change it, this test should flip to expect `{ verbose: true, platform: "mac" }`.
  it("consumes the next token after a bare flag (quirk)", () => {
    const parsed = call("--verbose", "--platform", "mac");
    expect(parsed.verbose).toBe("--platform");
    expect(parsed._).toEqual(["mac"]);
  });

  it("mixes positional and flag args", () => {
    const parsed = call("dev", "--platform=mac", "--verbose");
    expect(parsed._).toEqual(["dev"]);
    expect(parsed.platform).toBe("mac");
    expect(parsed.verbose).toBe(true);
  });
});
