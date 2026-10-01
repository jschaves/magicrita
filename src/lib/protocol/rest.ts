import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, randomBytes } from "./bytes";

/**
 * Cifrado en reposo. Un unico `restKey` de 32 bytes por identidad protege lo que
 * vive en el dispositivo: los logs de `localStorage` y los bytes de media en
 * `IndexedDB`. La clave NUNCA se guarda en claro: va dentro de la boveda
 * (cifrada con la contrasena) y, para la sesion recordada, dentro del registro
 * AES-GCM de `sessionPersist`.
 *
 * Sin `restKey` (antes de desbloquear, o en una boveda antigua) el almacen se
 * trata como texto plano: se lee lo legado y se escribe cifrado en cuanto haya
 * clave. Los valores cifrados llevan un prefijo reconocible, asi que un valor
 * plano jamas se confunde con uno cifrado.
 */
const STRING_PREFIX = "mrest1:";
/** "MRB1": ningun formato de imagen/audio/video empieza por estos bytes. */
const BYTES_MAGIC = new Uint8Array([0x4d, 0x52, 0x42, 0x31]);
const NONCE_BYTES = 24;

let restKey: Uint8Array | null = null;

export function setRestKey(key: Uint8Array | null): void {
  restKey = key;
}

export function hasRestKey(): boolean {
  return restKey !== null;
}

export function restKeyBytes(): Uint8Array | null {
  return restKey;
}

export function newRestKey(): Uint8Array {
  return randomBytes(32);
}

export function restKeyToHex(): string | null {
  return restKey ? bytesToHex(restKey) : null;
}

export function restKeyFromHex(hex: string | null | undefined): Uint8Array | null {
  if (!hex) return null;
  try {
    const bytes = hexToBytes(hex);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

export function isSealedString(value: string): boolean {
  return value.startsWith(STRING_PREFIX);
}

export function sealString(plain: string): string {
  if (!restKey) return plain;
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(restKey, nonce).encrypt(new TextEncoder().encode(plain));
  return `${STRING_PREFIX}${bytesToBase64(nonce)}:${bytesToBase64(ciphertext)}`;
}

/** Devuelve el texto plano, tal cual si no estaba cifrado, o `null` si falta la clave. */
export function openString(stored: string): string | null {
  if (!isSealedString(stored)) return stored;
  if (!restKey) return null;
  try {
    const body = stored.slice(STRING_PREFIX.length);
    const sep = body.indexOf(":");
    if (sep <= 0) return null;
    const nonce = base64ToBytes(body.slice(0, sep));
    const ciphertext = base64ToBytes(body.slice(sep + 1));
    return new TextDecoder().decode(xchacha20poly1305(restKey, nonce).decrypt(ciphertext));
  } catch {
    return null;
  }
}

export function isSealedBytes(bytes: Uint8Array): boolean {
  if (bytes.length <= BYTES_MAGIC.length) return false;
  for (let i = 0; i < BYTES_MAGIC.length; i += 1) {
    if (bytes[i] !== BYTES_MAGIC[i]) return false;
  }
  return true;
}

export function sealBytes(plain: Uint8Array): Uint8Array {
  if (!restKey) return plain;
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(restKey, nonce).encrypt(plain);
  const out = new Uint8Array(BYTES_MAGIC.length + NONCE_BYTES + ciphertext.length);
  out.set(BYTES_MAGIC, 0);
  out.set(nonce, BYTES_MAGIC.length);
  out.set(ciphertext, BYTES_MAGIC.length + NONCE_BYTES);
  return out;
}

/** Devuelve los bytes planos, tal cual si no estaban cifrados, o `null` si falta la clave. */
export function openBytes(stored: Uint8Array): Uint8Array | null {
  if (!isSealedBytes(stored)) return stored;
  if (!restKey) return null;
  try {
    const nonce = stored.subarray(BYTES_MAGIC.length, BYTES_MAGIC.length + NONCE_BYTES);
    const ciphertext = stored.subarray(BYTES_MAGIC.length + NONCE_BYTES);
    return xchacha20poly1305(restKey, nonce).decrypt(ciphertext);
  } catch {
    return null;
  }
}
