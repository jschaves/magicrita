import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes, utf8ToBytes } from "./bytes";

/**
 * Verificacion del navegador para desbloquear la identidad.
 *
 * El login de admin pide el reto al relay y lo valida alli. Al desbloquear no
 * hay servidor de por medio: la boveda es local, asi que el reto se genera y se
 * comprueba en este mismo dispositivo. No es una frontera de seguridad (quien
 * controle el cliente puede saltarsela), es un peaje de CPU: encarece cada
 * intento de contrasena igual que el hash scrypt que ya lleva la boveda.
 */
export const BROWSER_CHECK_PREFIX = "rita-browser-v1";
export const BROWSER_CHECK_BITS = 18;

/** Se cede el hilo cada tanto para no clavar la pestana. */
const YIELD_EVERY = 4096;

export type BrowserChallenge = { nonce: string; bits: number };
export type BrowserCheck = BrowserChallenge & { counter: string };

function zeroBits(hex: string, bits: number): boolean {
  const nibbles = Math.floor(bits / 4);
  const rem = bits % 4;
  if (!hex.startsWith("0".repeat(nibbles))) return false;
  if (rem === 0) return true;
  return (Number.parseInt(hex[nibbles] ?? "f", 16) >> (4 - rem)) === 0;
}

export function browserPowOk(nonce: string, counter: string, bits: number): boolean {
  if (!nonce || !counter) return false;
  const digest = bytesToHex(sha256(utf8ToBytes(`${BROWSER_CHECK_PREFIX}:${nonce}:${counter}`)));
  return zeroBits(digest, bits);
}

export function browserCheckValid(check: BrowserCheck | null): boolean {
  if (!check || check.bits !== BROWSER_CHECK_BITS) return false;
  if (!/^[0-9a-z]{1,10}$/.test(check.counter)) return false;
  return browserPowOk(check.nonce, check.counter, check.bits);
}

export function issueBrowserCheck(): BrowserChallenge {
  return { nonce: bytesToHex(randomBytes(16)), bits: BROWSER_CHECK_BITS };
}

export async function solveBrowserCheck(
  challenge: BrowserChallenge,
  onProgress?: (attempts: number) => void,
): Promise<BrowserCheck> {
  let n = 0;
  for (;;) {
    const counter = n.toString(36);
    if (browserPowOk(challenge.nonce, counter, challenge.bits)) {
      return { ...challenge, counter };
    }
    n += 1;
    if (n % YIELD_EVERY === 0) {
      onProgress?.(n);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
}
