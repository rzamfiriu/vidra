# Vidra Documentation

[Vidra](https://vidra.build) is a C#/.NET native core with a web UI and a typed
bridge generated from your own code. These docs cover how it works under the hood
and the full bridge API surface.

> **Alpha.** Vidra is 0.x — APIs and docs may change between releases.

## Contents

| Doc | What's inside |
| --- | --- |
| [Architecture](./architecture.md) | The single-`WebView` host model, the JS ↔ C# bridge, transport selection, and how type-safe codegen keeps both sides in lockstep. |
| [Capabilities](./capabilities.md) | Every built-in module and its bridge methods — `filesystem`, `dialogs`, `clipboard`, `notifications`, `app`, `appWindow`, plus MAUI Essentials — as generated, typed proxies. |
| [Interop Protocol](./interop-protocol.md) | Protocol v2 envelopes, negotiation, transports, event contracts, and JS contracts. |
| [Testing](./testing.md) | The layered test strategy (unit → contract → integration → smoke → manual), what runs in CI, and the manual release checklist. |
| [Protocol v2 migration](./migrations/protocol-v2.md) | Breaking package compatibility, generated contract setup, and old/new API examples. |

## New to Vidra?

Scaffold an app in one command:

```bash
npm create vidra-app@latest
```

Then start with the [Architecture](./architecture.md) overview and the
[Capabilities](./capabilities.md) reference.

## Links

- Website: [vidra.build](https://vidra.build)
- npm: [create-vidra-app](https://www.npmjs.com/package/create-vidra-app) · [@vidra-dev/sdk](https://www.npmjs.com/package/@vidra-dev/sdk)
- Repository: [rzamfiriu/vidra](https://github.com/rzamfiriu/vidra)
