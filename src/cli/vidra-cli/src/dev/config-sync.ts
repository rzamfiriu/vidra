import path from "node:path";
import fs from "fs-extra";
import { dim, row } from "@vidra-dev/cli-shared/theme";
import {
  loadVidraConfig,
  writeBridgePolicy,
  writeFrontendAccessFingerprint,
  VIDRA_CONFIG_FILE,
  type VidraConfigContext,
} from "../config.js";
import type { ProjectInfo } from "../project.js";
import { errorMessage } from "./messages.js";

// Editors save in bursts (truncate, write, rename); react once per burst.
const RELOAD_DEBOUNCE_MS = 100;

export interface ConfigSyncResult {
  readonly bridgePolicyChanged: boolean;
  readonly accessFingerprintChanged: boolean;
}

/**
 * Regenerates the host's bridge policy and the frontend's access fingerprint
 * from `vidra.config.ts`, writing only files whose contents changed.
 */
export const syncVidraConfig = async (
  project: ProjectInfo,
  context: VidraConfigContext,
): Promise<ConfigSyncResult> => {
  const loaded = await loadVidraConfig(project.root, context);
  const policy = writeBridgePolicy(project.hostDir, loaded);
  const fingerprint = writeFrontendAccessFingerprint(project.uiDir, loaded.accessFingerprint);
  return {
    bridgePolicyChanged: policy.changed,
    accessFingerprintChanged: fingerprint.changed,
  };
};

/**
 * Calls `onChange` shortly after `vidra.config.ts` changes, printing anything it
 * throws rather than ending the session. Returns a function that stops watching.
 */
export const watchVidraConfig = (
  projectRoot: string,
  onChange: () => Promise<void>,
): (() => void) => {
  let debounce: NodeJS.Timeout | undefined;

  const watcher = fs.watch(projectRoot, (_event, filename) => {
    // Some platforms omit the name; treat that as possibly ours.
    if (filename && path.basename(filename.toString()) !== VIDRA_CONFIG_FILE) return;

    clearTimeout(debounce);
    debounce = setTimeout(() => {
      onChange().catch((error: unknown) => {
        console.error(row({ glyph: "error", detail: dim(errorMessage(error)) }));
      });
    }, RELOAD_DEBOUNCE_MS);
  });

  return () => {
    clearTimeout(debounce);
    watcher.close();
  };
};
