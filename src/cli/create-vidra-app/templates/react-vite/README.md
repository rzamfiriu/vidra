# {{appTitle}}

A cross-platform application built with [Vidra](https://vidra.build): a React UI and a
C#/.NET native host.

## Requirements

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- .NET MAUI workload: `dotnet workload install maui`
- [Node.js](https://nodejs.org/) 22 or newer
- Xcode for macOS builds
- JDK 17 and the Android SDK for Android builds

Windows targets must be built on Windows. Android targets can be built on
Windows, macOS, or Linux; connect an emulator/device and run
`npm run dev -- --target android`.

## Development

```bash
npm run doctor
npm run dev
```

`npm run dev` starts Vite and the native host together. Changes to the web UI
reload through Vite; supported C# changes reload through the .NET development
loop.

For Android, `vidra dev` selects the connected device (or `ANDROID_SERIAL`),
installs the app, and reads readiness from logcat. It prefers `adb reverse`,
then falls back to `10.0.2.2` on an emulator or the development machine's LAN
address on a physical device. Set `VIDRA_ANDROID_HOST` when automatic interface
selection picks a VPN or container network. The page respects system safe areas; hardware
Back navigates WebView history before exiting.

## Build

```bash
npm run build
```

The `vidra` CLI is a local project dependency. Run `npx vidra --help` to see
target, packaging, and update options.

## Project structure

```text
{{projectNameKebab}}/
├── src/
│   └── {{projectName}}.Host/  # .NET MAUI host and C# contracts
└── ui/                        # React application and generated TypeScript
```

Read the [Vidra documentation](https://vidra.build/docs/) for bridge guides,
capabilities, distribution, and updates.
