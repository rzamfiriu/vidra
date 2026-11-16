import path from "node:path";
import fs from "fs-extra";

/**
 * Store build numbers (Android's versionCode, iOS's CFBundleVersion) only go up,
 * and a store rejects one it has seen before. Each packaged artifact records its
 * number in a `<artifact>.<sidecar>` file under `dist/`, so a build can refuse a
 * number lower than one already packaged, or one another artifact already holds,
 * before it costs an upload. Rebuilding the same artifact at the same number is
 * fine: nothing has shipped until it is uploaded.
 */
export interface BuildNumberGuard {
  /** `Android versionCode`, `iOS build number`: how the error names the number. */
  label: string;
  /** Extension of the sidecar file, e.g. `version-code`. */
  sidecar: string;
}

export const assertBuildNumberIsNew = (
  guard: BuildNumberGuard,
  distDir: string,
  artifact: string,
  buildNumber: number,
): void => {
  const previous = highestRecordedBuildNumber(distDir, guard.sidecar);
  if (previous === null) return;
  if (buildNumber < previous) {
    throw new Error(
      `${guard.label} ${buildNumber} cannot be lower than the previously packaged ${previous}; set VIDRA_BUILD_NUMBER to a larger value`,
    );
  }
  if (buildNumber === previous && !fs.existsSync(sidecarPath(guard, artifact))) {
    throw new Error(
      `${guard.label} ${buildNumber} is already assigned to another local artifact; set VIDRA_BUILD_NUMBER to a larger value`,
    );
  }
};

export const recordBuildNumber = (
  guard: BuildNumberGuard,
  artifact: string,
  buildNumber: number,
): void => {
  fs.writeFileSync(sidecarPath(guard, artifact), `${buildNumber}\n`);
};

const sidecarPath = (guard: BuildNumberGuard, artifact: string): string =>
  `${artifact}.${guard.sidecar}`;

const highestRecordedBuildNumber = (distDir: string, sidecar: string): number | null => {
  if (!fs.existsSync(distDir)) return null;
  const values: number[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.name.endsWith(`.${sidecar}`)) {
        const value = Number(fs.readFileSync(fullPath, "utf8").trim());
        if (Number.isSafeInteger(value)) values.push(value);
      }
    }
  };
  visit(distDir);
  return values.length > 0 ? Math.max(...values) : null;
};
