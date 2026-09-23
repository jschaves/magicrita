import { scryptAsync } from "@noble/hashes/scrypt.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes, randomBytes } from "./bytes";
import { ProtocolError } from "./errors";
import { loadBetaInvite, saveBetaInvite } from "./betaInvite";
import { fromSecret, type Identity } from "./identity";

const VAULT_KEY = "magicrita.vault";

export type VaultRecord = {
  v: 1;
  rpub: string;
  salt: string;
  nonce: string;
  ciphertext: string;
  invite?: string;
};

export function loadVault(): VaultRecord | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultRecord;
    if (parsed.v !== 1 || !parsed.rpub || !parsed.ciphertext) return null;
    if (parsed.invite) saveBetaInvite(parsed.invite);
    return parsed;
  } catch {
    return null;
  }
}

export function saveVault(record: VaultRecord): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(record));
}

export function clearVault(): void {
  localStorage.removeItem(VAULT_KEY);
}

export async function wrapSecret(identity: Identity, password: string): Promise<VaultRecord> {
  if (password.length < 8) {
    throw new ProtocolError("password_short");
  }
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const key = await deriveKey(password, salt);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(identity.secret);
  const invite = loadBetaInvite();
  const record: VaultRecord = {
    v: 1,
    rpub: identity.rpub,
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
    ...(invite ? { invite } : {}),
  };
  saveVault(record);
  return record;
}

export async function unwrapVault(record: VaultRecord, password: string): Promise<Identity> {
  const salt = hexToBytes(record.salt);
  const nonce = hexToBytes(record.nonce);
  const ciphertext = hexToBytes(record.ciphertext);
  const key = await deriveKey(password, salt);
  const cipher = xchacha20poly1305(key, nonce);
  try {
    const secret = cipher.decrypt(ciphertext);
    const identity = fromSecret(secret);
    if (identity.rpub !== record.rpub) {
      throw new ProtocolError("vault_mismatch");
    }
    return identity;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("wrong_password");
  }
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await scryptAsync(password.normalize("NFKC"), salt, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    dkLen: 32,
  });
  return key instanceof Uint8Array ? key : Uint8Array.from(key);
}
