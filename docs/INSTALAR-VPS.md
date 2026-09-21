# Instalar MagicRita en Ubuntu (VPS)

Guía para un Ubuntu limpio (22.04 / 24.04 / 26.04) con **solo git**. Un comando cada vez.

Sustituye `TU-DOMINIO` (ejemplo: `magicrita.com`). El DNS **A** debe apuntar ya a la IP del VPS.

**Seguridad:** nginx en 80 y 443. El relé Node **solo** en `127.0.0.1:8787` (no en Internet). El puerto 80 sirve el certificado y redirige a HTTPS.

Repo: `https://github.com/jschaves/magicrita.git` (privado: token `repo`).

---

## 1. Sistema

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

`node` debe ser **v18 o más**.

## 3. Usuario y firewall

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

## 4. Código

Personal Access Token de GitHub con permiso `repo` (el repositorio es privado).

```bash
sudo mkdir -p /opt/magicrita
```

```bash
sudo chown magicrita:magicrita /opt/magicrita
```

```bash
sudo -u magicrita git clone https://github.com/jschaves/magicrita.git /opt/magicrita
```

(Usuario de GitHub; como contraseña, el token.)

```bash
sudo -u magicrita cp /opt/magicrita/.env.example /opt/magicrita/.env
```

```bash
sudo -u magicrita nano /opt/magicrita/.env
```

Deja esto (cambia las tres claves). **`HOST=127.0.0.1` es obligatorio**:

```
ADMIN_USER=tu-admin
ADMIN_PASSWORD=una-clave-larga
BETA_INVITE=rita-beta-0.1
PORT=8787
HOST=127.0.0.1
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

Sustituye el dominio:

```bash
sudo -u magicrita env VITE_SIGNAL_URL=wss://TU-DOMINIO/signal/ npm run build
```

Si `tsc` falla, actualiza y vuelve a construir:

```bash
sudo -u magicrita git pull
```

```bash
sudo -u magicrita env VITE_SIGNAL_URL=wss://TU-DOMINIO/signal/ npm run build
```

Comprueba que existe la web:

```bash
ls -la /opt/magicrita/dist
```

Debe verse `index.html` y `assets/`. Si no hay `dist`, nginx dará **500**.

Permisos para que nginx lea la carpeta:

```bash
sudo chmod 755 /opt /opt/magicrita
```

```bash
sudo chmod -R a+rX /opt/magicrita/dist
```

## 5. Relé (systemd)

```bash
sudo nano /etc/systemd/system/magicrita-signal.service
```

Pega:

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

Puede salir: `Created symlink ... magicrita-signal.service`. Es **normal** (queda activado al reiniciar). No es el estado de si corre.

El estado se mira así:

```bash
sudo systemctl status magicrita-signal --no-pager
```

Debe decir `Active: active (running)`.

Si sale `failed`:

```bash
sudo journalctl -u magicrita-signal -n 50 --no-pager
```

El puerto 8787 **solo** en localhost:

```bash
ss -lntp | grep 8787
```

Debe verse `127.0.0.1:8787`, no `0.0.0.0:8787`.

## 6. nginx (puerto 80)

```bash
sudo nano /etc/nginx/sites-available/magicrita
```

Pega (cambia `TU-DOMINIO`). El `=404` evita el bucle 500 si falta `index.html`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name TU-DOMINIO;

    root /opt/magicrita/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html =404;
    }

    location /signal/ {
        proxy_pass http://127.0.0.1:8787/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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

Prueba `http://TU-DOMINIO`.

## 7. HTTPS (443)

```bash
sudo certbot --nginx -d TU-DOMINIO --agree-tos -m beta@magicrita.com --redirect
```

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

Abre `https://TU-DOMINIO`. El 80 redirige a 443.

## 8. Comprobar

```bash
sudo systemctl status magicrita-signal --no-pager
```

```bash
curl -sI https://TU-DOMINIO | head
```

```bash
sudo ss -lntp | grep -E ':80|:443|:8787'
```

- 80 y 443: nginx  
- 8787: solo `127.0.0.1`

Panel: `https://TU-DOMINIO/topogue`  
Código de beta: el de `BETA_INVITE` en `.env`  
Notas legales: `https://TU-DOMINIO/legal`

---

## Si sale 500 Internal Server Error

Casi siempre: **no existe `/opt/magicrita/dist`** (el `npm run build` no terminó) y nginx entra en ciclo con `/index.html`.

```bash
sudo tail -n 40 /var/log/nginx/error.log
```

Si ves `rewrite or internal redirection cycle while internally redirecting to "/index.html"`:

```bash
ls -la /opt/magicrita/dist
```

Si no existe, vuelve al **paso 4** (`git pull`, `npm ci`, `npm run build`) y los `chmod` de `dist`.

Confirma el `try_files` con `=404` y recarga nginx:

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

---

## Actualizar más adelante

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
sudo -u magicrita env VITE_SIGNAL_URL=wss://TU-DOMINIO/signal/ npm run build
```

```bash
sudo chmod -R a+rX /opt/magicrita/dist
```

```bash
sudo systemctl restart magicrita-signal
```
