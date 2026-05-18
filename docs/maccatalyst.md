# Why UINet Targets Mac Catalyst

## The User-Facing Advantage

UINet uses `Mac Catalyst` on Apple desktop so the framework can keep a unified `.NET MAUI` host across `Windows` and macOS. For UINet users, the benefit is not "Catalyst for its own sake." The benefit is that UINet can deliver native capabilities faster, with less platform drift and a more consistent API surface across desktop targets.

In practical terms, this means UINet can spend more of its time building the bridge, native modules, CLI workflows, packaging, and templates instead of splitting effort across multiple unrelated desktop host stacks.

## What This Means For App Developers

Mac Catalyst helps UINet provide:

- Faster cross-platform feature delivery
- More consistent native module behavior across desktop targets
- Less host-specific fragmentation in the framework
- A smaller and easier-to-maintain platform surface
- Better reuse of fixes and improvements across `Windows` and Apple desktop

The goal is simple: one framework model, one bridge model, and one mental model for desktop app development.

## Why This Helps UINet Move Faster

Without Mac Catalyst, UINet would need to maintain:

- one native host architecture for Windows
- another separate native host architecture for macOS
- different integration paths for startup, dependency injection, bridge registration, packaging, and native capabilities

By staying inside the shared `.NET MAUI` host model, UINet can keep more of its effort focused on framework features that users actually touch:

- built-in native modules such as dialogs, clipboard, filesystem, notifications, and app lifecycle
- a more consistent JS-to-native and native-to-JS bridge
- template quality
- CLI workflows
- packaging and release tooling

For a young framework, this is a major advantage. It reduces platform-specific maintenance work and increases the amount of effort available for product-level improvements.

## macOS vs Mac Catalyst

Tauri targets native `macOS` directly. UINet targets `Mac Catalyst`, which also runs on the Mac but follows Apple's UIKit-style application model instead of the classic macOS `AppKit` model.

### Native macOS

- Built directly for macOS
- Uses macOS-native desktop frameworks such as `AppKit`
- Matches traditional Mac app behavior more closely

### Mac Catalyst

- Runs on macOS, but through Apple's iPad-to-Mac application model
- Uses the Apple app stack that `.NET MAUI` supports on desktop
- Makes it easier for UINet to keep a shared host strategy across supported desktop targets

## Why UINet Chose This Trade-Off

UINet is optimized for cross-platform framework velocity, not for maximum native macOS specialization.

That trade-off brings real advantages:

- A single MAUI-based host architecture across desktop targets
- Shared app startup, dependency injection, bridge registration, and module wiring
- Fewer platform-specific host implementations to maintain
- More consistency when new framework capabilities are added
- Faster iteration for a small, early-stage framework

## Trade-Offs

Mac Catalyst is not identical to native macOS, and that does come with downsides:

- Some Apple desktop behaviors are less straightforward than in an AppKit-based app
- Local macOS development can involve more signing setup than developers expect
- Some platform quirks, such as notification permission and delivery, can appear during development rather than only at release time

For UINet today, that trade-off is acceptable because the framework gains more value from a unified desktop host architecture than it would from maintaining a separate native macOS implementation.

## Short Version

UINet uses Mac Catalyst because it lets the framework ship Windows and macOS support with one consistent host strategy, one bridge model, and less platform-specific drift. The user benefit is faster framework progress and a more consistent cross-platform development experience.
