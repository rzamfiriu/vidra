# Architecture

## Overview

Vidra uses a single `WebView` control as the host for all platforms, in both development and production. The framework owns the entire bridge between JavaScript and C#.

## Host Model

- **Development**: the WebView loads `http://localhost:5173` (or a configurable `VIDRA_DEV_URL`), allowing Vite HMR and standard browser dev tools.
- **Production**: the WebView loads bundled static assets from the app package (`Resources/Raw/wwwroot/index.html`).

The same bridge works in both modes because it relies on a custom URL scheme (`vidra://bridge`) intercepted by the MAUI `Navigating` event, not on any host-specific API.

## Bridge Protocol

All communication uses JSON envelopes.

### JS → C# (request)

```json
{
  "id": "req_1_1710000000000",
  "module": "filesystem",
  "method": "readText",
  "payload": { "path": "/tmp/f.txt" }
}
```

### C# → JS (response)

```json
{
  "id": "req_1_1710000000000",
  "success": true,
  "data": { "content": "file contents here" }
}
```

### C# → JS (event push)

```json
{
  "event": "app.resume",
  "data": {}
}
```

## Module System

Native modules implement `IBridgeModule` and are registered in `MauiProgram.cs`. Each module declares a name and a list of supported methods. The `BridgeDispatcher` routes incoming requests by module name.

## JS SDK

The TypeScript SDK (`@vidra-dev/sdk`) wraps the transport layer and exposes `invoke()`, `on()`, and `capabilities()`. It auto-detects whether it is running inside a native host or a plain browser and falls back to console logging in browser-only mode.
