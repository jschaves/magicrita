# MagicRita

Red social **con protocolo propio**, construida paso a paso.

No es un cliente de Nostr, Mastodon ni Farcaster. La identidad y los mensajes
son un formato MagicRita (`rpub` / `rsec` + sobres firmados). El detalle está
en `docs/PROTOCOLO.md`.

## Idiomas

La interfaz está en **español, inglés, portugués, francés, árabe, ruso, chino y japonés**. El idioma se detecta del navegador y se cambia en la bienvenida y en Ajustes. Las notas que escribes no se traducen. El árabe usa dirección derecha-izquierda.

## Señalización (VPS)

El servidor Linux **no guarda datos de usuarios**. Solo ve conexiones vivas y une a los clientes (WebRTC). Cómo montarlo: `docs/VPS.md`.

```bash
npm run signal
```

La URL de señalización es fija (no se edita en la app): en local `ws://localhost:8787`; en producción `wss://tu-dominio/signal/` o `VITE_SIGNAL_URL` al construir.

## Paso 4 (hecho)

- Chat cifrado de extremo a extremo (pedir, aceptar, revocar o bloquear)
- 280 caracteres por mensaje, 50 por conversación en este navegador

## Paso 5 (hecho)

- Fotos firmadas (SHA-256) en el sobre, una por nota
- Viajan entre pares y en el archivo portable; el relé no las guarda

## Paso 3 (hecho)

- Relé propio de señalización: une a quien está conectado (WebRTC)
- No guarda notas, perfiles ni claves (solo RAM)
- Buzón en memoria si el otro está ausente; se pierde al reiniciar el proceso

## Paso 2 (hecho)

- **Exportar mis datos** e **importarlos** en otro navegador o dispositivo
- El archivo es tu cuenta (identidad cifrada, notas y fotos), no la sesión de otra persona

## Paso 1 (hecho)

- Crear o importar una identidad Ed25519
- Cifrar la `rsec` en el navegador
- Perfil y notas firmadas, guardadas solo en este dispositivo

---

## Requisitos en cualquier máquina

- **Git**
- **Node.js 18 o superior** (incluye `npm`)
- Acceso al repositorio privado de GitHub

Comprueba las versiones:

```bash
git --version
node --version
npm --version
```

## Clonar el repositorio privado

**HTTPS** (GitHub pedirá usuario y un *Personal Access Token* con permiso `repo`, no la contraseña de la cuenta):

```bash
git clone https://github.com/jschaves/magicrita.git
cd magicrita
```

**SSH** (si tienes clave añadida en GitHub):

```bash
git clone git@github.com:jschaves/magicrita.git
cd magicrita
```

## Configurar variables

El archivo `.env` **no va en Git**. En cada máquina nueva:

```bash
cp .env.example .env
```

En Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

Edita `.env` y rellena al menos:

| Variable | Uso |
| --- | --- |
| `ADMIN_USER` | Usuario del panel `/topogue` |
| `ADMIN_PASSWORD` | Contraseña del panel |
| `PORT` | Puerto del señalizador (por defecto `8787`) |
| `HOST` | Dirección de escucha (por defecto `0.0.0.0`) |
| `VITE_SIGNAL_URL` | Solo al **construir** para producción si la señal no está en el mismo dominio |

`node_modules/`, `dist/` y `data/` tampoco se suben. Se generan en cada máquina.

## Desarrollo (app + señal en local)

```bash
npm ci
npm run dev
```

Si `npm ci` falla (por ejemplo, cambiaste dependencias a mano), usa `npm install`.

Abre `http://localhost:5173`. El señalizador arranca solo en el puerto `8787`. El panel de administración está en `http://localhost:5173/topogue`.

## Producción en otra máquina (VPS Linux)

1. Clona el repositorio (apartado de arriba) y entra en la carpeta.
2. Instala dependencias y crea `.env` con las credenciales de admin.
3. Construye la web. Si la señal va en el mismo dominio, no hace falta `VITE_SIGNAL_URL`:

```bash
npm ci
npm run build
```

Si la señal está en otro host:

```bash
VITE_SIGNAL_URL=wss://tu-dominio/signal/ npm run build
```

4. Arranca el señalizador y sirve la carpeta `dist/` con nginx. Instalación en Ubuntu (comandos uno a uno): `docs/INSTALAR-VPS.md`. Relé, nginx y systemd: `docs/VPS.md`.

Resumen mínimo:

```bash
npm run signal
```

El señalizador no sirve la web. nginx debe entregar `dist/` y reenviar `/signal/` al puerto `8787`.

## Qué se sube y qué no

| En el repositorio | Solo en cada máquina |
| --- | --- |
| Código (`src/`, `server/`, `docs/`) | `node_modules/` |
| `package.json` y `package-lock.json` | `dist/` (salida de `npm run build`) |
| `.env.example` | `.env` (secretos) |
| | `data/` (bloqueos del panel de admin) |
