# @vidra-dev/sdk

Framework-agnostic TypeScript SDK for the
[Vidra](https://vidra.build) bridge.

> **Alpha:** APIs may change between 0.x releases.

## Install

```bash
npm install @vidra-dev/sdk
```

Most applications should start with
[`create-vidra-app`](https://www.npmjs.com/package/create-vidra-app), which
configures the SDK and generated app contracts automatically.

## Usage

```ts
import { appWindow, clipboard, connectivity, vidra } from "@vidra-dev/sdk";

const { text } = await clipboard.getText();
const currentWindow = await appWindow.getCurrent();

const unsubscribe = connectivity.onChanged(status => {
  console.log(status.access);
});

const capabilities = await vidra.capabilities();
```

Built-in native methods and events are generated from C# contracts, providing
typed payloads, results, and editor completion. App-owned contracts are
generated into the application.

## How the SDK is put together

The SDK is written as arrow-function factories over plain objects; there are
no classes. Every generated contract is a factory such as
`createClipboard(bridge)`, and the exports above are those factories bound to
the page's bridge.

That bridge is built in one module, `bridge.ts`, which is the SDK's only
side effect: it calls `createBridge(...)`, installs the `window.__vidra_*`
callbacks the native host talks to, and exports `bridge`, `expectations`, and
`vidra`. The host protocol has exactly one callback set per page, so there is
one bridge per page.

Generated barrels and the Vidra CLI record the fingerprints they were produced
against with `expectations.declare(scope, fingerprint)`. Declarations are
write-once per scope: declaring the same value again is a no-op, a different
value throws because two generated modules for the same scope are loaded. When
the host sends its handshake, the bridge compares the declared `core`, `app`,
and `access` fingerprints and renders a visible error on mismatch.

### Isolated bridges

For tests, or to supply a custom transport, build a bridge yourself. Nothing
touches `window` unless you ask it to:

```ts
import {
  createBridge,
  createClipboard,
  createExpectations,
  installWindowCallbacks,
} from "@vidra-dev/sdk";

const bridge = createBridge({ transport: myTransport, timeout: 5_000 });
const clipboard = createClipboard(bridge);

// Only if the native host should reach this bridge:
const uninstall = installWindowCallbacks(bridge);
```

`installWindowCallbacks` returns an uninstaller that removes only the callbacks
it installed.

## Documentation

- [Getting started](https://vidra.build/docs/getting-started/)
- [Capabilities](https://vidra.build/docs/reference/capabilities/)
- [Code generation](https://vidra.build/docs/bridge/code-generation/)
- [Bridge protocol](https://vidra.build/docs/bridge/protocol/)

## License

MIT
