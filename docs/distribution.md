# Distribution

The full signing, notarization, and packaging guide is published at
[vidra.build/docs/guides/distribution](https://vidra.build/docs/guides/distribution/).

```bash
npx vidra build          # build the app and configured update tiers
npx vidra build --plan   # preview the build
npx vidra verify         # verify the newest artifact
```

Vidra produces a macOS `.dmg`, a self-contained Windows `.zip`, or both a signed
Android `.apk` and `.aab`. Android release builds require:

```bash
export VIDRA_ANDROID_KEYSTORE=/path/to/release.jks
export VIDRA_ANDROID_KEY_ALIAS=release
export VIDRA_ANDROID_KEY_PASSWORD=...
export VIDRA_ANDROID_STORE_PASSWORD=...
npx vidra build --target android
```

Publish the AAB through Google Play; use the APK for controlled testing or
sideloading. `ApplicationVersion` is Android's `versionCode`. Set a monotonically
increasing `VIDRA_BUILD_NUMBER` when rebuilding an existing semver for Play.
macOS signing/notarization and Windows signing remain optional.

> The current whole-app update flag is `--app`. Older `--native-update`
> examples no longer apply.
