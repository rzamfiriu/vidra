import {
  defineConfig,
  events as builtInEvents,
  native as builtInNative,
} from "@vidra-dev/sdk/config";

export default defineConfig({
  bridge: {
    allow: [
      builtInNative.app.getInfo,
      builtInNative.appWindow.center,
      builtInNative.appWindow.configure,
      builtInNative.appWindow.getCurrent,
      builtInNative.appWindow.getSupport,
      builtInNative.appWindow.maximize,
      builtInNative.appWindow.minimize,
      builtInNative.appWindow.restore,
      builtInNative.appWindow.setTitle,
      builtInNative.browser.open,
      builtInNative.clipboard.getText,
      builtInNative.notifications.requestPermission,
      builtInNative.notifications.show,
    ],
    events: [
      builtInEvents.appWindow.resized,
      builtInEvents.appWindow.stateChanged,
      builtInEvents.runtime.hotReloaded,
    ],
  },
  updates: {
    feed: "",
  },
});
