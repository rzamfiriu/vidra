# Testing UINet

This doc describes how UINet is tested today and the manual checks that
_cannot_ be automated in CI (OS permission prompts, code signing, real
window geometry, notification surfaces, etc.).

CI covers everything that can be run headlessly and deterministically.
Use the manual checklist at the bottom of this page before a release or
whenever touching platform-specific code paths.

## Layered strategy

We follow a pyramid:

1. **Unit** — fast, isolated tests for pure logic.
2. **Contract** — JSON fixtures shared between C# and TypeScript to lock
   down the bridge wire format.
3. **Integration** — scaffold-into-tmpdir, dispatcher round-trips, code
   generation snapshots.
4. **Smoke** — per-OS jobs that build the scaffolded template and ping
   an echo bridge module over stdio.
5. **Manual** — the checklist in this document, run by a human.

## Automated suites

| Layer       | Project / script                                            | Runs in CI            |
| ----------- | ----------------------------------------------------------- | --------------------- |
| Unit        | `tests/dotnet/UINet.Bridge.Tests`                           | `ubuntu-latest`       |
| Unit        | `tests/dotnet/UINet.CodeGen.Tests` (incl. TS snapshots)     | `ubuntu-latest`       |
| Unit        | `tests/dotnet/UINet.Modules.FileSystem.Tests`               | `ubuntu-latest`       |
| Unit        | `tests/dotnet/UINet.Modules.Windowing.Tests`                | `ubuntu-latest`       |
| Unit        | `src/sdk/uinet-js` Vitest (`client`, `transport`)           | `ubuntu-latest`       |
| Unit        | `src/cli/create-uinet-app` Vitest (`utils`, `project`, ...) | `ubuntu-latest`       |
| Contract    | `tests/contract/fixtures/*.json` via `ContractFixtureTests` | `ubuntu-latest`       |
| Contract    | Same fixtures via SDK `contract.test.ts`                    | `ubuntu-latest`       |
| Integration | CLI `scaffold.integration.test.ts` (tmpdir scaffold)        | `ubuntu-latest`       |
| Smoke       | `tests/dotnet/UINet.Bridge.Smoke` + `tests/smoke/echo-ping.mjs` | `windows-latest`, `macos-latest` |
| Smoke       | CLI scaffold + `dotnet build` of scaffolded host            | `windows-latest`, `macos-latest` |

### Running locally

```bash
# C# unit + contract + codegen
dotnet test tests/dotnet/UINet.Bridge.Tests/UINet.Bridge.Tests.csproj
dotnet test tests/dotnet/UINet.CodeGen.Tests/UINet.CodeGen.Tests.csproj
dotnet test tests/dotnet/UINet.Modules.FileSystem.Tests/UINet.Modules.FileSystem.Tests.csproj
dotnet test tests/dotnet/UINet.Modules.Windowing.Tests/UINet.Modules.Windowing.Tests.csproj

# SDK
cd src/sdk/uinet-js && npm install && npm test

# CLI (includes scaffold-into-tmpdir integration)
cd src/cli/create-uinet-app && npm install && npm test

# Bridge echo-ping smoke (any OS)
dotnet build tests/dotnet/UINet.Bridge.Smoke/UINet.Bridge.Smoke.csproj -c Release
UINET_SMOKE_CONFIG=Release node tests/smoke/echo-ping.mjs
```

### Updating code-gen snapshots

The TypeScript emitter is pinned by golden files:

- `tests/dotnet/UINet.CodeGen.Tests/Snapshots/sample.ts`
- `tests/dotnet/UINet.CodeGen.Tests/Snapshots/index.ts`

If you intentionally change emitted TS, regenerate with:

```bash
dotnet test tests/dotnet/UINet.CodeGen.Tests \
  -e UINET_UPDATE_SNAPSHOTS=1
```

Review the diff before committing — snapshot changes are part of the
public API of generated proxies.

### Updating contract fixtures

JSON fixtures in `tests/contract/fixtures/` are the source of truth
for the bridge wire format. Both sides (C# `ContractFixtureTests` and
SDK `contract.test.ts`) pin against them. Changes must:

1. Update the fixture JSON.
2. Run both suites; both must pass.
3. Keep the fixture sorted by scenario name.

## Manual test checklist

Automate what you can; these items stay manual because they interact
with real OS surfaces that CI cannot exercise.

Run them on a development machine for each platform you ship to
(at minimum macOS + Windows) before a release.

### 1. Scaffolding end-user flow

- [ ] `npx create-uinet-app demo` scaffolds without errors in a clean dir.
- [ ] Entered app-id flows into `Info.plist` (macOS) / `Package.appxmanifest` (Windows).
- [ ] `cd demo && npm run dev` brings up Vite + the native host, and the
      webview loads `http://localhost:5173` (or the configured port).
