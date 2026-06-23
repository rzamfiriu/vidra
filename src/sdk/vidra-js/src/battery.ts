import type { EventHandler } from "./types.js";
import { vidra } from "./singleton.js";
import { BatteryProxy, type BatteryStatus } from "./generated/battery.js";

export type BatteryChangedHandler = EventHandler<BatteryStatus>;

declare module "./generated/battery.js" {
  interface BatteryProxy {
    onChanged(handler: BatteryChangedHandler): () => void;
  }
}

BatteryProxy.prototype.onChanged = (
  handler: BatteryChangedHandler,
): () => void => {
  return vidra.on<BatteryStatus>("battery.changed", handler);
};

export {};
