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

Scaffolded apps get the `vidra` CLI as a local dev dependency — there's no
global `vidra` to install. Run it from inside your project via the npm scripts
or `npx`:

```bash
npm run dev                     # start Vite + native host
npm run build                   # build + package for distribution
npm run doctor                  # check your .NET / MAUI / Xcode setup
npx vidra dev --target windows  # run a specific desktop target
npx vidra build --target macos  # build + package a macOS .dmg
```

## Prerequisites

- .NET 10 SDK
- The .NET MAUI workload: `dotnet workload install maui`
- Node.js 18+
- macOS targets require Xcode; Windows targets must be built on Windows

If the MAUI workload is missing, `create-vidra-app` will detect it after
scaffolding and offer to install it for you. You can re-check at any time with
`npm run doctor`. 

## License

MIT
