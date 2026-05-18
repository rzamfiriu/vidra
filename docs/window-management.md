# Window Management

## Overview

UINet now includes a built-in `appWindow` module for managing the primary native application window from the frontend.

The v1 design is intentionally simple:

- primary window only
- a small cross-platform core for title and size management
- typed request/response methods via codegen
- native-to-JS window events for resize and state changes

This gives app developers an easy way to manage the current window without forcing a multi-window API before the framework is ready for it.

## Supported API

### Methods

- `appWindow.getSupport()`
- `appWindow.getCurrent()`
- `appWindow.configure({ title?, width?, height? })`
- `appWindow.setTitle({ title })`
- `appWindow.setSize({ width, height })`
- `appWindow.center()`
- `appWindow.maximize()`
- `appWindow.minimize()`
- `appWindow.restore()`
- `appWindow.setFullscreen({ enabled })`

### Events

- `appWindow.onResized(handler)`
- `appWindow.onStateChanged(handler)`

Both events currently deliver the same `WindowInfo` snapshot shape:

```ts
type WindowInfo = {
  title: string;
  width: number;
  height: number;
  state: "restored" | "maximized" | "minimized" | "fullscreen";
};
```

`getSupport()` returns per-action support metadata so the frontend can decide which controls to render at runtime:

```ts
type WindowSupport = {
  platform: string;
  getCurrent: boolean;
  configure: boolean;
  setTitle: boolean;
  setSize: boolean;
  center: boolean;
  maximize: boolean;
  minimize: boolean;
  restore: boolean;
  setFullscreen: boolean;
};
```

## V1 Scope

The first release is intentionally limited to the most common desktop needs:

- reading the current title, size, and window state
- updating title and size
- reacting to resize and state changes from the frontend
- exposing runtime support metadata so unsupported actions can be hidden automatically

On `Windows`, the module also supports:

- centering
- maximizing
- minimizing
- restoring
- toggling fullscreen

## Non-Goals

These are explicitly deferred for now:

- multi-window creation and management
- window IDs or focused-window routing
- frameless windows
- always-on-top
- transparency and custom window chrome
- tray integration
- browser-only behavior beyond normal native-host errors

## Platform Notes

- UINet targets `Windows` and `Mac Catalyst`.
- `getCurrent()`, `configure()`, `setTitle()`, and `setSize()` are supported on both `Windows` and `Mac Catalyst`.
- `center()`, `maximize()`, `minimize()`, `restore()`, and `setFullscreen()` are currently supported on `Windows`.
- On `Mac Catalyst`, those state-changing actions return a managed `PlatformNotSupportedException` instead of attempting unsafe native window calls.
- Use `getSupport()` in frontend code rather than inferring support from the platform string.
- On Mac Catalyst, advanced desktop window behavior is implemented through the Catalyst/AppKit bridge, so the initial implementation is intentionally conservative.

## Manual Smoke Matrix

Use this checklist when changing the `appWindow` feature:

### macOS

- `getCurrent()` returns the expected title, size, and state
- `setTitle()` updates the native window title
- `setSize()` updates the native window size
- `center()` returns a managed not-supported error
- `maximize()` returns a managed not-supported error
- `minimize()` returns a managed not-supported error
- `restore()` returns a managed not-supported error
- `setFullscreen({ enabled: true })` returns a managed not-supported error
- `setFullscreen({ enabled: false })` returns a managed not-supported error
- `onResized()` fires when the user resizes the window
- `onStateChanged()` does not crash when unsupported actions are requested

### Windows

- `getCurrent()` returns the expected title, size, and state
- `setTitle()` updates the native window title
- `setSize()` updates the native window size
- `center()` re-centers the window
- `maximize()` updates the window state
- `minimize()` updates the window state
- `restore()` returns the window to normal state
- `setFullscreen({ enabled: true })` enters fullscreen
- `setFullscreen({ enabled: false })` exits fullscreen
- `onResized()` fires when the user resizes the window
- `onStateChanged()` fires for maximize, minimize, restore, and fullscreen transitions
