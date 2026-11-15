# Mobile builds and store releases

Mycellios Agent for iPhone is the Expo app in `apps/mobile`. It is the native
client inherited from Rakazo: inbox, threads, voice, attachments, and a
self-hosted server chosen on the sign-in screen. The public product still tells
iPhone users to add the web app to the Home Screen. That guide stays until a
person uploads this binary to TestFlight. This repository cannot produce an IPA
on its own: the build needs Apple signing, and a local Xcode archive needs a Mac.
EAS can compile the store build on its macOS builders.

The App Store bundle id is `com.mycellios.agent`. The URL scheme stays `rakazo`
because sign-in, passkeys, and in-app links already use `rakazo://`. A phone can
keep the upstream Rakazo app installed beside this one. Over-the-air updates
stay off until this app is linked to an Expo project owned by Mycellios.

Store application IDs, team IDs, signing keys, and tokens stay out of Git.

## TestFlight

A person with the Apple and Expo accounts does this once:

1. Join the Apple Developer Program with the account that will own the app.
2. In App Store Connect, create an iOS app named Mycellios Agent with bundle ID
   `com.mycellios.agent`. On App Information, copy the Apple ID number. That
   number is `ASC_APP_ID`. Do not commit it.
3. In App Store Connect, open Users and Access, then Integrations, then App
   Store Connect API. Create a key with the App Manager role. Download the
   `.p8` file once. The key id is `ASC_KEY_ID`, the issuer id is
   `ASC_ISSUER_ID`, and the file contents are `ASC_PRIVATE_KEY`.
4. Create an Expo account for Mycellios. Create an access token and store it as
   the `EXPO_TOKEN` repository secret, together with the four Apple secrets.
5. From `src/agent/apps/mobile`, sign in and link a new Expo project. Commit the
   public `extra.eas.projectId` that `eas project:init` writes. Do not point
   this app at another product's Expo project.

   ```sh
   npx eas-cli@27.10.0 login
   npx eas-cli@27.10.0 project:init
   ```

6. Set the HTTPS origin of the Agent server in the EAS production environment:

   ```sh
   npx eas-cli@27.10.0 env:create --environment production --name EXPO_PUBLIC_API_URL --value https://app.example.com --visibility plaintext
   ```

7. Create the iOS distribution certificate and provisioning profile. EAS can
   create them with the Apple account, or you can upload certificates you
   already have. This step is interactive and needs the Apple account:

   ```sh
   npx eas-cli@27.10.0 credentials --platform ios
   ```

8. Dispatch the `iOS TestFlight` workflow from `main`, or build and upload
   locally. EAS compiles on its macOS builders, so this command does not need a
   Mac. A local Xcode archive does.

   ```sh
   npx eas-cli@27.10.0 build --platform ios --profile testflight --auto-submit
   ```

9. When Apple finishes processing the build, open TestFlight in App Store
   Connect. People on the App Store Connect team can install it with the
   TestFlight app. Anyone else needs a test group, beta information, and
   Apple's Beta App Review. The workflow only uploads the build. It does not
   submit the app for public App Store review.

`apps/mobile/eas.json` profile `testflight` is a store distribution build.
`submit.testflight.ios` is empty on purpose. The workflow fills the App Store
Connect app id and API key on the runner, then restores the file.

## Inherited release notes

Self-hosters normally do not need to publish their own mobile app: the client
can select a compatible server from the sign-in screen. Run the commands below
with npm from `src/agent`. Replace any upstream Expo project, application ids,
and download URLs with the Mycellios account before using them.

Rakazo's public repository does not contain production App Store Connect,
Google Play, Apple team, or private EAS submission identifiers. Those values
belong in the release operator's private configuration.

## Configure a build

1. Link `apps/mobile` to an Expo project owned by your account.
2. Choose unique iOS and Android application identifiers.
3. Configure `EXPO_PUBLIC_API_URL` in the EAS build environment. Production
   builds require a valid HTTPS URL.
4. Keep store application IDs, team IDs, signing credentials, API keys, and
   review-account credentials out of Git.
5. Before a native iOS or Android build, run
   `npm exec --workspace @rakazo/mobile -- expo install --check` from `src/agent`.
   Attachment pickers and other Expo native modules must match the SDK (SDK 57
   needs `expo-image-picker@~57.0.11`, not 17.x). Use
   `npm exec --workspace @rakazo/mobile -- expo install --fix` from `src/agent`
   if that check fails.

From `apps/mobile`:

```sh
eas project:init
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://app.example.com --visibility plaintext
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

EAS can prompt for store identity interactively. For automated submission, add
the required identifiers through a private CI configuration or a short-lived
local change that is never committed.

Before submission, verify the production API, account deletion, sign-in,
notifications, store privacy answers, age rating, screenshots, support page,
and review account on a physical device.

## Android APK

Until Rakazo is on Google Play, Android users can install an APK. Run the
`release-android-apk` workflow from `main` in GitHub Actions when native code
changes. It builds the `android-apk` EAS profile, signed with the project's
managed keystore, and replaces the rolling `android` GitHub release, so the
download link stays the same:

```text
https://github.com/elie222/rakazo/releases/download/android/rakazo.apk
```

The APK uses the production update channel, so JavaScript changes reach it
through the over-the-air updates below without a new APK. A Google Play install
is signed with Play's key, so switching from the APK to Play means uninstalling
the APK first.

## Android push

For Android push notifications, create a Firebase project and register the app's
Android package. Download `google-services.json` and, from `apps/mobile`, store
it as an EAS file environment variable:

```sh
eas env:set production --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret
```

Keep the file and credentials out of Git. Upload an FCM V1 service account key
with `eas credentials` under Android > Google Service Account > FCM V1. Then
rebuild the APK: Firebase configuration is native, so an OTA update cannot add
it to an existing binary. Builds without the variable remain supported.

## Over-the-air updates

Production and preview builds include `expo-updates` and use the corresponding
EAS Update channel. The runtime version follows the public app version, so bump
`expo.version` whenever native code, config plugins, permissions, or native
dependencies change, then create and submit new store builds.

After the full GitHub Actions test suite passes on `main`, CI publishes a
production OTA update when the revision only changes the mobile JavaScript,
TypeScript, or bundled CSS. CI deliberately skips OTA publishing when native
configuration, modules, dependencies, assets, or the update workflow changed.
The repository needs an `EXPO_TOKEN` Actions secret with access to the linked
Expo project.

To publish a compatible update manually from `apps/mobile`:

```sh
eas update --platform all --channel production --environment production --message "Short description"
```

Installed release builds download a compatible update in the background on
launch and apply it after the next restart. Builds created before
`expo-updates` was configured cannot receive OTA updates and must be replaced
with a new iOS and Android build once.
