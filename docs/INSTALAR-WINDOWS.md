# Install MagicRita (web + admin) on Windows 11

This guide installs and runs the **web app and the admin panel on Windows 11**
without the Android part. No Android SDK, no Android Studio, no JDK, and no
Gradle are needed: `android/`, Capacitor, and the `build:android` / `cap:*`
scripts are optional and can be ignored.

The admin panel is **not a separate app**: it is a route of the same SPA (default
`/topogue`) served from the same origin, so it comes with the web build for free.
The relay (`server/signal.mjs`) provides its API and stores only operator config
in `data/`.

It also covers publishing both on **your own domain with HTTPS**, using nginx for
Windows and win-acme (see the last section).

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

## Publish on your own domain with HTTPS (nginx for Windows + win-acme)

This turns the local install into a public site on **YOUR-DOMAIN** over TLS. The
model matches `docs/INSTALAR-VPS.md`: nginx serves the static `dist/` and proxies
the relay routes; the Node relay stays on `127.0.0.1:8787` and never serves the
SPA.

Prerequisites:

- The domain's DNS **A** record points at this PC's public IP.
- The router forwards **TCP 80 and 443** to this PC.
- **nginx for Windows** unzipped to `C:\nginx` (`https://nginx.org/en/download.html`).
- **win-acme** (`wacs.exe`) unzipped to `C:\win-acme` (`https://www.win-acme.com/`).
- **NSSM** to run the relay and nginx as Windows services (`https://nssm.cc/`).
- PowerShell **as Administrator** for the service, firewall, and certificate steps.

Replace `YOUR-DOMAIN` everywhere (example `magicrita.com`).

### A. Build the site

Signaling is same-host, but bake the host so the strict CSP allows it:

```powershell
Set-Location C:\magicrita
```

```powershell
$env:VITE_SIGNAL_URL = "wss://YOUR-DOMAIN/signal/"
```

```powershell
npm ci
```

```powershell
npm run build
```

```powershell
Remove-Item Env:VITE_SIGNAL_URL
```

### B. Production `.env`

Same file as the local install, but **`TRUST_PROXY=1` is required** so per-IP
limits use the real client IP that nginx forwards:

```
ADMIN_USER=your-admin
ADMIN_PASSWORD=a-long-password
RUTA_ADMINISTRACION=topogue
PORT=8787
HOST=127.0.0.1
TRUST_PROXY=1
```

### C. Run the relay as a service (NSSM)

```powershell
nssm install magicrita-signal "C:\Program Files\nodejs\node.exe"
```

```powershell
nssm set magicrita-signal AppDirectory C:\magicrita
```

```powershell
nssm set magicrita-signal AppParameters "--env-file=.env server\signal.mjs"
```

```powershell
nssm set magicrita-signal Start SERVICE_AUTO_START
```

```powershell
nssm start magicrita-signal
```

Check it listens only on localhost:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen
```

You should see `127.0.0.1`, not `0.0.0.0`.

### D. Firewall

```powershell
New-NetFirewallRule -DisplayName "MagicRita HTTP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80
```

```powershell
New-NetFirewallRule -DisplayName "MagicRita HTTPS" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443
```

### E. nginx, first pass (port 80 only)

The certificate does not exist yet, so start with HTTP. Create the ACME challenge
folder:

```powershell
New-Item -ItemType Directory -Force C:\certs\acme | Out-Null
```

Replace `C:\nginx\conf\nginx.conf` with this (change `YOUR-DOMAIN`):

```nginx
worker_processes 1;
events { worker_connections 1024; }

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    server_tokens off;
    client_max_body_size 10m;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    server {
        listen 80;
        server_name YOUR-DOMAIN;

        location /.well-known/acme-challenge/ {
            root C:/certs/acme;
        }

        root C:/magicrita/dist;
        index index.html;

        location / {
            try_files $uri $uri/ /index.html =404;
        }

        location /signal/ {
            proxy_pass http://127.0.0.1:8787/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            # Sobrescribe, NO añade: con $proxy_add_x_forwarded_for el cliente
            # podria anteponer una IP falsa y esquivar los limites por IP.
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }

        location /moderation/ {
            proxy_pass http://127.0.0.1:8787/moderation/;
            proxy_set_header Host $host;
        }

        location /admin-api/ {
            proxy_pass http://127.0.0.1:8787/admin-api/;
            proxy_set_header Host $host;
            proxy_set_header Authorization $http_authorization;
        }

        location /admin-path {
            proxy_pass http://127.0.0.1:8787/admin-path;
            proxy_set_header Host $host;
        }

        location /beta {
            proxy_pass http://127.0.0.1:8787;
            proxy_set_header Host $host;
        }

        location /brand {
            proxy_pass http://127.0.0.1:8787;
            proxy_set_header Host $host;
        }
    }
}
```

Test and start (nginx must run from its own folder):

```powershell
C:\nginx\nginx.exe -p C:\nginx -t
```

```powershell
Start-Process -FilePath C:\nginx\nginx.exe -ArgumentList "-p","C:\nginx" -WorkingDirectory C:\nginx
```

Open `http://YOUR-DOMAIN/`: it must serve the app, and `http://YOUR-DOMAIN/` plus
the admin path must reach the panel (login will be plain HTTP until the next
step).

