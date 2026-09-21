# Protocolo MagicRita

Red propia. No usamos Nostr, ActivityPub, Farcaster ni ningún grafo social de terceros.
Las librerías `@noble/*` son solo matemáticas (firmas y cifrado), no una red.

## Cómo se construye (pasos)

1. **Identidad y log local** — hecho  
   Cada persona genera un par Ed25519. Todo lo que publica es un *sobre* firmado y se guarda en este dispositivo.
2. **Llevar tus datos a otro entorno** — este paso  
   Exportas un archivo con tu identidad cifrada, notas y fotos, y lo importas en otro navegador o dispositivo. Es tu copia, no la sesión de otra persona.
3. **Intercambio directo** — más adelante se puede añadir envío P2P; el formato de archivo ya es el paquete.
4. **Chat** — mensajes cifrados de extremo a extremo sobre el mismo sobre.
5. **Media** — fotos con hash SHA-256 en el sobre; el archivo viaja en el JSON al exportar.

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
