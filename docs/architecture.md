# Architecture

## Overview

Vidra uses a single `WebView` control as the host for all platforms, in both development and production. The framework owns the entire bridge between JavaScript and C#.

## Host Model

- **Development**: the WebView loads `http://localhost:5173` (or a configurable `VIDRA_DEV_URL`), allowing Vite HMR and standard browser dev tools.
- **Production**: the WebView loads bundled static assets from the app package (`Resources/Raw/wwwroot/index.html`).

The same bridge works in both modes. For JS→C# traffic it prefers a first-class
native message channel (WKWebView script messages / WebView2 web messages) and
falls back to a custom URL scheme (`vidra://bridge`) intercepted by the MAUI
`Navigating` event when no native channel is available. See
[interop-protocol.md](./interop-protocol.md) for details.

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

On top of the low-level `invoke()`, the SDK ships **generated, typed proxies** for each built-in module (`filesystem`, `dialogs`, `clipboard`, `notifications`, `appWindow`, `app`). These are emitted by `vidra-codegen` from the C# module definitions, so the JS argument and result types stay in lockstep with the native contract. See [Type Safety & Codegen](#type-safety--codegen).

## Type Safety & Codegen

C# is the single source of truth for the bridge contract. Each native module is a plain class annotated with `[BridgeModule]` / `[BridgeMethod]`, and its argument and result types are ordinary records:

```csharp
public record ReadTextArgs(string Path);
public record ReadTextResult(string Content);

[BridgeModule("filesystem")]
public sealed class FileSystemModule : BridgeModuleBase
{
    [BridgeMethod("readText")]
    public Task<ReadTextResult> ReadTextAsync(ReadTextArgs args, CancellationToken ct) { /* ... */ }
}
```

`vidra-codegen` (`src/tools/Vidra.CodeGen`) scans the compiled module assemblies with `MetadataLoadContext` — no MAUI runtime required — and emits:

- `manifest.json`: the module / method / type manifest.
- One typed TypeScript proxy per module (e.g. `filesystem.ts`) plus a barrel `index.ts`.

C# types map to idiomatic TypeScript:

| C# | TypeScript |
|----|------------|
| `record` / class with properties | `interface` |
| `string`, `Guid`, `DateTime` | `string` |
| numeric types | `number` |
| `bool` | `boolean` |
| `T[]`, `List<T>`, `IReadOnlyList<T>` | `T[]` |
| `Dictionary<string, T>` | `Record<string, T>` |
| `enum` | string-literal union (e.g. `"restored" \| "maximized"`) |
| `Nullable<T>` | optional `T \| null` |

The generated proxy turns the records above into:

```ts
export interface ReadTextArgs { path: string; }
export interface ReadTextResult { content: string; }

export class FilesystemProxy {
  readText(args: ReadTextArgs): Promise<ReadTextResult> {
    return this.client.invoke("filesystem", "readText", args);
  }
}
```

Generation runs automatically on build via the `Vidra.CodeGen.targets` MSBuild target (`AfterTargets="Build"`), so the SDK's `src/generated/` proxies stay in sync with the native modules. Because both sides derive from the same definitions, JS and C# can't silently drift; the emitted output is additionally pinned by snapshot tests (see [testing.md](./testing.md)).
