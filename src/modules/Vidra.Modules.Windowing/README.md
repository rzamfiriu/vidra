# Vidra Windowing Module

`Vidra.Modules.Windowing` provides primary-window management for [Vidra](https://vidra.build) desktop apps.

## Supported platforms

- Windows
- macOS via Mac Catalyst

## Bridge API

### `appWindow.getCurrent()`

Returns the current primary window snapshot:

```json
{
  "title": "My App",
  "width": 1100,
  "height": 760,
  "state": "restored"
}
```

### `appWindow.getSupport()`

Returns per-action support metadata for the current runtime so frontend code can hide unsupported
controls automatically.

Example:

```json
{
  "platform": "maccatalyst",
  "getCurrent": true,
  "configure": true,
  "setTitle": true,
  "setSize": true,
  "center": false,
  "maximize": false,
  "minimize": false,
  "restore": false,
  "setFullscreen": false
}
```

### `appWindow.configure({ title?, width?, height? })`

Applies partial updates to the current window.

### `appWindow.setTitle({ title })`

Sets the native window title.

### `appWindow.setSize({ width, height })`

Sets the native window size.

### `appWindow.center()`

Centers the current window on the active display.

### `appWindow.maximize()`

Maximizes the current window.

### `appWindow.minimize()`

Minimizes the current window.

### `appWindow.restore()`

Restores the window from a minimized, maximized, or fullscreen state.

### `appWindow.setFullscreen({ enabled })`

Enters or exits fullscreen mode.

Current platform note for state-changing actions:

- Windows: `center()`, `maximize()`, `minimize()`, `restore()`, and `setFullscreen()` are supported
- Mac Catalyst: those actions currently return managed not-supported errors

## JS SDK events

The generated `appWindow` proxy is extended with:

- `appWindow.onResized(handler)`
- `appWindow.onStateChanged(handler)`

Each handler receives the latest window snapshot.

## V1 scope

The first release is intentionally focused on the primary app window only.

Included:

- title updates
- window size updates
- resize and state-change events

Windows-only for now:

- centering
- maximize, minimize, restore
- fullscreen

Not included yet:

- multi-window management
- window IDs
- frameless windows
- always-on-top
- transparency
- custom title bar chrome

## Links

- Website: [vidra.build](https://vidra.build)
- GitHub: [rzamfiriu/vidra](https://github.com/rzamfiriu/vidra)
- NuGet: [Vidra.Modules.Windowing](https://www.nuget.org/packages/Vidra.Modules.Windowing)
