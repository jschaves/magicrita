# Install MagicRita on Ubuntu (VPS)

Guide for a clean Ubuntu (22.04 / 24.04 / 26.04) with **git only**. One command at a time.

Replace `YOUR-DOMAIN` (example: `magicrita.com`). The DNS **A** record must already point at the VPS IP.

**Security:** nginx on 80 and 443. The Node relay **only** on `127.0.0.1:8787` (not on the public internet). Port 80 serves the certificate and redirects to HTTPS.

Repo: `https://github.com/jschaves/magicrita.git` (private: `repo` token).

---

## 1. System

```bash
sudo apt update
```

```bash
sudo apt upgrade -y
```

```bash
sudo apt install -y curl ufw nginx certbot python3-certbot-nginx fail2ban unattended-upgrades
```

## 2. Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt install -y nodejs
```

```bash
node -v
```

```bash
npm -v
```

`node` must be **v18 or newer**.

## 3. User and firewall

```bash
sudo adduser --disabled-password --gecos "" magicrita
```

```bash
sudo ufw default deny incoming
```

```bash
sudo ufw default allow outgoing
```

```bash
sudo ufw allow OpenSSH
```

```bash
sudo ufw allow 80/tcp
```

```bash
sudo ufw allow 443/tcp
```

```bash
sudo ufw enable
```

```bash
sudo ufw status
```

## 4. Code

GitHub Personal Access Token with `repo` scope (the repository is private).

```bash
sudo mkdir -p /opt/magicrita
```

```bash
sudo chown magicrita:magicrita /opt/magicrita
```

```bash
sudo -u magicrita git clone https://github.com/jschaves/magicrita.git /opt/magicrita
```

(GitHub username; as password, the token.)

```bash
sudo -u magicrita cp /opt/magicrita/.env.example /opt/magicrita/.env
```

```bash
sudo -u magicrita nano /opt/magicrita/.env
```

Leave this (change the three secrets). **`HOST=127.0.0.1` is required**, and **`TRUST_PROXY=1` is required behind nginx** so per-IP limits use the real client IP:

```
ADMIN_USER=your-admin
ADMIN_PASSWORD=a-long-password
RUTA_ADMINISTRACION=topogue
PORT=8787
HOST=127.0.0.1
TRUST_PROXY=1
```

```bash
sudo chmod 600 /opt/magicrita/.env
```

```bash
cd /opt/magicrita
```

```bash
sudo -u magicrita npm ci
```

Replace the domain:

```bash
sudo -u magicrita env VITE_SIGNAL_URL=wss://YOUR-DOMAIN/signal/ npm run build
```

If `tsc` fails, pull and build again:

```bash
sudo -u magicrita git pull
```

```bash
sudo -u magicrita env VITE_SIGNAL_URL=wss://YOUR-DOMAIN/signal/ npm run build
```

Check that the web UI exists:

```bash
ls -la /opt/magicrita/dist
```

You should see `index.html` and `assets/`. If there is no `dist`, nginx will return **500**.

Permissions so nginx can read the folder:

```bash
sudo chmod 755 /opt /opt/magicrita
```

```bash
sudo chmod -R a+rX /opt/magicrita/dist
```

## 5. Relay (systemd)

```bash
sudo nano /etc/systemd/system/magicrita-signal.service
```

Paste:

```ini
[Unit]
Description=MagicRita signal
After=network.target

