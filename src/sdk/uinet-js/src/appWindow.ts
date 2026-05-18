import type { EventHandler } from "./types.js";
import { uinet } from "./singleton.js";
import { AppWindowProxy, type WindowInfo } from "./generated/appWindow.js";

export type AppWindowChangedHandler = EventHandler<WindowInfo>;
export interface ConfigureAppWindowOptions {
  title?: string | null;
  width?: number | null;
  height?: number | null;
}

declare module "./generated/appWindow.js" {
  interface AppWindowProxy {
    configure(args: ConfigureAppWindowOptions): Promise<WindowInfo>;
    onResized(handler: AppWindowChangedHandler): () => void;
    onStateChanged(handler: AppWindowChangedHandler): () => void;
  }
}

AppWindowProxy.prototype.onResized = (
  handler: AppWindowChangedHandler,
): () => void => {
  return uinet.on<WindowInfo>("appWindow.resized", handler);
};

AppWindowProxy.prototype.onStateChanged = (
  handler: AppWindowChangedHandler,
): () => void => {
  return uinet.on<WindowInfo>("appWindow.stateChanged", handler);
};

export {};
