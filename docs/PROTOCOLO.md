# Protocolo MagicRita

Red propia. No usamos Nostr, ActivityPub, Farcaster ni ningún grafo social de terceros.
Las librerías `@noble/*` son solo matemáticas (firmas y cifrado), no una red.

## Cómo se construye (pasos)

1. **Identidad y log local** — hecho  
   Cada persona genera un par Ed25519. Todo lo que publica es un *sobre* firmado y se guarda en este dispositivo.
2. **Llevar tus datos a otro entorno** — hecho  
   Exportas un archivo con tu identidad cifrada, notas y fotos, y lo importas en otro navegador o dispositivo. Es tu copia, no la sesión de otra persona.
3. **Relé propio** — hecho  
   Señalización WebRTC, lista de conectados y buzón en RAM. No guarda notas ni claves. El intercambio en vivo va entre navegadores.
4. **Chat** — hecho  
   Se pide chat a cualquiera; el receptor acepta. Cualquiera puede revocar o bloquear. El texto va cifrado (X25519 + XChaCha20) en un sobre firmado; el relé no lo lee.
5. **Fotos** — hecho  
   Hash SHA-256 en el sobre, una foto por nota, viaja entre pares y en el archivo portable. No se ampliará el tratamiento de imágenes.

## Paso 1 — formato

Identidad:

- `rpub_` + 64 hex — clave pública (tu ID)
- `rsec_` + 64 hex — clave secreta (si se pierde, se pierde la identidad)

Sobre firmado:

```json
{
  "v": 1,
  "type": "profile" | "post" | "follows",
  "author": "rpub_…",
  "ts": 1730000000000,
  "body": {},
  "sig": "<hex Ed25519>"
}
```

Se firma el JSON canónico de `v`, `type`, `author`, `ts` y `body` (sin `sig`).

## Paso 2 — archivo

Paquete `magicrita-bundle`:

- `kind: "backup"` — tu identidad cifrada, notas y fotos, para continuar en otro entorno.

Al importar se verifica cada firma Ed25519 y el hash SHA-256 de cada foto.

No hay servidor de cuentas ni de contenidos.

## Antispam (sin disco en el relé)

- Cada `hello` al relé lleva una prueba de trabajo SHA-256 (`rita-pow-v1:rpub:nonce`). El relé la comprueba en RAM y corta IPs o claves que disparan.
- Sobre `invite`: alguien de tu red firma un vale de 7 días hacia una `rpub`. Quien te sigue deja de poner en cuarentena a esa persona. No hay lista de invitaciones en el servidor.
- Cuentas jóvenes (menos de 12 h y sin seguimiento ni invitación) no entran en el inicio. Con 3 denuncias se ocultan; las demás, a las 10.
- Como máximo dos enlaces por nota o comentario. El mismo texto repetido se descarta.
