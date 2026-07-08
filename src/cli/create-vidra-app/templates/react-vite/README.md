# {{appTitle}}

A cross-platform application built with [Vidra](https://vidra.build) — React UI + .NET MAUI native host.

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- The .NET MAUI workload: `dotnet workload install maui`
- [Node.js](https://nodejs.org/) 18+
- macOS targets require Xcode; Windows targets must be built on Windows

Not sure if you're set up? Run:

```bash
npm run doctor
```

It checks your .NET SDK, the MAUI workload, and (on macOS) Xcode, and prints the
exact command to fix anything that's missing.

> The `vidra` CLI ships as a local dev dependency of this project, so run it
> through npm (`npm run dev`, `npm run doctor`) or with `npx vidra <command>` —
> there is no global `vidra` command to install.

### Development

```bash
npm run dev
```

This starts the Vite dev server and launches the native host for the current OS
under `dotnet watch`. Both sides of the app hot reload:

- **UI**: edit anything in `ui/src` — Vite HMR updates the WebView instantly.
- **C#**: edit the host (for example `OnTickAsync` in `MainPage.cs`) — supported
  edits apply to the running app in seconds, and the UI flashes a
  "C# reloaded" badge. Edits hot reload can't express (new fields, changed
  signatures, …) trigger an automatic rebuild and relaunch.

C# hot reload needs a recent toolchain (on macOS, the .NET 10.0.203+ workload
set — run `npm run doctor` to check). When unavailable, `vidra dev` falls back
to a one-shot build and launch. To skip `dotnet watch` explicitly:

```bash
npx vidra dev --no-hot-reload
```

To target a specific desktop platform explicitly:

```bash
npx vidra dev --target macos
npx vidra dev --target windows
```

If you want to run the pieces separately:

```bash
npm run dev:ui
npm run dev:host:macos
npm run dev:host:windows
```

### Production Build

```bash
npm run build
```

## Project Structure

```
{{projectNameKebab}}/
├── src/
│   └── {{projectName}}.Host/     # .NET MAUI native host
│       ├── MauiProgram.cs         # App configuration + Vidra setup
│       ├── MainPage.cs            # Main page (extends VidraPage)
│       └── Platforms/             # Platform-specific code
└── ui/                            # React frontend
    ├── src/
    │   ├── App.tsx                # Main React component
    │   └── main.tsx               # Entry point
    ├── vite.config.ts
    └── package.json
```

---

Built with [Vidra](https://vidra.build) — a C#/.NET native core with a web UI.
