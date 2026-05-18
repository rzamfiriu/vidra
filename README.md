# UINet

Cross-platform application framework: **React UI + .NET MAUI native layer**.

Build desktop and mobile apps with a web-based UI and native C# capabilities, shipped from a single codebase.

## Architecture

```
React / Any JS framework
        │
        │  WebView
        │
   JS SDK  (@uinet/sdk)
        │
  Interop bridge (JS ↔ C#)
        │
     .NET MAUI
        │
  Native APIs / filesystem / OS
```

The UI stack is pure web. Native capability lives in .NET.

## Repository Layout

```
src/
  cli/create-uinet-app/        # Scaffold CLI, uinet CLI, and starter template
  bridge/UINet.Bridge/        # C# bridge runtime, dispatcher, message protocol
  host/UINet.Host.Maui/       # MAUI app shell with WebView host
  modules/
    UINet.Modules.FileSystem/  # File read/write/list
    UINet.Modules.Dialogs/     # Alert, confirm, prompt
    UINet.Modules.Clipboard/   # Copy/paste
    UINet.Modules.Notifications/ # Local notifications
    UINet.Modules.AppLifecycle/  # App info, theme
    UINet.Modules.Windowing/     # Primary window title/size/state
  sdk/uinet-js/               # TypeScript SDK for the JS side
samples/
  workspace-manager/           # Sample app (planned)
docs/                          # Architecture, protocol, capabilities
tools/                         # CLI and build helpers (planned)
```

## Quick Start

### Prerequisites

- .NET 10 SDK with MAUI workload
- Node.js 20+
- Windows development must be run from Windows with the MAUI Windows workload installed

### Development

```bash
# From a scaffolded UINet app root
npm run dev
```

`uinet dev` starts Vite and launches the native desktop host for the current OS.

To force a desktop target explicitly:

```bash
uinet dev --target macos
uinet dev --target windows
```

### Production Build

```bash
uinet build
uinet build --target macos
uinet build --target windows
```

On macOS, both `uinet dev` and `uinet build --target macos` try to re-sign the generated Mac Catalyst `.app`
with a local signing identity before launch or packaging. By default UINet prefers the first available
`Apple Development` identity, and you can override that selection with `UINET_MACOS_CODESIGN_KEY`.

For actual end-user distribution, you should still use the appropriate Apple distribution signing flow
and notarization.

## JS SDK Usage

```typescript
import { uinet } from '@uinet/sdk';

// Call a native module
const { content } = await uinet.invoke('filesystem', 'readText', { path: '/tmp/notes.txt' });

// Listen for native events
uinet.on('app.resume', () => console.log('App resumed'));

// Discover available modules
const caps = await uinet.capabilities();
```

## Targets

| Platform    | Status     |
|------------|------------|
| Windows    | Supported  |
| macOS      | Supported  |

## License

MIT
