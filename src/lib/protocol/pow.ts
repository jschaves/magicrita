import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "./bytes";

export const POW_BITS = 16;
export const POW_PREFIX = "rita-pow-v1";

export function powDigest(rpub: string, nonce: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${POW_PREFIX}:${rpub}:${nonce}`)));
}

export function powValid(rpub: string, nonce: string, bits = POW_BITS): boolean {
  if (!rpub || typeof nonce !== "string" || nonce.length === 0 || nonce.length > 32) return false;
  const hex = powDigest(rpub, nonce);
  const nibbles = Math.floor(bits / 4);
  const rem = bits % 4;
  if (!hex.startsWith("0".repeat(nibbles))) return false;
  if (rem === 0) return true;
  const nibble = Number.parseInt(hex[nibbles] ?? "f", 16);
  return nibble >> (4 - rem) === 0;
}

export async function minePow(rpub: string, bits = POW_BITS): Promise<string> {
  let n = 0;
  while (true) {
    const nonce = n.toString(36);
    if (powValid(rpub, nonce, bits)) return nonce;
    n += 1;
    if (n % 400 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

export async function cachedPow(rpub: string): Promise<string> {
  const key = `magicrita.pow.${rpub}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored && powValid(rpub, stored)) return stored;
  } catch {
    // ignore
  }
  const nonce = await minePow(rpub);
  try {
    sessionStorage.setItem(key, nonce);
  } catch {
    // ignore
  }
  return nonce;
}