### F. Issue the certificate (win-acme)

Run win-acme **as Administrator**. This is the unattended form (HTTP-01, challenge
written to the nginx webroot, PEM files for nginx, nginx reloaded on each
renewal):

```powershell
Set-Location C:\win-acme
```

```powershell
.\wacs.exe --source manual --host YOUR-DOMAIN --validation filesystem --webroot "C:\certs\acme" --store pemfiles --pemfilespath "C:\certs\magicrita" --pemfilesname magicrita --installation script --script "C:\nginx\reload-nginx.cmd" --accepttos --emailaddress you@example.com
```

`--pemfilesname magicrita` gives stable filenames independent of the domain:

- `C:\certs\magicrita\magicrita-chain.pem` — certificate plus chain (`ssl_certificate`)
- `C:\certs\magicrita\magicrita-key.pem` — private key (`ssl_certificate_key`)

Create the reload script `C:\nginx\reload-nginx.cmd`; win-acme runs it after every
issuance and renewal:

```bat
@echo off
"C:\nginx\nginx.exe" -p C:\nginx -s reload
```

win-acme also registers a **scheduled task** that renews the certificate before it
expires.

### G. nginx, final (80 redirect + 443 TLS)

Now that the PEM files exist, switch to TLS. Keep the ACME challenge location on
port 80 so renewals keep working. Replace `C:\nginx\conf\nginx.conf` with:

```nginx
worker_processes 1;
events { worker_connections 1024; }

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    server_tokens off;
    client_max_body_size 10m;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    server {
        listen 80;
        server_name YOUR-DOMAIN;

        # Renovacion de certificado por HTTP-01.
        location /.well-known/acme-challenge/ {
            root C:/certs/acme;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl;
        server_name YOUR-DOMAIN;

        ssl_certificate     C:/certs/magicrita/magicrita-chain.pem;
        ssl_certificate_key C:/certs/magicrita/magicrita-key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_session_cache shared:SSL:10m;

        root C:/magicrita/dist;
        index index.html;

        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' wss://YOUR-DOMAIN; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Referrer-Policy no-referrer always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=()" always;

        location / {
            try_files $uri $uri/ /index.html =404;
        }

        location /signal/ {
            proxy_pass http://127.0.0.1:8787/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }

        location /moderation/ {
            proxy_pass http://127.0.0.1:8787/moderation/;
            proxy_set_header Host $host;
        }

        location /admin-api/ {
            proxy_pass http://127.0.0.1:8787/admin-api/;
            proxy_set_header Host $host;
            proxy_set_header Authorization $http_authorization;
        }

        location /admin-path {
            proxy_pass http://127.0.0.1:8787/admin-path;
            proxy_set_header Host $host;
        }

        location /beta {
            proxy_pass http://127.0.0.1:8787;
            proxy_set_header Host $host;
        }

        location /brand {
            proxy_pass http://127.0.0.1:8787;
            proxy_set_header Host $host;
        }
    }
}
```

```powershell
C:\nginx\nginx.exe -p C:\nginx -t
```

```powershell
C:\nginx\nginx.exe -p C:\nginx -s reload
```

Open `https://YOUR-DOMAIN/` and the admin path.

### H. Run nginx as a service (optional)

```powershell
nssm install nginx "C:\nginx\nginx.exe" "-p C:\nginx"
```

```powershell
nssm set nginx AppDirectory C:\nginx
```

```powershell
nssm set nginx Start SERVICE_AUTO_START
```

```powershell
nssm start nginx
```

Config or certificate changes only need `nginx -s reload` (see the win-acme
script); the service does not have to restart.

### I. Security checklist

- Relay on `127.0.0.1:8787` only; `TRUST_PROXY=1` set; `.env` not world-readable.
- nginx **overwrites** `X-Forwarded-For` (`$remote_addr`), never appends.
- nginx sends the security headers (CSP with `frame-ancestors`, `nosniff`,
  `X-Frame-Options`, `Referrer-Policy`, HSTS).
- Panel: `https://YOUR-DOMAIN/` plus `RUTA_ADMINISTRACION` (default `/topogue`).
  Beta codes are created and managed **only in the admin panel**.
- Still zero server storage: `data/` holds operator config only, never user
  content.

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
