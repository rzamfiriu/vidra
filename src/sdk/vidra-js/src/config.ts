/**
 * Build-time Vidra application configuration.
 *
 * This module deliberately has no dependency on the browser bridge client, so
 * it can be imported safely while the Vidra CLI evaluates vidra.config.ts.
 */
import type { EventToken, NativeMethodToken } from "./config-tokens.js";

export type { EventToken, NativeMethodToken } from "./config-tokens.js";
export const FILESYSTEM_ROOT_TOKEN = "vidra.filesystem-root" as const;

export type FilesystemRootName =
  | "appData"
  | "cache"
  | "documents"
  | "downloads";

export interface FilesystemRootToken {
  readonly kind: typeof FILESYSTEM_ROOT_TOKEN;
  readonly name: FilesystemRootName;
  readonly relativePath?: string;
}

const root = (name: FilesystemRootName): FilesystemRootToken =>
  Object.freeze({ kind: FILESYSTEM_ROOT_TOKEN, name });

export const filesystemRoots = Object.freeze({
  appData: root("appData"),
  cache: root("cache"),
  documents: root("documents"),
  downloads: root("downloads"),
});

/**
 * Narrows a symbolic root to a relative child directory. Absolute paths and
 * traversal are rejected again by the CLI before a policy is emitted.
 */
export const within = (
  base: FilesystemRootToken,
  relativePath: string,
): FilesystemRootToken =>
  Object.freeze({
    kind: FILESYSTEM_ROOT_TOKEN,
    name: base.name,
    relativePath,
  });

export interface FilesystemGrant {
  readonly root: FilesystemRootToken;
  readonly allow: readonly NativeMethodToken[];
}

export interface BridgeConfig {
  readonly allow?: readonly NativeMethodToken[];
  readonly events?: readonly EventToken[];
  readonly filesystem?: readonly FilesystemGrant[];
}

export interface FeedSplit {
  readonly web?: string;
  readonly app?: string;
}

export interface UpdateConfig {
  readonly feed?: string | FeedSplit;
  readonly publicKeys?: readonly string[];
  readonly enabled?: boolean;
}

export interface VidraConfig {
  readonly bridge?: BridgeConfig;
  readonly updates?: UpdateConfig;
}

export interface VidraConfigContext {
  readonly command: "build" | "bundle" | "dev" | "doctor" | "run" | "updates";
  readonly mode: "development" | "production";
  readonly target: "macos" | "windows" | "android" | "ios" | null;
}

export type VidraConfigExport =
  | VidraConfig
  | ((context: VidraConfigContext) => VidraConfig | Promise<VidraConfig>);

/** Provides contextual typing while leaving runtime validation to the CLI. */
export const defineConfig = (config: VidraConfigExport): VidraConfigExport =>
  config;

export { native, events } from "./generated/access.js";
