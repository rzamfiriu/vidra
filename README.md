<div align="center">

[<img src=".github/assets/vidra-logo-green.png" alt="Vidra" width="320">](https://vidra.build)

**Build cross-platform apps with any web UI and a C#/.NET native layer.**

[Documentation](https://vidra.build/docs/) · [Getting started](https://vidra.build/docs/getting-started/) · [Bridge guide](https://vidra.build/docs/bridge/javascript-to-csharp/)

[![create-vidra-app on npm](https://img.shields.io/npm/v/create-vidra-app?label=create-vidra-app&color=cb3837&logo=npm)](https://www.npmjs.com/package/create-vidra-app)
[![vidra-cli on npm](https://img.shields.io/npm/v/vidra-cli?label=vidra-cli&color=cb3837&logo=npm)](https://www.npmjs.com/package/vidra-cli)
[![@vidra-dev/sdk on npm](https://img.shields.io/npm/v/%40vidra-dev%2Fsdk?label=%40vidra-dev%2Fsdk&color=cb3837&logo=npm)](https://www.npmjs.com/package/@vidra-dev/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> **Alpha:** APIs and templates may change between 0.x releases.

Vidra runs React, Vue, Svelte, Solid, or plain HTML in the operating system's
WebView. Your native code stays in C#, and generated TypeScript and C# contracts
keep both sides in sync.

## Why Vidra

- **Use the web framework you already know.** No XAML or Razor lock-in.
- **Keep native code in .NET.** Reuse C# libraries, domain logic, and team skills.
- **Share typed contracts.** C# declarations generate the APIs used on both sides.
- **Ship a lightweight host.** Vidra uses the system WebView on Windows, macOS, and Android.

## Quick start

Install [.NET 10](https://dotnet.microsoft.com/download), the .NET MAUI workload,
and [Node.js](https://nodejs.org/) 22 or newer:

```bash
dotnet workload install maui
npm create vidra-app@latest
cd my-app
npm run dev
```

The scaffold includes a web app, a .NET MAUI host, and the local `vidra` CLI.

## Documentation

- [Getting started](https://vidra.build/docs/getting-started/)
- [Bridge guides](https://vidra.build/docs/bridge/javascript-to-csharp/)
- [Capabilities](https://vidra.build/docs/reference/capabilities/)
- [Architecture](https://vidra.build/docs/concepts/architecture/)
- [Distribution](docs/distribution.md)
- [Updates](docs/updates.md)

Repository-specific contributor notes live in [`docs/`](docs/).

## Platform support

Windows, macOS, and Android are supported. Windows targets must be built on
Windows; macOS targets require Xcode and must be built on macOS. Android targets
can be built on Windows, macOS, or Linux with JDK 17 and the Android SDK.

Vidra's MAUI projects include Android TFMs on macOS and Windows too. A
target-specific `vidra build --target macos|windows` only needs that desktop
workload, but a full `dotnet build`, `dotnet pack`, or `./pack-local.sh` builds
every listed TFM and therefore also needs the Android workload, JDK 17, and the
Android SDK.

## Contributing

Contributions are welcome. For non-trivial changes, start with an
[issue](https://github.com/rzamfiriu/vidra/issues), then see the
[testing guide](docs/testing.md) before opening a pull request.

## License

[MIT](LICENSE)