- [ ] Closing the native window terminates the dev process cleanly.
- [ ] `uinet build` produces a distributable artifact
      (`.app` / `.dmg` on macOS, `.msix`/`.exe` on Windows).

### 2. Windowing module

For each platform, run a UI that calls `appWindow` via the SDK and verify:

- [ ] `appWindow.getSupport()` returns a payload whose `platform` matches
      the host OS and whose booleans reflect documented support in
      `docs/window-management.md`.
- [ ] `appWindow.getCurrent()` reports the actual title / size / state.
- [ ] `appWindow.setTitle("Test")` updates the title bar.
- [ ] `appWindow.setSize(900, 600)` resizes the window; verify bounds are
      what was requested (minus any platform chrome math documented in
      window-management).
- [ ] `appWindow.center()` centers on the current display.
- [ ] `appWindow.maximize()` / `restore()` / `minimize()` behave correctly,
      and `appWindow.stateChanged` events fire for each transition.
- [ ] `appWindow.setFullscreen(true)` / `setFullscreen(false)` round-trips,
      with `appWindow.stateChanged` events firing both directions.
- [ ] Invalid dimensions (zero/negative) surface as a `MODULE_ERROR` in the
      promise (not a process crash).

### 3. Notifications module

- [ ] First call to `notifications.show({ title, body })` triggers the
      OS permission prompt (macOS: Notification Center; Windows: toast
      registration).
- [ ] Allowing the prompt causes the toast to render; denying surfaces a
      typed error (`PERMISSION_DENIED` or equivalent).
- [ ] Closing the toast from the system UI does not crash the app.
- [ ] `notifications.requestPermission()` returns the current status
      without duplicating the OS prompt when already granted.
- [ ] The scaffolded template's sample notification handler works
      unchanged on both macOS and Windows.

### 4. Dialogs module

- [ ] `dialogs.message(...)` shows the native alert, and the returned
      promise resolves on dismiss.
- [ ] `dialogs.confirm(...)` returns `true` / `false` for OK / Cancel.
- [ ] `dialogs.openFile(...)` filter respects the `extensions` option.
- [ ] `dialogs.saveFile(...)` honors the `defaultPath` option and returns
      `null` when the user cancels.

### 5. FileSystem module

- [ ] Reading / writing to an app-sandbox directory succeeds.
- [ ] Reading from an arbitrary system path outside the sandbox surfaces
      a typed permission error on macOS (Catalyst sandbox) and on Windows
      (MSIX packaged identity).
- [ ] `exists` / `delete` / `list` behave consistently with the spec in
      `docs/interop-protocol.md`.

### 6. Clipboard module

- [ ] `clipboard.writeText("hello")` then `clipboard.readText()` returns
      `"hello"` in the same session.
- [ ] Clipboard state survives navigating the webview.

### 7. App lifecycle events

- [ ] `app.suspend` fires when the OS backgrounds the app (Windows:
      minimizing to tray if enabled; macOS: ⌘H / switching Spaces).
- [ ] `app.resume` fires on foreground.
- [ ] `app.beforeQuit` fires before the process exits, and a handler that
      returns a promise can delay the quit.

### 8. macOS code signing & notarization

- [ ] `uinet build --target macos` signs the `.app` with the identity
      picked up from `resolveMacCodeSigningIdentity()` (see CLI
      `signing.ts`); if no identity is present, the build still succeeds
      with a clear warning.
- [ ] `codesign --verify --deep --strict <App>.app` passes.
- [ ] `spctl --assess --type execute <App>.app` passes on a machine
      _without_ the signing certificate installed (Gatekeeper check).
- [ ] `xcrun notarytool submit ...` + stapling works for a release build
      (run only before a public release, since it hits Apple servers).

### 9. Windows packaging

- [ ] MSIX build runs without errors for `net10.0-windows10.0.19041.0`.
- [ ] Installing the unsigned MSIX on a dev machine with developer mode
      enabled launches the app, and the webview bridge is reachable.
- [ ] Signed MSIX installs on a clean VM without SmartScreen warnings
      (run only before a public release).

### 10. Regression safety net

- [ ] Full automated suite is green on `main` at the release commit.
- [ ] Scaffolded template in step 1 runs cleanly against the published
      NuGet and npm packages (not the local feed), not just the repo sources.

## Adding new tests

When adding a new bridge module:

1. Add a minimal unit test under `tests/dotnet/UINet.Modules.<Name>.Tests`
   that links the portable source file and asserts:
   - `[BridgeModule]` name and `[BridgeMethod]` list.
   - Argument validation via `BridgeDispatcher` round-trip JSON.
2. If the module changes the wire format, add or update a JSON fixture
   in `tests/contract/fixtures/` and extend both
   `ContractFixtureTests.cs` and SDK `contract.test.ts`.
3. Extend `docs/testing.md` with any manual check that can't be covered
   by automated tests (permission prompts, OS-level dialogs, hardware).
