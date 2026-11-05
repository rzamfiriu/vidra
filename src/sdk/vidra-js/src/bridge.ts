import {
  type VidraBridge,
  createBridge,
  createExpectations,
  installWindowCallbacks,
} from "./client.js";

export type { VidraBridge } from "./client.js";

/**
 * The page's bridge. This module is the SDK's composition root and its only
 * side effect: the host protocol has one set of `window.__vidra_*` callbacks,
 * so one bridge is built here and the generated barrels bind to it.
 * Lives in its own module to avoid circular dependencies with the generated
 * barrel (generated/index.ts).
 */
export const expectations = createExpectations();
export const bridge = createBridge({ expectations });
installWindowCallbacks(bridge);

/** The dynamic, untyped surface of the page's bridge. */
export type Vidra = Pick<VidraBridge, "unsafe" | "capabilities">;

export const vidra: Vidra = {
  unsafe: bridge.unsafe,
  capabilities: bridge.capabilities,
};
