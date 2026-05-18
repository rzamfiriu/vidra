# {{appTitle}}

A cross-platform application built with [UINet](https://github.com/user/uinet) — React UI + .NET MAUI native host.

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download) with MAUI workload
- [Node.js](https://nodejs.org/) 18+
- Windows development must be run from a Windows machine with the MAUI Windows workload installed

### Development

```bash
npm run dev
```

This starts the Vite dev server and launches the native host for the current OS.

To target a specific desktop platform explicitly:

```bash
uinet dev --target macos
uinet dev --target windows
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
│       ├── MauiProgram.cs         # App configuration + UINet setup
│       ├── MainPage.cs            # Main page (extends UINetPage)
│       └── Platforms/             # Platform-specific code
└── ui/                            # React frontend
    ├── src/
    │   ├── App.tsx                # Main React component
    │   └── main.tsx               # Entry point
    ├── vite.config.ts
    └── package.json
```
