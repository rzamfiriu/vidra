import { VidraClient } from "./client.js";

export type { VidraClient };

/**
 * Default singleton instance for convenience.
 * Lives in its own module to avoid circular dependencies
 * with the generated proxy barrel (generated/index.ts).
 */
export const vidra = new VidraClient();
