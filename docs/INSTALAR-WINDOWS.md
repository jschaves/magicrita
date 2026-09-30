# Install MagicRita (web + admin) on Windows 11

This guide installs and runs the **web app and the admin panel on Windows 11**
without the Android part. No Android SDK, no Android Studio, no JDK, and no
Gradle are needed: `android/`, Capacitor, and the `build:android` / `cap:*`
scripts are optional and can be ignored.

The admin panel is **not a separate app**: it is a route of the same SPA (default
`/topogue`) served from the same origin, so it comes with the web build for free.
The relay (`server/signal.mjs`) provides its API and stores only operator config
in `data/`.

Commands are PowerShell. Run them one at a time.

Repo: `https://github.com/jschaves/magicrita.git` (private: `repo` token).

---

## 1. Requirements

- **Git**
- **Node.js 18 or newer** (includes `npm`)
- Access to the private GitHub repository

With `winget` you can install both in one line:

```powershell
winget install --id Git.Git -e
```

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

Close and reopen PowerShell so `PATH` refreshes, then check:

```powershell
git --version
```

```powershell
node --version
```

```powershell
npm --version
```

`node` must print **v18 or newer**.

## 2. Clone

HTTPS (GitHub asks for a user and a Personal Access Token with `repo` scope, not
the account password):

```powershell
git clone https://github.com/jschaves/magicrita.git
```

```powershell
Set-Location magicrita
```

## 3. Environment

`.env` is **not** in Git. Create it from the template:

```powershell
Copy-Item .env.example .env
```

Edit it and set the admin credentials (the path is the admin URL segment):

```powershell
notepad .env
```

```
ADMIN_USER=your-admin
ADMIN_PASSWORD=a-long-password
RUTA_ADMINISTRACION=topogue
PORT=8787
HOST=127.0.0.1
```

Leave `TRUST_PROXY` unset: there is no reverse proxy locally.

## 4. Install dependencies and run

```powershell
npm ci
```

If `npm ci` fails (for example after a manual dependency edit), use:

```powershell
npm install
```

`npm ci` also downloads the `@capacitor/*` packages because they are declared as
regular dependencies, but they stay inert without the Android scripts.

Start the app:

```powershell
npm run dev
```

This starts Vite on port 5173 and spawns the relay on port 8787. If a stale relay
is still holding the port from an earlier session, `npm run dev` replaces it, so
you never talk to an old build.

## 5. Open it

- **Web:** `http://localhost:5173/`
- **Admin:** `http://localhost:5173/` plus `RUTA_ADMINISTRACION` (default
  `http://localhost:5173/topogue`)

Use `localhost`, not a LAN IP such as `http://192.168.x.x`: microphone and camera
need a secure context (`https://` or `http://localhost`).

Stop with `Ctrl+C`. After changes to the relay or to `.env`, restart
`npm run dev` so `signal.mjs` reloads.

## 6. Optional: production build

To produce the static site locally:

```powershell
npm run build
```

The output is `dist/`. On Windows, `npm run dev` is the supported way to run the
**web + admin** together, because the dev server proxies `/admin-api`,
`/admin-path`, `/moderation`, `/brand`, and `/beta` to the relay. `npm run
preview` serves `dist/` but does **not** proxy those routes, so the admin API
would not respond. For a real production deployment (nginx + HTTPS), see
`docs/INSTALAR-VPS.md`; the relay is the same `server/signal.mjs`:

```powershell
npm run signal
```

The relay never serves the web UI.

## 7. Check

- Open `http://localhost:5173/` and the admin path; both must load.
- The relay listens only on `127.0.0.1:8787` (`HOST=127.0.0.1`), not on the
  public internet.
- Beta invite codes are created and managed **only in the admin panel** (stored
  in `data/beta-invites.json`).
- `data/` holds operator config only: admin blocks, beta invites, the runtime
  admin path, and the uploaded logo. Never user content.

---

## Troubleshooting

**Port 8787 busy.** `npm run dev` replaces an orphaned MagicRita relay holding the
port. If another program owns it, change `PORT` in `.env` (and restart).

**`npm ci` fails.** Use `npm install` (see step 4).

**Mic/camera do not work.** Use `http://localhost` or `https://`, never a LAN IP.

**Admin panel 404.** The path is `RUTA_ADMINISTRACION` in `.env` (default
`/topogue`). Changing it needs a restart of `npm run dev` (a production build
needs a rebuild).

---

## Android is not required

Nothing in this guide touches `android/`, Capacitor, or the `build:android` /
`cap:sync` / `cap:open` scripts. For the APK, see `docs/ANDROID.md`; it needs the
Android SDK (Android Studio) and JDK 17-24, and it ships **without** the admin
panel.