[Service]
Type=simple
User=magicrita
Group=magicrita
WorkingDirectory=/opt/magicrita
ExecStart=/usr/bin/node server/signal.mjs
Restart=always
EnvironmentFile=/opt/magicrita/.env
Environment=NODE_OPTIONS=--max-old-space-size=2048
LimitNOFILE=65535
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/magicrita/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /opt/magicrita/data
```

```bash
sudo chown magicrita:magicrita /opt/magicrita/data
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable --now magicrita-signal
```

You may see: `Created symlink ... magicrita-signal.service`. That is **normal** (it will start on boot). It is not the running state.

Check status like this:

```bash
sudo systemctl status magicrita-signal --no-pager
```

It must say `Active: active (running)`.

If it says `failed`:

```bash
sudo journalctl -u magicrita-signal -n 50 --no-pager
```

Port 8787 **only** on localhost:

```bash
ss -lntp | grep 8787
```

You should see `127.0.0.1:8787`, not `0.0.0.0:8787`.

## 6. nginx (port 80)

```bash
sudo nano /etc/nginx/sites-available/magicrita
```

Paste (change `YOUR-DOMAIN`). The `=404` avoids a 500 loop if `index.html` is missing:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name YOUR-DOMAIN;

    root /opt/magicrita/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html =404;
        # Cabeceras de seguridad (frame-ancestors solo funciona por cabecera).
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' wss://YOUR-DOMAIN; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Referrer-Policy no-referrer always;
    }

    location /signal/ {
        proxy_pass http://127.0.0.1:8787/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        # Sobrescribe, NO añade: con $proxy_add_x_forwarded_for el cliente
        # podía anteponer una IP falsa y esquivar los límites por IP del relé.
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
```

```bash
sudo ln -s /etc/nginx/sites-available/magicrita /etc/nginx/sites-enabled/magicrita
```

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

Try `http://YOUR-DOMAIN`.

## 7. HTTPS (443)

```bash
sudo certbot --nginx -d YOUR-DOMAIN --agree-tos -m beta@magicrita.com --redirect
```

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

Open `https://YOUR-DOMAIN`. Port 80 redirects to 443.

After HTTPS is on, hide the nginx version and add headers so endpoint antivirus trusts the origin (no third-party scripts). In `/etc/nginx/nginx.conf` inside `http {`:

```nginx
server_tokens off;
```

In the **443** `server {` block (the one certbot created), add:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy no-referrer always;
add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' wss://YOUR-DOMAIN; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
```

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

## 8. Check

```bash
sudo systemctl status magicrita-signal --no-pager
```

```bash
curl -sI https://YOUR-DOMAIN | head
```

```bash
sudo ss -lntp | grep -E ':80|:443|:8787'
```

- 80 and 443: nginx  
- 8787: only `127.0.0.1`

Security: `.env` has `HOST=127.0.0.1` and `TRUST_PROXY=1`, and nginx **overwrites** `X-Forwarded-For` (`$remote_addr`). nginx sends the `Content-Security-Policy` (with `frame-ancestors`), `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` headers.

Panel: `https://YOUR-DOMAIN/` plus the `RUTA_ADMINISTRACION` value in `.env` (default `/topogue`)  
Beta codes: created and managed **only in the admin panel** (`data/beta-invites.json`); a code works only while it exists and is enabled. The code is **requested by email**, it is not published.  
Legal notes: `https://YOUR-DOMAIN/legal`

---

## If you get 500 Internal Server Error

Almost always: **`/opt/magicrita/dist` does not exist** (`npm run build` did not finish) and nginx loops on `/index.html`.

```bash
sudo tail -n 40 /var/log/nginx/error.log
```

If you see `rewrite or internal redirection cycle while internally redirecting to "/index.html"`:

```bash
ls -la /opt/magicrita/dist
```

If it is missing, go back to **step 4** (`git pull`, `npm ci`, `npm run build`) and the `chmod` on `dist`.

Confirm `try_files` has `=404` and reload nginx:

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

---

## Updating later

```bash
cd /opt/magicrita
```

```bash
sudo -u magicrita git pull
```

```bash
sudo -u magicrita npm ci
```

```bash
sudo -u magicrita env VITE_SIGNAL_URL=wss://YOUR-DOMAIN/signal/ npm run build
```

```bash
sudo chmod -R a+rX /opt/magicrita/dist
```

```bash
sudo systemctl restart magicrita-signal
```
