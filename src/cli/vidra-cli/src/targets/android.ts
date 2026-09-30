import path from "node:path";
import fs from "fs-extra";
import { spawnSync } from "node:child_process";
import type { AppMeta, BuildTarget } from "./types.js";

export interface AndroidSigningConfig {
  keyStore: string;
  keyAlias: string;
}

export interface AndroidVerification {
  ok: boolean;
  tool: string;
  output: string;
}

export const resolveAndroidSigningConfig = (
  env: NodeJS.ProcessEnv = process.env,
): AndroidSigningConfig | null => {
  const keyStore = env.VIDRA_ANDROID_KEYSTORE?.trim();
  const keyAlias = env.VIDRA_ANDROID_KEY_ALIAS?.trim();
  const keyPassword = env.VIDRA_ANDROID_KEY_PASSWORD;
  const storePassword = env.VIDRA_ANDROID_STORE_PASSWORD;

  if (!keyStore && !keyAlias && !keyPassword && !storePassword) return null;
  if (!keyStore || !keyAlias || !keyPassword || !storePassword) {
    throw new Error(
      "Android signing is incomplete — set VIDRA_ANDROID_KEYSTORE, VIDRA_ANDROID_KEY_ALIAS, VIDRA_ANDROID_KEY_PASSWORD, and VIDRA_ANDROID_STORE_PASSWORD",
    );
  }
  if (!fs.existsSync(keyStore)) {
    throw new Error(`Android keystore not found: ${keyStore}`);
  }
  return { keyStore: path.resolve(keyStore), keyAlias };
};

export const androidPublishArgs = (
  signing: AndroidSigningConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] => [
    "-p:AndroidPackageFormats=apk%3Baab",
    "-p:AndroidKeyStore=true",
    `-p:AndroidSigningKeyStore=${escapeMsBuildProperty(signing.keyStore)}`,
    `-p:AndroidSigningKeyAlias=${escapeMsBuildProperty(signing.keyAlias)}`,
    "-p:AndroidSigningKeyPass=env:VIDRA_ANDROID_KEY_PASSWORD",
    "-p:AndroidSigningStorePass=env:VIDRA_ANDROID_STORE_PASSWORD",
    ...(env.VIDRA_ANDROID_DEBUGGABLE === "1"
      ? ["-p:VidraAndroidTestRuntime=true"]
      : []),
  ];

export const escapeMsBuildProperty = (value: string): string =>
  value.replace(
    /[%$@';?*()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const verifyAndroidPackage = (artifact: string): AndroidVerification => {
  const apk = artifact.endsWith(".apk");
  const signerJar = apk ? resolveApkSignerJar() : null;
  if (apk && !signerJar) {
    return {
      ok: false,
      tool: "apksigner",
      output: "apksigner was not found in Android SDK build-tools",
    };
  }
  const tool = apk ? "apksigner" : "jarsigner";
  const executable = apk ? "java" : "jarsigner";
  const args = apk
    ? ["-jar", signerJar!, "verify", "--verbose", artifact]
    : ["-verify", artifact];
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\n");
  const affirmativelySigned = apk || /\bjar verified\b/i.test(output);
  return {
    ok: result.status === 0 && affirmativelySigned,
    tool,
    output,
  };
};

export const androidTarget: BuildTarget = {
  name: "android",
  framework: "net10.0-android",

  findBundle(publishDir: string): string | null {
    const files = findAndroidPackages(publishDir);
    return files.some((file) => file.endsWith(".apk"))
      && files.some((file) => file.endsWith(".aab"))
      ? publishDir
      : null;
  },

  async package(
    publishDir: string,
    outputDir: string,
    meta: AppMeta,
  ): Promise<string[]> {
    const packages = findAndroidPackages(publishDir);
    const apk = preferredPackage(packages, ".apk");
    const aab = preferredPackage(packages, ".aab");
    if (!apk || !aab) {
      throw new Error(`Android publish did not produce both an APK and AAB under ${publishDir}`);
    }

    fs.ensureDirSync(outputDir);
    const apkOut = path.join(
      outputDir,
      `${meta.projectName}-${meta.displayVersion}-android.apk`,
    );
    const aabOut = path.join(
      outputDir,
      `${meta.projectName}-${meta.displayVersion}-android.aab`,
    );
    const versionCodeFile = `${aabOut}.version-code`;
    const previous = highestPackagedVersionCode(path.join(meta.projectRoot, "dist"));
    if (previous !== null && meta.buildNumber < previous) {
      throw new Error(
        `Android versionCode ${meta.buildNumber} cannot be lower than the previously packaged ${previous}; set VIDRA_BUILD_NUMBER to a larger value`,
      );
    }
    if (
      previous !== null
      && meta.buildNumber === previous
      && !fs.existsSync(versionCodeFile)
    ) {
      throw new Error(
        `Android versionCode ${meta.buildNumber} is already assigned to another local artifact; set VIDRA_BUILD_NUMBER to a larger value`,
      );
    }

    fs.copySync(apk, apkOut, { overwrite: true });
    fs.copySync(aab, aabOut, { overwrite: true });
    fs.writeFileSync(versionCodeFile, `${meta.buildNumber}\n`);
    return [apkOut, aabOut];
  },
};

const preferredPackage = (files: string[], extension: ".apk" | ".aab"): string | null => {
  const matching = files.filter((file) => file.toLowerCase().endsWith(extension));
  return matching.find((file) => /-signed\.(?:apk|aab)$/i.test(file))
    ?? matching[0]
    ?? null;
};

const findAndroidPackages = (root: string): string[] => {
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.(?:apk|aab)$/i.test(entry.name)) found.push(fullPath);
    }
  };
  visit(root);
  return found;
};

const highestPackagedVersionCode = (outputDir: string): number | null => {
  if (!fs.existsSync(outputDir)) return null;
  const values: number[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.name.endsWith(".aab.version-code")) {
        const value = Number(fs.readFileSync(fullPath, "utf8").trim());
        if (Number.isSafeInteger(value)) values.push(value);
      }
    }
  };
  visit(outputDir);
  return values.length > 0 ? Math.max(...values) : null;
};

const resolveApkSignerJar = (): string | null => {
  const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  if (!sdk) return null;
  const buildTools = path.join(sdk, "build-tools");
  if (!fs.existsSync(buildTools)) return null;
  const versions = fs
    .readdirSync(buildTools, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(buildTools, version, "lib", "apksigner.jar");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};
