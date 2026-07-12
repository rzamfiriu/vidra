# @vidra-dev/sdk

Framework-agnostic TypeScript SDK for the [Vidra](https://vidra.build)
bridge between a web UI and a native .NET MAUI host.

> **Alpha.** APIs may change between 0.x releases.

## Install

```bash
npm install @vidra-dev/sdk
```

Most apps are scaffolded with [`create-vidra-app`](https://www.npmjs.com/package/create-vidra-app),
which wires this up for you.

## Usage

The SDK ships **generated, fully-typed proxies** for every native module, so calls are
checked at compile time with full editor autocomplete:

```ts
import { filesystem, appWindow, connectivity, runtime, vidra } from "@vidra-dev/sdk";

// `path` is required and typo-checked; `content` is inferred as `string`.
const { content } = await filesystem.readText({ path: "/tmp/notes.txt" });

// `state` is a typed union, not a bare string.
const { state } = await appWindow.getCurrent();

// Event payloads and names are generated too.
connectivity.onChanged(status => console.log(status.access));
runtime.onHotReloaded(update => console.log(update.updatedTypes));

// Discover what the host supports at runtime
const caps = await vidra.capabilities();
```

## Type safety via codegen

These proxies aren't hand-written: C# native, event, and JS contracts drive a Roslyn
generator plus `vidra-codegen`. Generated manifests are fingerprinted and compared at
WebView startup, so stale app output or mismatched SDK/native packages fail clearly.

App-owned JS contracts generate handler registries into the configured UI output:

```ts
import { counterHandlers } from "./generated/index.js";

counterHandlers.increment(() => 1);
```

For deliberately dynamic integrations, the lower-level, stringly-typed escape hatch is
explicitly available:

```ts
const { content } = await vidra.unsafe.invoke<{ content: string }>("filesystem", "readText", {
  path: "/tmp/notes.txt",
});
```

The supported guarantee is **end-to-end typed contracts, with an explicit unsafe
escape hatch**.

## Transport

The SDK auto-detects its transport: it uses the native message channel
(WKWebView / WebView2) inside a Vidra host, and falls back to a browser stub
when run in a plain browser so you can develop the UI without the native shell.

## Links

- Website: [vidra.build](https://vidra.build)
- GitHub: [rzamfiriu/vidra](https://github.com/rzamfiriu/vidra)
- npm: [@vidra-dev/sdk](https://www.npmjs.com/package/@vidra-dev/sdk)

## License

MIT
