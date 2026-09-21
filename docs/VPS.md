# Señalización en VPS Linux

El VPS **no guarda** notas, fotos ni claves. Solo tiene en **memoria RAM** quién está conectado ahora y reenvía ofertas WebRTC para que los navegadores se hablen **entre ellos**.

Cuando alguien se desconecta, desaparece de la lista. No hay base de datos de usuarios.

Los bloqueos del panel de administración sí se guardan en `data/admin-blocks.json` (esa carpeta no va en Git).

## Requisitos

- Node.js 18 o superior
- nginx (para HTTPS, la web y el WebSocket)
- Git, con acceso al repositorio privado

## Arranque

```bash
cd magicrita
cp .env.example .env
# Edita .env: ADMIN_USER, ADMIN_PASSWORD, PORT, HOST
npm ci
npm run build
npm run signal
```

Por defecto escucha `0.0.0.0:8787`.

```bash
PORT=8787 HOST=0.0.0.0 npm run signal
```

El señalizador **no sirve** la interfaz. Primero hay que construirla (`npm run build`) y entregar `dist/` con nginx.

## HTTPS / WSS (nginx)

Sustituye `tu-dominio` y la ruta del proyecto.

```nginx
server {
    listen 443 ssl http2;
    server_name tu-dominio;

    ssl_certificate     /etc/letsencrypt/live/tu-dominio/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio/privkey.pem;

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

La URL de señal **no se edita en la app**. Es fija:

- En desarrollo: `ws://localhost:8787`
- En el VPS: `wss://el-mismo-dominio/signal/` (el de la web)
- Si hace falta otra, se define al construir: `VITE_SIGNAL_URL=wss://tu-dominio/signal/`

## systemd

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

[Install]
WantedBy=multi-user.target
```

Activa el servicio:

```bash
sudo cp magicrita-signal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now magicrita-signal
```
