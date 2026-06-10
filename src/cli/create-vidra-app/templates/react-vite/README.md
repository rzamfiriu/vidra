# {{appTitle}}

A cross-platform application built with [Vidra](https://github.com/user/vidra) — React UI + .NET MAUI native host.

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- The .NET MAUI workload: `dotnet workload install maui`
- [Node.js](https://nodejs.org/) 18+
- macOS targets require Xcode; Windows targets must be built on Windows

Not sure if you're set up? Run:

```bash
vidra doctor
```

It checks your .NET SDK, the MAUI workload, and (on macOS) Xcode, and prints the
exact command to fix anything that's missing.

### Development

```bash
npm run dev
```

This starts the Vite dev server and launches the native host for the current OS.

To target a specific desktop platform explicitly:

```bash
vidra dev --target macos
vidra dev --target windows
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
