# Vidra.Modules.Windowing

Primary-window management for [Vidra](https://vidra.build) applications on
Windows, macOS, and Android.

The generated `appWindow` proxy supports window information, title and size
changes, platform-dependent state actions, and resize/state events. Check
`appWindow.getSupport()` before showing controls whose availability differs by
platform.

On Android the contract remains registered so bridge fingerprints stay
cross-platform, but only `getCurrent` is supported. Desktop window controls
report `false` from `getSupport()` and throw when called.

See the [native capabilities reference](https://vidra.build/docs/reference/capabilities/native/)
for the complete API and platform notes.

[NuGet](https://www.nuget.org/packages/Vidra.Modules.Windowing) ·
[GitHub](https://github.com/rzamfiriu/vidra)
