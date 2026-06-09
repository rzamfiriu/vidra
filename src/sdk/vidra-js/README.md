# @vidra-dev/sdk

Framework-agnostic TypeScript SDK for the [Vidra](https://github.com/rzamfiriu/vidra)
bridge between a web UI and a native .NET MAUI host.

> **Alpha.** APIs may change between 0.x releases.

## Install

```bash
npm install @vidra-dev/sdk
```

Most apps are scaffolded with [`create-vidra-app`](https://www.npmjs.com/package/create-vidra-app),
which wires this up for you.

## Usage

```ts
import { vidra } from "@vidra-dev/sdk";

// Call a native module
const { content } = await vidra.invoke("filesystem", "readText", {
  path: "/tmp/notes.txt",
});

// Listen for native events
vidra.on("app.resume", () => console.log("App resumed"));

// Discover what the host supports at runtime
const caps = await vidra.capabilities();
```

The SDK auto-detects its transport: it uses the native message channel
(WKWebView / WebView2) inside a Vidra host, and falls back to a browser stub
when run in a plain browser so you can develop the UI without the native shell.

## License

MIT
