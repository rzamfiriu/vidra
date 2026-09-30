# vidra-cli

The `vidra` command for [Vidra](https://vidra.build) apps: run the dev loop,
build and sign installers, publish updates, and check your setup.

> **Alpha:** APIs and commands may change between 0.x releases.

## Install

Apps created with [`create-vidra-app`](https://www.npmjs.com/package/create-vidra-app)
already depend on it. To add it to an existing Vidra app:

```bash
npm install -D vidra-cli
```

## Commands

```bash
npx vidra dev       # start vite + the native host (UI and C# reload on save)
npx vidra build     # build the app, and publish whatever vidra.config.ts configures
npx vidra updates   # turn updates on by giving them a feed URL
npx vidra keygen    # create the key that signs your update feed
npx vidra verify    # check a built artifact is actually shippable
npx vidra doctor    # check your environment, and this project's update wiring
npx vidra --help
```

The scaffolded app wires these to `npm run dev`, `npm run build` and
`npm run doctor`.

## Requirements

- .NET 10 SDK
- .NET MAUI workload: `dotnet workload install maui`
- Node.js 22 or newer
- Xcode for macOS builds
- JDK 17 and the Android SDK for Android builds

Windows targets must be built on Windows. Android targets can be built on
Windows, macOS, or Linux.

`vidra dev --target android` prefers `adb reverse`; when unavailable it uses
`10.0.2.2` for emulators or a LAN address for physical devices. Override
automatic LAN selection with `VIDRA_ANDROID_HOST`.

## License

MIT
