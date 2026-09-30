# Android (APK)

This document describes how MagicRita is packaged for Android. The Android work
happens on the `apk-android-magicrita` branch, which tracks `main`: the SPA is
the same code, and changes are also pushed to `main`.

## Model

The Android app is the **same SPA** as the web, compiled with
`vite build --mode android` and wrapped with **Capacitor**. Two differences from
the web build:

1. **The relay is external.** It does not live inside the APK; it runs on a
   server (`https://magicrita.com`) and is configured in `.env.android`. This
   keeps the "zero server storage" rule intact: the relay only signals, and all
   user data stays on the device (WebView `localStorage`/IndexedDB).
2. **The admin panel is not included.** The admin is web-only.

Capacitor is used instead of a Trusted Web Activity because the app must be
**bundled** (same code the web serves) and work local-first; a TWA would only
load the remote site.

## Phase 1 — build scaffolding

- **`npm run build:android`** (`package.json`) runs
  `tsc -b && vite build --mode android --outDir dist-android`.
- **`.env.android`** (committed, public URLs only) sets:
  ```
  VITE_APP_TARGET=android
  VITE_SIGNAL_URL=wss://magicrita.com/signal/
  VITE_API_BASE=https://magicrita.com
  # VITE_STUN_URL=stun:tu-servidor:3478
  ```
  `.gitignore` ignores `.env.*` but keeps `!.env.android`.
- **`src/lib/protocol/apiBase.ts`** exposes `apiUrl(path)`. On web `API_BASE` is
  empty, so behavior is unchanged (same origin). On Android it prefixes
  `VITE_API_BASE`, because inside the WebView relative paths would resolve to the
  app origin, never to the relay. Callers: `brand.ts` (`/brand`, `/brand/logo`),
  `betaInvite.ts` (`/beta`, `/beta/check`), `adminBlocks.ts`
  (`/moderation/check`), and the web-only admin helpers.
- **Admin removed from the Android bundle.** `App.tsx` reads
  `import.meta.env.VITE_APP_TARGET`. When it is `android`, the catch-all route
  goes straight to `/`, and `UnknownRoute` (the only place that loads the panel)
  is dead code; `AdminPage` is loaded with `import()`, so it becomes an orphan
  chunk. `dist-android/` is built with **no `AdminPage`/`adminPath` chunk**.
  (Admin translation strings still ship inside the shared `messages.ts`
  dictionary; they are inert.)
- **CSP.** `vite.config.ts` (`cspPlugin`) adds each relay origin to `connect-src`
  as both `wss://` and `https://`, and to `img-src`/`media-src` (the logo). The
  Android `index.html` ends up with
  `connect-src 'self' wss://magicrita.com https://magicrita.com`. The web build
  keeps `connect-src 'self'` (or the signaling host when `VITE_SIGNAL_URL` is
  set), exactly as before.

No relay change is needed: the public routes already send
`Access-Control-Allow-Origin: *` (`server/signal.mjs`), and the APK never calls
`/admin-api/*` or `/admin-path`.

## Phase 2 — Capacitor and native pieces

- **Capacitor project** in `android/` (`npm run cap:sync` copies
  `dist-android/` into `android/app/src/main/assets/public` and registers the
  plugins; that web assets folder is git-ignored).
- **`capacitor.config.ts`**: `appId com.magicrita.app`, `appName MagicRita`,
  `webDir dist-android`, `server.androidScheme "https"` (secure context, needed
  for storage, clipboard, and camera/mic), `android.allowMixedContent false`.
- **`src/lib/protocol/native.ts`** centralizes the browser/APK differences:
  - `isNativeApp()` — `Capacitor.isNativePlatform()`.
  - `copyText(text)` — native `@capacitor/clipboard`, browser
    `navigator.clipboard`. Used by the `rsec` copy buttons
    (`SettingsPage`, `CreateAccountPage`).
  - `saveTextFile(name, data, mime)` — native: write to the app cache and open
    the share sheet (`@capacitor/filesystem` + `@capacitor/share`); web: the
    usual `<a download>`. Used by `downloadBundle` (export public/backup). The
    import side keeps `<input type=file>`, which the WebView supports.
  - `wireAndroidBackButton()` — `@capacitor/app`; the hardware back button
    navigates history or exits the app. Wired once in `App.tsx`.
