# Vidra

Cross-platform application framework: **React UI + .NET MAUI native layer**.

Build desktop and mobile apps with a web-based UI and native C# capabilities, shipped from a single codebase.

## Architecture

```
React / Any JS framework
        │
        │  WebView
        │
   JS SDK  (@vidra-dev/sdk)
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
  cli/create-vidra-app/        # Scaffold CLI, vidra CLI, and starter template
  bridge/Vidra.Bridge/        # C# bridge runtime, dispatcher, message protocol
  host/Vidra.Host.Maui/       # MAUI app shell with WebView host
  modules/
    Vidra.Modules.FileSystem/  # File read/write/list
    Vidra.Modules.Dialogs/     # Alert, confirm, prompt
    Vidra.Modules.Clipboard/   # Copy/paste
    Vidra.Modules.Notifications/ # Local notifications
    Vidra.Modules.AppLifecycle/  # App info, theme
    Vidra.Modules.Windowing/     # Primary window title/size/state
  sdk/vidra-js/               # TypeScript SDK for the JS side
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
# From a scaffolded Vidra app root
npm run dev
```

`vidra dev` starts Vite and launches the native desktop host for the current OS.

To force a desktop target explicitly:

```bash
vidra dev --target macos
vidra dev --target windows
```

### Production Build

```bash
vidra build
vidra build --target macos
vidra build --target windows
```

On macOS, both `vidra dev` and `vidra build --target macos` try to re-sign the generated Mac Catalyst `.app`
with a local signing identity before launch or packaging. By default Vidra prefers the first available
`Apple Development` identity, and you can override that selection with `VIDRA_MACOS_CODESIGN_KEY`.

For actual end-user distribution, you should still use the appropriate Apple distribution signing flow
and notarization.

## JS SDK Usage

```typescript
import { vidra } from '@vidra-dev/sdk';

// Call a native module
const { content } = await vidra.invoke('filesystem', 'readText', { path: '/tmp/notes.txt' });

// Listen for native events
vidra.on('app.resume', () => console.log('App resumed'));

// Discover available modules
const caps = await vidra.capabilities();
```

## Targets

| Platform    | Status     |
|------------|------------|
| Windows    | Supported  |
| macOS      | Supported  |

## License

MIT
