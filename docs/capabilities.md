# Capabilities

Every method below is exposed through the JS SDK as a **generated, typed proxy** — the
payload and return columns map directly to the TypeScript argument and result types
emitted by `vidra-codegen` from the C# modules (see
[architecture.md](./architecture.md#type-safety--codegen)):

```typescript
import { filesystem } from "@vidra-dev/sdk";

// Fully typed: `path` is required, `content` is inferred as `string`.
const { content } = await filesystem.readText({ path: "/tmp/notes.txt" });
```

## Built-in native contracts

### `filesystem`

| Method          | Payload                     | Returns                              |
|-----------------|-----------------------------|--------------------------------------|
| `readText`      | `{ path }`                  | `{ content }`                        |
| `writeText`     | `{ path, content }`         | `{ success }`                        |
| `exists`        | `{ path }`                  | `{ exists }`                         |
| `delete`        | `{ path }`                  | `{ success }`                        |
| `listDirectory` | `{ path }`                  | `{ entries: [{ name, isDirectory }] }` |

### `dialogs`

| Method    | Payload                                      | Returns          |
|-----------|----------------------------------------------|------------------|
| `alert`   | `{ title, message, ok? }`                    | `{ dismissed }`  |
| `confirm` | `{ title, message, accept?, cancel? }`       | `{ confirmed }`  |
| `prompt`  | `{ title, message?, accept?, cancel? }`      | `{ value }`      |

### `clipboard`

| Method    | Payload      | Returns        |
|-----------|-------------|----------------|
| `getText` | none        | `{ text }`     |
| `setText` | `{ text }`  | `{ success }`  |
| `hasText` | none        | `{ hasText }`  |

### `notifications`

| Method              | Payload              | Returns         |
|---------------------|----------------------|-----------------|
| `show`              | `{ title, body? }`   | `{ scheduled }` |
| `requestPermission` | none                 | `{ granted }`   |

### `appWindow`

| Method          | Payload                           | Returns                                      |
|-----------------|-----------------------------------|----------------------------------------------|
| `getSupport`    | none                              | `{ platform, getCurrent, configure, ... }`   |
| `getCurrent`    | none                              | `{ title, width, height, state }`            |
| `configure`     | `{ title?, width?, height? }`     | `{ title, width, height, state }`            |
| `setTitle`      | `{ title }`                       | `{ title, width, height, state }`            |
| `setSize`       | `{ width, height }`               | `{ title, width, height, state }`            |
| `center`        | none                              | `{ title, width, height, state }`            |
| `maximize`      | none                              | `{ title, width, height, state }`            |
| `minimize`      | none                              | `{ title, width, height, state }`            |
| `restore`       | none                              | `{ title, width, height, state }`            |
| `setFullscreen` | `{ enabled }`                     | `{ title, width, height, state }`            |

The JS SDK also exposes:

- `appWindow.onResized(handler)`
- `appWindow.onStateChanged(handler)`

Notes:

- `getSupport()` returns per-action runtime metadata so the frontend can hide unsupported controls automatically.
- `getCurrent()`, `configure()`, `setTitle()`, and `setSize()` are supported on Windows and Mac Catalyst.
- `center()`, `maximize()`, `minimize()`, `restore()`, and `setFullscreen()` are currently supported on Windows.
- On Mac Catalyst, those state-changing actions return managed not-supported errors instead of attempting unsafe native window calls.

### `app`

| Method     | Payload | Returns                                                      |
|------------|---------|--------------------------------------------------------------|
| `getInfo`  | none    | `{ appName, packageName, version, build, platform, idiom }`  |
| `getTheme` | none    | `{ theme }`                                                  |

## MAUI Essentials Modules

These modules wrap [.NET MAUI Essentials](https://learn.microsoft.com/dotnet/maui/platform-integration/),
giving the web layer typed access to platform device features. Call
`essentials.getSupport()` to feature-detect before invoking a method that may be
unavailable on the current platform.

### `secureStorage`

Encrypted key/value storage (Keychain on Apple platforms, Credential Locker / DPAPI on Windows).

| Method      | Payload          | Returns        |
|-------------|------------------|----------------|
| `get`       | `{ key }`        | `{ value? }`   |
| `set`       | `{ key, value }` | `{ success }`  |
| `remove`    | `{ key }`        | `{ removed }`  |
| `removeAll` | none             | `{ success }`  |

`get` returns `value?: string | null` — `null` when the key is absent.

### `preferences`

Lightweight, unencrypted app settings. Use `secureStorage` for secrets.

| Method        | Payload          | Returns       |
|---------------|------------------|---------------|
| `get`         | `{ key }`        | `{ value? }`  |
| `set`         | `{ key, value }` | `{ success }` |
| `remove`      | `{ key }`        | `{ success }` |
| `containsKey` | `{ key }`        | `{ exists }`  |
| `clear`       | none             | `{ success }` |

### `device`

| Method       | Payload | Returns                                                                |
|--------------|---------|-----------------------------------------------------------------------|
| `getInfo`    | none    | `{ model, manufacturer, name, version, platform, idiom, deviceType }` |
| `getDisplay` | none    | `{ width, height, density, orientation, rotation }`                   |

### `share`

| Method      | Payload                            | Returns       |
|-------------|------------------------------------|---------------|
| `shareText` | `{ text, title?, subject?, uri? }` | `{ success }` |

### `browser`

| Method | Payload                                           | Returns       |
|--------|---------------------------------------------------|---------------|
| `open` | `{ url, mode?: "systemPreferred" \| "external" }` | `{ success }` |

### `launcher`

Opens URIs in their default handler (`mailto:`, `tel:`, custom schemes, files).

| Method    | Payload   | Returns       |
|-----------|-----------|---------------|
| `open`    | `{ uri }` | `{ success }` |
| `canOpen` | `{ uri }` | `{ canOpen }` |

### `email`

| Method    | Payload                               | Returns       |
|-----------|---------------------------------------|---------------|
| `compose` | `{ subject?, body?, to?, cc?, bcc? }` | `{ success }` |

### `filePicker`

Returns file **metadata** only; read contents through `filesystem` using the returned `fullPath`.

| Method         | Payload      | Returns                                             |
|----------------|--------------|-----------------------------------------------------|
| `pickOne`      | `{ title? }` | `{ file?: { fileName, fullPath, contentType? } }`   |
| `pickMultiple` | `{ title? }` | `{ files: [{ fileName, fullPath, contentType? }] }` |

`pickOne` returns `file: null` when the dialog is cancelled.

### `textToSpeech`

| Method  | Payload                     | Returns       |
|---------|-----------------------------|---------------|
| `speak` | `{ text, pitch?, volume? }` | `{ success }` |

### `connectivity`

| Method      | Payload | Returns                |
|-------------|---------|------------------------|
| `getStatus` | none    | `{ access, profiles }` |

- `access`: `"unknown" | "none" | "local" | "constrainedInternet" | "internet"`
- `profiles`: `("unknown" | "bluetooth" | "cellular" | "ethernet" | "wifi")[]`
- Generated event method: `connectivity.onChanged(handler)`.

### `battery`

| Method      | Payload | Returns                                            |
|-------------|---------|----------------------------------------------------|
| `getStatus` | none    | `{ chargeLevel, state, powerSource, energySaver }` |

- `state`: `"unknown" | "charging" | "discharging" | "full" | "notCharging" | "notPresent"`
- `powerSource`: `"unknown" | "battery" | "ac" | "wireless"`
- `energySaver`: `"unknown" | "on" | "off"`
- Generated event method: `battery.onChanged(handler)`.

### `essentials`

| Method       | Payload | Returns                            |
|--------------|---------|------------------------------------|
| `getSupport` | none    | `{ platform, secureStorage, ... }` |

`getSupport()` returns a per-platform boolean for each Essentials capability so the
frontend can feature-detect (mirrors `appWindow.getSupport()`).

## Querying Capabilities at Runtime

```typescript
const caps = await vidra.capabilities();
// {
//   protocolVersion: 2,
//   nativeContracts: {
//     filesystem: { methods: ['readText', 'writeText', ...], events: [] },
//     connectivity: { methods: ['getStatus'], events: ['changed'] }
//   }
// }
```

`runtime.onHotReloaded(handler)` is an event-only generated contract used by
`vidra dev`. App-owned JS contracts are generated into the app rather than listed
as native capabilities because handler registration is dynamic.
