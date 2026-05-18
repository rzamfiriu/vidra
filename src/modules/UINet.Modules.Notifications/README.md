# UINet Notifications Module

`UINet.Modules.Notifications` provides local notification support for UINet apps.

## Supported platforms

- Windows
- macOS via Mac Catalyst

## Bridge API

### `notifications.requestPermission()`

Requests notification permission from the operating system.

Returns:

```json
{ "granted": true }
```

### `notifications.show({ title, body? })`

Schedules or displays a local notification.

Arguments:

```json
{
  "title": "My App",
  "body": "Hello from UINet"
}
```

Returns:

```json
{ "scheduled": true }
```

## Mac Catalyst note

On Mac Catalyst, notification permission and delivery depend on the app being properly signed.

For local development, the developer machine needs a one-time Xcode setup:

1. Xcode installed
2. Apple account added in Xcode
3. Apple Development certificate/identity available

When launching through `uinet dev` or packaging through `uinet build --target macos`, UINet will try to
re-sign the generated Mac Catalyst app bundle with a local signing identity before launch or packaging.
By default it prefers the first available `Apple Development` identity, and you can override that
selection with `UINET_MACOS_CODESIGN_KEY`. If no usable identity is available, the app may fall back to
ad-hoc signing and notifications may not appear.

Without a valid Apple development signing identity, local notification permission prompts and banner delivery may fail even if the bridge call itself succeeds.

## Expected behavior

- In a properly signed local development build, macOS should show the standard notification permission prompt the first time permission is requested.
- In a shipped app, end users should not need to do any Xcode or certificate setup.

## Troubleshooting

- If `requestPermission()` returns `false`, check macOS notification settings for the app.
- If `show()` returns `scheduled: true` but no banner appears on Mac Catalyst, verify the app was built with a valid Apple Development signing identity.
- If needed, confirm the machine has a usable signing identity with:

```bash
security find-identity -v -p codesigning
```
