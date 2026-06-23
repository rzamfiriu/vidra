import type { EventHandler } from "./types.js";
import { vidra } from "./singleton.js";
import {
  ConnectivityProxy,
  type ConnectivityStatus,
} from "./generated/connectivity.js";

export type ConnectivityChangedHandler = EventHandler<ConnectivityStatus>;

declare module "./generated/connectivity.js" {
  interface ConnectivityProxy {
    onChanged(handler: ConnectivityChangedHandler): () => void;
  }
}

ConnectivityProxy.prototype.onChanged = (
  handler: ConnectivityChangedHandler,
): () => void => {
  return vidra.on<ConnectivityStatus>("connectivity.changed", handler);
};

export {};
