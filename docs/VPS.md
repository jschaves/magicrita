# Signaling on a Linux VPS

The VPS **does not store** notes, photos, or keys. It only keeps in **RAM** who is connected right now and forwards WebRTC offers so browsers talk **to each other**.

When someone disconnects, they leave the list. There is no user database.

The only things written to disk are operator configuration, never user content: `data/admin-blocks.json` (admin-panel blocks), `data/beta-invites.json` (invite codes), `data/admin-path.json` (runtime panel path), and `data/brand/` (uploaded logo). `data/` is not in Git.

## Requirements

- Node.js 18 or newer
- nginx (for HTTPS, the web UI, and the WebSocket)
- Git, with access to the private repository

## Start

```bash
cd magicrita
cp .env.example .env
# Edit .env: ADMIN_USER, ADMIN_PASSWORD, RUTA_ADMINISTRACION, PORT, HOST,
# and TRUST_PROXY=1 behind nginx
npm ci
npm run build
npm run signal
```

With the `.env.example` values it listens on `127.0.0.1:8787`; without a `.env`, the code default is `0.0.0.0:8787`. In production keep it on loopback, behind nginx:

```bash
PORT=8787 HOST=127.0.0.1 TRUST_PROXY=1 npm run signal
```

The signaler **does not serve** the UI. Build it first (`npm run build`) and serve `dist/` with nginx.

## HTTPS / WSS (nginx)

Replace `your-domain` and the project path.

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain;

    ssl_certificate     /etc/letsencrypt/live/your-domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain/privkey.pem;
    server_tokens off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' wss://your-domain; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;

    root /opt/magicrita/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
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
        # Sobrescribe la cabecera; no la añadas, o el cliente puede falsificar su IP.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 86400;
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

The `X-Forwarded-For` line **overwrites** the header. It goes together with `TRUST_PROXY=1` in `.env`: without `TRUST_PROXY` all clients look like `127.0.0.1` (the relay's per-IP limits and its 16-socket cap would then apply to the whole site); with it and an appending header (`$proxy_add_x_forwarded_for`) the client could inject a fake IP.

The signal URL is **not edited in the app**. It is fixed:

- In development: `ws://localhost:8787`
- On the VPS: `wss://the-same-domain/signal/` (the web domain)
- If another host is needed, set it at build time: `VITE_SIGNAL_URL=wss://your-domain/signal/`

## systemd

The relay can hold thousands of WebSockets: the live list goes **without photos** and announces joins and leaves. When someone joins, the relay pushes a roster snapshot (public `rpub`, name and interests, no media) to the connected peers.

```ini
[Unit]
Description=MagicRita signal
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/magicrita
ExecStart=/usr/bin/node server/signal.mjs
Restart=always
EnvironmentFile=/opt/magicrita/.env
Environment=NODE_OPTIONS=--max-old-space-size=2048
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

In nginx, for >5,000 connections, raise `worker_connections` (for example 16384) and `worker_rlimit_nofile 65535` in the global `events` block. VPS size: **4–8 GB RAM** and 4 vCPU if thousands are online at once.

Enable the service:

```bash
sudo cp magicrita-signal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now magicrita-signal
```
