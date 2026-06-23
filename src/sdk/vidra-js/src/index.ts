export { VidraClient } from "./client.js";
export type { VidraClientOptions } from "./client.js";
export type {
  BridgeRequest,
  BridgeResponse,
  BridgeError,
  BridgeEvent,
  EventHandler,
  Capabilities,
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
export type {
  AppWindowChangedHandler,
  ConfigureAppWindowOptions,
} from "./appWindow.js";
export type { ConnectivityChangedHandler } from "./connectivity.js";
export type { BatteryChangedHandler } from "./battery.js";

// Extend the generated proxies with ergonomic event helpers.
import "./appWindow.js";
import "./connectivity.js";
import "./battery.js";

// Re-export the default singleton (lives in its own module to avoid
// circular dependencies with the generated proxy barrel).
export { vidra } from "./singleton.js";

// Re-export generated typed proxies for built-in modules.
export * from "./generated/index.js";
