# Updates

The full updates guide is published at
[vidra.build/docs/guides/updates](https://vidra.build/docs/guides/updates/).

The current CLI uses one feed setting for web and whole-app updates:

```ts
// vidra.config.ts
import { defineConfig } from "@vidra-dev/sdk/config";

export default defineConfig({
  updates: {
    feed: "https://updates.example.com/my-app/",
  },
});
```

```bash
npx vidra updates init --feed https://updates.example.com/my-app/
npx vidra build         # app and every configured update tier
npx vidra build --web   # web bundle only
npx vidra build --app   # installable app only
```

Run `npx vidra updates` to inspect the configuration and
`npx vidra build --help` for all release options.

On Android, configure `feed.web` only. Vidra's signed WebView bundle OTA remains
available, while Google Play owns APK/AAB updates; Velopack is not included in
the Android app. Google Play's
[Device and Network Abuse policy](https://support.google.com/googleplay/android-developer/answer/9888379)
exempts code running in an interpreter such as a WebView from its downloaded
executable-code restriction, subject to the rest of the Play policies.

> Older `vidra bundle` and `--native-update` examples have been replaced by
> `vidra build --web` and `vidra build --app`.
