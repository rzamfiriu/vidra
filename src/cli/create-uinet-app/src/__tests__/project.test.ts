import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { detectProject, detectPlatform } from "../project.js";

describe("detectPlatform", () => {
  it("maps process.platform to a UINet platform name", () => {
    const actual = detectPlatform();
    expect(["macos", "windows", "linux"]).toContain(actual);
  });
});

describe("detectProject", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "uinet-project-"));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  const makeProject = async (name: string, version = "0.1.0") => {
    await fs.outputFile(path.join(root, "package.json"), "{}");
    await fs.ensureDir(path.join(root, "ui"));
    const hostDir = path.join(root, "src", `${name}.Host`);
    await fs.outputFile(
      path.join(hostDir, `${name}.Host.csproj`),
      `<Project><ApplicationDisplayVersion>${version}</ApplicationDisplayVersion></Project>`,
    );
  };

  it("detects project from the root dir", async () => {
    await makeProject("MyApp", "1.2.3");

    const info = detectProject(root);
    expect(info.root).toBe(root);
    expect(info.projectName).toBe("MyApp");
    expect(info.displayVersion).toBe("1.2.3");
    expect(info.csprojPath.endsWith("MyApp.Host.csproj")).toBe(true);
  });

  it("walks up from a nested cwd to find the project root", async () => {
    await makeProject("NestedApp");
    const nested = path.join(root, "ui", "src");
    await fs.ensureDir(nested);

    const info = detectProject(nested);
    expect(info.root).toBe(root);
    expect(info.projectName).toBe("NestedApp");
  });

  it("falls back to 0.1.0 when the csproj has no ApplicationDisplayVersion", async () => {
    await fs.outputFile(path.join(root, "package.json"), "{}");
    await fs.ensureDir(path.join(root, "ui"));
    const hostDir = path.join(root, "src", "Plain.Host");
    await fs.outputFile(path.join(hostDir, "Plain.Host.csproj"), "<Project />");

    const info = detectProject(root);
    expect(info.displayVersion).toBe("0.1.0");
  });

  it("exits with a helpful message when no project is found", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => {
        throw new Error("__exit__");
      }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => detectProject(root)).toThrow("__exit__");
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toMatch(/Could not detect UINet project/);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