- **Permissions** (`android/app/src/main/AndroidManifest.xml`): `INTERNET`
  (already), plus `CAMERA`, `RECORD_AUDIO`, and `MODIFY_AUDIO_SETTINGS` for
  profile photos, voice/video notes, and P2P calls, and `POST_NOTIFICATIONS` for
  local notifications (a runtime permission on Android 13+). Capacitor's WebView
  and the plugins prompt for them at first use. The manifest also removes three
  permissions the notifications plugin pulls in for **scheduled/exact alarms**
  (`RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `SCHEDULE_EXACT_ALARM`) with
  `tools:node="remove"`: the app only shows immediate notifications, which never
  touch `AlarmManager`, so those permissions are unnecessary and are stripped to
  keep the surface minimal.
- **Native notifications** (`src/lib/protocol/native.ts`): the browser
  `Notification` API does not exist in the WebView, so `pingDesktop`
  (`notices.ts`) delegates to `notifyNative`, which asks for the permission
  (once, when the alerts bell mounts), creates the `magicrita` channel, and
  schedules a local notification through `@capacitor/local-notifications`. The
  envelope signature (a string) is hashed to the 32-bit numeric id the plugin
  needs, so a repeat replaces its notification. The monochrome status-bar icon
  is `android/app/src/main/res/drawable-*/ic_notification.png`, set as
  `plugins.LocalNotifications.smallIcon` in `capacitor.config.ts`. On web this
  path is not used: it keeps the browser `Notification`.
- **Launcher icons.** `android_icons/res/` (committed) is the branded set
  generated from the logo: adaptive `mipmap-*/ic_launcher*.png` (`foreground` +
  `monochrome` for themed icons on Android 13+), the `mipmap-anydpi-v26`
  adaptive XML, `values/ic_launcher_background.xml` (`#0A0A0A`), and the
  `drawable-*/ic_notification.png` status icon. Copy its `res/` over
  `android/app/src/main/res/` (merge) to refresh them; `playstore/` holds the
  512×512 asset for the store listing.
- **No Android Auto Backup**: `android:allowBackup="false"`, so the WebView
  storage (vault, notes, chats) is not copied to Google's cloud. Moving devices
  means using the in-app export, not a system restore.
- **Scripts**: `npm run cap:sync` (build + sync) and `npm run cap:open` (open
  the project in Android Studio).

## Building and signing the APK

Needs the **Android SDK** (Android Studio) and a JDK **17–24**. The Gradle
wrapper is 8.14.3, which does **not** run on JDK 25: Android Studio's bundled
JBR can be too new (`Unsupported class file major version 69`). In that case
point `JAVA_HOME` to a JDK 17–24 before building. `compileSdk`/`targetSdk` is
36; if the SDK only has another platform installed, the Android Gradle Plugin
downloads the missing one on first build (an accepted SDK license is required).

From the `android/` folder:

```bash
npx cap sync android          # or: npm run cap:sync
cd android
./gradlew assembleDebug        # debug APK: app/build/outputs/apk/debug/
./gradlew assembleRelease      # release AAB/APK (needs signing config)
```

Release signing reads `android/keystore.properties` (git-ignored):

```
storeFile=C:/path/to/magicrita-release.jks
storePassword=...
keyAlias=magicrita
keyPassword=...
```

`android/app/build.gradle` loads it (if present) into `signingConfigs.release`
and signs the release build with it; without the file, `assembleRelease` still
builds but leaves the APK unsigned. Keep the `.jks` **out of git** and back it
up: if you lose it and do not use Play App Signing, you cannot update the app on
Play. Bump `appVersionCode`/`appVersionName` in `android/variables.gradle` for
each release and respect the current Play `targetSdk` requirement.

## Google Play compliance

Technical items already in place:

- `targetSdk`/`compileSdk` **36** (`android/variables.gradle`), which meets the API-level requirement (new apps must target API 36 since 31 Aug 2026).
- Permissions limited to `INTERNET`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, and `POST_NOTIFICATIONS`.
- `android:usesCleartextTraffic="false"` and `allowMixedContent false`: HTTPS/WSS only.
- `allowBackup="false"`: no Android Auto Backup of the WebView storage to Google.
- Release build uses **R8** (`minifyEnabled true`, `shrinkResources true`).
- App version centralized in `android/variables.gradle` (`appVersionCode`/`appVersionName`); bump `versionCode` on every upload.
- **Terms of use gate** (`src/features/legal/TermsGate.tsx`): the app is blocked until the terms are accepted, and the terms define prohibited content. Report/block exist, and the operator can block an `rpub`. This covers the UGC policy's terms-and-moderation requirements.

Still required in Play Console (operational, not code):

- A hosted **privacy policy** URL and the **Data safety** form.
- **Data deletion** questions; if Play treats the local identity as an "account", also a web deletion resource (the in-app path already exists in Settings → delete identity).
- **Content rating** questionnaire (UGC) and the **app access** instructions for reviewers: the beta is invite-only, so provide a valid invite code (or open the beta) or review will fail.
- **Encryption/export compliance** declaration.
- **Play App Signing** (or an upload keystore), a signed **AAB**, and store listing assets (512 icon, feature graphic, screenshots).
- Developer verification, and for new personal accounts the 12-tester / 14-day closed test before production.

## Not done yet

- **Deep links / share-target** are not configured.
- **Notifications are local, not push.** They are scheduled by the app when a
  signed envelope arrives while it is still connected; there is no push service,
  so nothing pings the device if the app is fully killed (keeping the relay
  key-free and the app serverless).

## Risks

- **CGNAT:** mobile carriers put many users behind one IP, so the relay's per-IP
  limits (sockets, `hello`, `/moderation/check`) bite sooner than on web.
- **Connectivity:** without network the app opens and shows local data, but the
  feed/chat need the relay.
- The APK depends on `magicrita.com` serving `/signal/` (wss) and the public
  HTTP routes with CORS.

## Verification

```bash
npx tsc -b
npm run build            # web, must keep the admin chunk
npm run build:android    # dist-android/, must NOT emit AdminPage/adminPath
node --check server/signal.mjs
```

Check that `dist-android/index.html` has `https://magicrita.com` and
`wss://magicrita.com` in `connect-src`, that `dist-android/assets/` has no
`AdminPage-*.js`/`adminPath-*.js`, and that `dist/assets/` still has them.
