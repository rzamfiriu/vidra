# Distribution

The full signing, notarization, and packaging guide is published at
[vidra.build/docs/guides/distribution](https://vidra.build/docs/guides/distribution/).

```bash
npx vidra build          # build the app and configured update tiers
npx vidra build --plan   # preview the build
npx vidra verify         # verify the newest artifact
```

Vidra produces a macOS `.dmg`, a self-contained Windows `.zip`, both a signed
Android `.apk` and `.aab`, or a signed iOS `.ipa`. Android release builds require:

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

## iOS

`vidra build --target ios` produces an App Store `.ipa`. It needs a Mac with
Xcode and an iOS Simulator runtime (`xcodebuild -downloadPlatform iOS`; Xcode's
asset compiler needs one even for device builds), plus an Apple Distribution
identity in the keychain and an installed App Store provisioning profile for
the app's `ApplicationId`:

```bash
export VIDRA_IOS_CODESIGN_KEY="Apple Distribution: Example Ltd (TEAMID)"
export VIDRA_IOS_PROVISIONING_PROFILE="Example App Store"   # name or UUID
npx vidra build --target ios
```

The build checks the app's signature and refuses an IPA whose embedded profile
is not an unexpired App Store profile, since App Store Connect would refuse it
after the upload. `--upload` sends it on with an App Store Connect API key
(Users and Access → Integrations), after which it appears in TestFlight:

```bash
export VIDRA_ASC_KEY_ID=...
export VIDRA_ASC_ISSUER_ID=...
export VIDRA_ASC_KEY_PATH=/path/to/AuthKey_XXXXXXXXXX.p8
npx vidra build --target ios --upload
```

`ApplicationVersion` is the IPA's `CFBundleVersion`. App Store Connect refuses
a build number it has already seen for a version, so as on Android the build
refuses one lower than any already packaged; set `VIDRA_BUILD_NUMBER` when
rebuilding an existing semver.

`--simulator` builds an unsigned `.app` for the Simulator instead, for CI or for
trying a Release build without an Apple account. It cannot be uploaded.

The template ships `Platforms/iOS/PrivacyInfo.xcprivacy`, declaring the
required-reason APIs .NET and MAUI themselves use (file timestamps, system boot
time, disk space, user defaults). Add any your own code or other packages use.
It does not set `ITSAppUsesNonExemptEncryption`: App Store Connect asks about
encryption on every build until it is set, and the answer is a legal declaration
about your app, so add the key to `Info.plist` yourself once you know it.

For development, `vidra dev --target ios` runs in the Simulator and needs no
Apple account. `--device` installs on a connected iPhone or iPad (iOS 17+, with
Developer Mode on) and needs a development profile that covers the bundle ID.
`vidra doctor --target ios` checks all of the above.

> The current whole-app update flag is `--app`. Older `--native-update`
> examples no longer apply.
