# Vidra.Modules.Notifications

Local notifications for [Vidra](https://vidra.build) applications on Windows,
macOS, and Android.

The generated TypeScript proxy exposes:

- `notifications.requestPermission()`
- `notifications.show({ title, body? })`

Request permission before showing a notification. On macOS, permission and
delivery require a correctly signed application. Android 13 and newer prompts
for `POST_NOTIFICATIONS`; Android 8 and newer uses the `vidra.general` channel.
Scaffolded apps include the monochrome `vidra_notification` status-bar icon;
keep that drawable when replacing the launcher icon.

See the [native capabilities reference](https://vidra.build/docs/reference/capabilities/native/)
and [distribution guide](https://vidra.build/docs/guides/distribution/).

[NuGet](https://www.nuget.org/packages/Vidra.Modules.Notifications) ·
[GitHub](https://github.com/rzamfiriu/vidra)
