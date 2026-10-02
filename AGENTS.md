# AGENTS.md — instrucciones del proyecto MagicRita

MagicRita es una red social **local-first con protocolo propio**. Identidad, notas, media y chat
viven en el dispositivo (`rpub`/`rsec` + sobres Ed25519 firmados). El único servicio compartido es
un **relé de señalización** en RAM. Mantén siempre: sin servidor de cuentas, sin base de datos de
publicaciones y sin claves en el relé.

## Regla obligatoria: ramas, Android y commits (permanente)

- **Trabajamos siempre en la rama `apk-android-magicrita`.** Nunca cambiamos a otra rama de trabajo.
- **Cada commit va a `apk-android-magicrita` y también a `main`**, y **nos mantenemos en
  `apk-android-magicrita`** (nunca dejar la sesión en `main`).
- **Todo cambio se aplica también a Android**, salvo las dos excepciones de abajo.
- **Android NO lleva el panel de administración.** Nunca debe emitirse el chunk `AdminPage` /
  `adminPath` en `dist-android/`; el panel es **solo web**.
- **Android NO lleva el servidor relé.** El relé (`server/signal.mjs`) es **solo web/servidor**; en
  la app el relé es externo y se configura en `.env.android`.
- En **web sí** existen el panel de administración y el servidor relé.
- Al compilar Android: `npm run build:android` (nunca debe incluir admin) y `npm run cap:sync`
  cuando se toquen assets nativos. Verificación mínima: `npx tsc -b`, `npm run build`, y
  `node --check server/signal.mjs`.

## Regla obligatoria: cero almacenamiento (solo este proyecto)

Este proyecto **nunca** guarda datos de usuario fuera del dispositivo. Es innegociable:

- **Sin base de datos ni ficheros de usuario en el servidor.** El relé solo usa RAM y se vacía al
  reiniciar. Prohibido guardar cuentas, perfiles, publicaciones, media, chat, mensajes o claves.
- **La única persistencia en `data/` es configuración del operador**: bloqueos de moderación,
  códigos de invitación de la beta, ruta del panel y logo. Nunca contenido de usuarios. Si una
  funcionalidad nueva necesita guardar algo en el servidor, recházala o rediseñala en RAM/P2P.
- **Sin cookies.** La app no usa cookies y el relé no envía `Set-Cookie`.
- **Sin terceros**: nada de analytics, tracking, cookies de terceros, CDN, fuentes o imágenes
  externas. (Única excepción documentada: el servidor STUN de WebRTC, configurable con
  `VITE_STUN_URL`.)
- Los datos del usuario viven **solo en su dispositivo** (`localStorage`/IndexedDB) y viajan
  **peer to peer**.

## Regla obligatoria: documentar cada cambio

**Todo cambio, mejora o modificación funcional debe quedar reflejado en `README.md` o en el
documento que proceda, en el mismo cambio.** No se considera terminada una tarea si el
comportamiento documentado ya no coincide con el código.

Mapa de dónde va cada cosa:

| Tipo de cambio | Documento |
| --- | --- |
| Producto, límites, cifrado, seguridad, superficies de la app, stack, scripts | `README.md` |
| Formato de sobres, identidad, cadena local, anti-spam, cifrado del protocolo | `docs/PROTOCOLO.md` |
| Relé, WebSocket, límites en RAM, nginx, systemd, HTTPS | `docs/VPS.md` |
| Instalación numerada en Ubuntu limpio | `docs/INSTALAR-VPS.md` |
| Instalación de web + admin en Windows 11 (sin Android), con dominio y SSL opcional | `docs/INSTALAR-WINDOWS.md` |
| Variables de entorno / secretos | `.env.example` **y** la tabla del `README.md` |
| Rutas HTTP/WS, mensajes, cabeceras, CSP, proxy | `README.md` + `docs/VPS.md` + `docs/INSTALAR-VPS.md` |

Reglas de forma:

- Escribe los cambios en **inglés** en `README.md` y en `docs/VPS.md` / `docs/INSTALAR-VPS.md` /
  `docs/PROTOCOLO.md` (están en inglés). Los comentarios del código y de configuración van en
  **español**, como el resto del repositorio.
- Al cambiar límites (posts, chats, mensajes, tamaños, TTL, bits de PoW, rate limits) actualiza
  **todos** los sitios donde aparezcan ya escritos, no solo uno.
- Al añadir/quitar una variable de entorno, actualiza `.env.example` y la tabla del `README.md`.
- Al tocar seguridad (CSP, cabeceras, límites por IP, captcha, auth, validación de recepción),
  documéntalo en la sección **Security first** del `README.md`.
- No publiques secretos: ni códigos de invitación concretos, ni credenciales. El código de beta se
  pide por email y no se escribe en ningún documento.
- Ejemplos de config (nginx, `.env`) nunca deben recomendar valores inseguros (`HOST=0.0.0.0`,
  `$proxy_add_x_forwarded_for`). Si aparecen, es solo para advertir de que no se usen.

## Verificación antes de dar algo por hecho

```bash
npx tsc -b          # tipos del front
npm run build       # tsc + vite build
node --check server/signal.mjs   # sintaxis del relé
```

Revisa también que la CSP generada en `dist/index.html` sea la estricta tras el build.

## No hacer

- No commitear salvo petición explícita.
- No introducir dependencias, seguimiento, cookies ni peticiones a terceros sin documentarlo y sin
  justificar el impacto en privacidad.
- No añadir base de datos, almacenamiento persistente en servidor, cookies, sesiones en servidor ni
  caché de contenido de usuario.
- No romper el modelo local-first ni mover datos de usuario al relé.
