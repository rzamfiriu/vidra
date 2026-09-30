import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  androidPublishArgs,
  androidTarget,
  escapeMsBuildProperty,
  resolveAndroidSigningConfig,
} from "../targets/android.js";

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    fs.removeSync(directory);
  }
});

const tempDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vidra-android-"));
  scratch.push(directory);
  return directory;
};

describe("Android signing", () => {
  it("escapes MSBuild property separators in user-controlled values", () => {
    expect(escapeMsBuildProperty("release;Injected=true")).toBe(
      "release%3BInjected=true",
    );
  });

  it("requires all four signing inputs once any is present", () => {
    expect(() =>
      resolveAndroidSigningConfig({ VIDRA_ANDROID_KEY_ALIAS: "release" }),
    ).toThrow(/incomplete/i);
  });

  it("keeps passwords out of the command line", () => {
    const directory = tempDirectory();
    const keyStore = path.join(directory, "release.jks");
    fs.writeFileSync(keyStore, "fixture");
    const config = resolveAndroidSigningConfig({
      VIDRA_ANDROID_KEYSTORE: keyStore,
      VIDRA_ANDROID_KEY_ALIAS: "release",
      VIDRA_ANDROID_KEY_PASSWORD: "key-secret",
      VIDRA_ANDROID_STORE_PASSWORD: "store-secret",
    })!;

    const publishArgs = androidPublishArgs(config);
    expect(publishArgs).toContain("-p:AndroidPackageFormats=apk%3Baab");
    const args = publishArgs.join(" ");
    expect(args).toContain("env:VIDRA_ANDROID_KEY_PASSWORD");
    expect(args).toContain("env:VIDRA_ANDROID_STORE_PASSWORD");
    expect(args).not.toContain("key-secret");
    expect(args).not.toContain("store-secret");
  });

  it("uses a dedicated cleartext symbol for the debuggable CI package", () => {
    const args = androidPublishArgs(
      { keyStore: "/tmp/release.jks", keyAlias: "release" },
      { VIDRA_ANDROID_DEBUGGABLE: "1" },
    );

    expect(args).toContain("-p:VidraAndroidTestRuntime=true");
    expect(args.some((arg) => arg.includes("DefineConstants"))).toBe(false);
  });
});

describe("androidTarget", () => {
  it("packages a signed APK and AAB and records the versionCode", async () => {
    const publish = tempDirectory();
    const projectRoot = tempDirectory();
    const output = path.join(projectRoot, "dist");
    fs.writeFileSync(path.join(publish, "App-Signed.apk"), "apk");
    fs.writeFileSync(path.join(publish, "App-Signed.aab"), "aab");

    expect(androidTarget.findBundle(publish, "App")).toBe(publish);
    const artifacts = await androidTarget.package(publish, output, {
      projectName: "App",
      displayVersion: "1.2.3",
      buildNumber: 10203,
      projectRoot,
    });

    expect(artifacts.map((artifact) => path.basename(artifact))).toEqual([
      "App-1.2.3-android.apk",
      "App-1.2.3-android.aab",
    ]);
    expect(fs.readFileSync(`${artifacts[1]}.version-code`, "utf8")).toBe("10203\n");
  });

  it("allows rebuilding the same versionCode before publication", async () => {
    const publish = tempDirectory();
    const projectRoot = tempDirectory();
    const output = path.join(projectRoot, "dist");
    fs.writeFileSync(path.join(publish, "App-Signed.apk"), "apk");
    fs.writeFileSync(path.join(publish, "App-Signed.aab"), "aab");
    const meta = {
      projectName: "App",
      displayVersion: "1.2.3",
      buildNumber: 10203,
      projectRoot,
    };

    await androidTarget.package(publish, output, meta);
    await expect(androidTarget.package(publish, output, meta)).resolves.toHaveLength(2);
  });

  it("rejects reusing a versionCode for a different local artifact", async () => {
    const publish = tempDirectory();
    const projectRoot = tempDirectory();
    fs.writeFileSync(path.join(publish, "App-Signed.apk"), "apk");
    fs.writeFileSync(path.join(publish, "App-Signed.aab"), "aab");

    await androidTarget.package(publish, path.join(projectRoot, "dist", "alpha"), {
      projectName: "App",
      displayVersion: "1.2.3-alpha",
      buildNumber: 10203,
      projectRoot,
    });
    await expect(
      androidTarget.package(publish, path.join(projectRoot, "dist", "beta"), {
        projectName: "App",
        displayVersion: "1.2.3-beta",
        buildNumber: 10203,
        projectRoot,
      }),
    ).rejects.toThrow(/another local artifact/);
  });

  it("rejects a versionCode lower than any previously packaged release", async () => {
    const publish = tempDirectory();
    const projectRoot = tempDirectory();
    const output = path.join(projectRoot, "dist", "beta");
    fs.writeFileSync(path.join(publish, "App-Signed.apk"), "apk");
    fs.writeFileSync(path.join(publish, "App-Signed.aab"), "aab");

    await androidTarget.package(publish, output, {
      projectName: "App",
      displayVersion: "2.0.0",
      buildNumber: 20000,
      projectRoot,
    });
    await expect(
      androidTarget.package(publish, path.join(projectRoot, "dist", "stable"), {
        projectName: "App",
        displayVersion: "2.0.1",
        buildNumber: 19999,
        projectRoot,
      }),
    ).rejects.toThrow(/cannot be lower/);
  });
});
