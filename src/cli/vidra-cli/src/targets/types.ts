import type { MauiTarget } from "@vidra-dev/cli-shared/dotnet-toolchain";

export interface AppMeta {
  projectName: string;
  displayVersion: string;
  buildNumber: number;
  projectRoot: string;
}

export interface BuildTarget {
  name: MauiTarget;
  framework: string;
  /** What `package` writes, the one named in the plan first. */
  artifactExtensions: readonly string[];
  /** Goes between the version and the extension in artifact names; `name` when unset. */
  artifactSuffix?: string;
  packageLabel: string;
  /** Whether a whole-app (Velopack) feed can ship this target. */
  supportsNativeUpdates: boolean;
  /** `build` where the SDK refuses to `publish` what this target makes. */
  dotnetVerb?: "publish" | "build";
  extraPublishArgs?: string[];
  /**
   * A directory under the host's `obj/Release/<framework>` that must not
   * survive into the next build; deleted before each one.
   */
  discardIntermediates?: string;
  findBundle(publishDir: string, projectName: string): string | null;
  package(appPath: string, outputDir: string, meta: AppMeta): Promise<string[]>;
}

export const artifactFileName = (
  target: BuildTarget,
  meta: Pick<AppMeta, "projectName" | "displayVersion">,
  extension: string = target.artifactExtensions[0],
): string =>
  `${meta.projectName}-${meta.displayVersion}-${target.artifactSuffix ?? target.name}${extension}`;
