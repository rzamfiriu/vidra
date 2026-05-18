# Capabilities

## Built-in Modules

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

## Querying Capabilities at Runtime

```typescript
const caps = await uinet.capabilities();
// { filesystem: ['readText', 'writeText', ...], clipboard: [...], ... }
```
