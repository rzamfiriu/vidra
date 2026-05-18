import { UINetClient } from "./client.js";

export type { UINetClient };

/**
 * Default singleton instance for convenience.
 * Lives in its own module to avoid circular dependencies
 * with the generated proxy barrel (generated/index.ts).
 */
export const uinet = new UINetClient();
