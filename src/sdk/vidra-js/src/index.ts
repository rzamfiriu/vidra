export {
  createBridge,
  createExpectations,
  installWindowCallbacks,
} from "./client.js";
export type {
  BridgeOptions,
  Expectations,
  ExpectationScope,
  HostEntryPoints,
  UnsafeVidra,
  VidraBridge,
} from "./client.js";
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
  createBrowserFallbackTransport,
  createCustomSchemeTransport,
  createNativeMessageTransport,
  detectTransport,
  hasNativeMessageChannel,
  isNativeHost,
  NATIVE_CHANNEL,
} from "./transport.js";
export type {
  BrowserFallbackOptions,
  NativePoster,
  Transport,
  TransportDetection,
} from "./transport.js";
// The page's bridge lives in its own module to avoid circular dependencies
// with the generated barrel.
export { bridge, expectations, vidra } from "./bridge.js";
export type { Vidra } from "./bridge.js";

// Re-export generated typed contracts for built-in modules.
export * from "./generated/index.js";
