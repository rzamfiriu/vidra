# create-vidra-app

Scaffold a new [Vidra](https://github.com/rzamfiriu/vidra) application — a
**React UI + .NET MAUI native host**, shipped from a single codebase.

> **Alpha.** APIs and templates may change between 0.x releases.

## Usage

```bash
npm create vidra-app@latest
# or
npx create-vidra-app my-app
```

You'll be prompted for a project name and an app ID (reverse-domain). Then:

```bash
cd my-app
npm run dev   # starts Vite + the native host together
```

This package also installs the `vidra` CLI used by scaffolded apps:

```bash
vidra dev                   # start Vite + native host
vidra dev --target windows  # run the Windows host
vidra build --target macos  # build + package a macOS .dmg
```

## Prerequisites

- .NET 10 SDK with the MAUI workload
- Node.js 18+
- Windows targets must be built on Windows; macOS targets on macOS

## License

MIT
