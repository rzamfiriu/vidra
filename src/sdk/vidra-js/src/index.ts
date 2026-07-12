export { VidraClient } from "./client.js";
export type { UnsafeVidraClient, VidraClientOptions } from "./client.js";
export type {
  BridgeRequest,
  BridgeResponse,
  BridgeError,
  BridgeEvent,
  EventHandler,
  Capabilities,
  NativeContractCapabilities,
  BridgeHandshake,
  ReverseRequest,
  ReverseResponse,
  JsHandler,
} from "./types.js";
export {
  CustomSchemeTransport,
  BrowserFallbackTransport,
  NativeMessageTransport,
  hasNativeMessageChannel,
  NATIVE_CHANNEL,
} from "./transport.js";
export type { Transport } from "./transport.js";
// Re-export the default singleton (lives in its own module to avoid
// circular dependencies with the generated proxy barrel).
export { vidra } from "./singleton.js";

// Re-export generated typed proxies for built-in modules.
export * from "./generated/index.js";
