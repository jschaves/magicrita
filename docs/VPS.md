# Signaling on a Linux VPS

The VPS **does not store** notes, photos, or keys. It only keeps in **RAM** who is connected right now and forwards WebRTC offers so browsers talk **to each other**.

When someone disconnects, they leave the list. There is no user database.

Admin-panel blocks **are** stored in `data/admin-blocks.json` (that folder is not in Git).

## Requirements

- Node.js 18 or newer
- nginx (for HTTPS, the web UI, and the WebSocket)
- Git, with access to the private repository

## Start

```bash
cd magicrita
cp .env.example .env
# Edit .env: ADMIN_USER, ADMIN_PASSWORD, RUTA_ADMINISTRACION, PORT, HOST
npm ci
npm run build
npm run signal
```

By default it listens on `0.0.0.0:8787`.

```bash
PORT=8787 HOST=0.0.0.0 npm run signal
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

    root /opt/magicrita/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /signal/ {
        proxy_pass http://127.0.0.1:8787/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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

The signal URL is **not edited in the app**. It is fixed:

- In development: `ws://localhost:8787`
- On the VPS: `wss://the-same-domain/signal/` (the web domain)
- If another host is needed, set it at build time: `VITE_SIGNAL_URL=wss://your-domain/signal/`

## systemd

The relay can hold thousands of WebSockets: the live list goes **without photos** and only announces joins and leaves, not the full roster on every `hello`.

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
