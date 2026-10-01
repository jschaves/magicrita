import { scryptAsync } from "@noble/hashes/scrypt.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, bytesToUtf8, hexToBytes, randomBytes, utf8ToBytes } from "./bytes";
import { ProtocolError } from "./errors";
import { loadBetaInvite, saveBetaInvite } from "./betaInvite";
import { fromSecret, type Identity } from "./identity";
import { restKeyFromHex } from "./rest";

const VAULT_KEY = "magicrita.vault";
/**
 * Marca del contenido cifrado de la boveda. La v1 cifraba los 32 bytes del
 * `rsec` a pelo; la v2 guarda tambien la clave de cifrado en reposo. El prefijo
 * permite leer bovedas antiguas (32 bytes sin marca) sin romper nada.
 */
const VAULT_TAG = "magicrita-vault:2:";

export type VaultRecord = {
  v: 1;
  rpub: string;
  salt: string;
  nonce: string;
  ciphertext: string;
  invite?: string;
};

/** Resultado de abrir la boveda: la identidad y la clave de reposo (si la hay). */
export type UnlockedVault = {
  identity: Identity;
  restKey: Uint8Array | null;
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

/**
 * Quita el código de invitación guardado dentro de la bóveda. Se usa cuando el
 * relé lo rechaza (borrado o deshabilitado): como `loadVault` reinyecta ese
 * código en `localStorage`, si no se borra de aquí el código inválido vuelve una
 * y otra vez.
 */
export function clearVaultInvite(): void {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as VaultRecord;
    if (!parsed || !parsed.invite) return;
    delete parsed.invite;
    localStorage.setItem(VAULT_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

export async function wrapSecret(
  identity: Identity,
  password: string,
  restKey: Uint8Array | null,
): Promise<VaultRecord> {
  if (password.length < 8) {
    throw new ProtocolError("password_short");
  }
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const key = await deriveKey(password, salt);
  const cipher = xchacha20poly1305(key, nonce);
  const plain = restKey
    ? utf8ToBytes(`${VAULT_TAG}${bytesToHex(identity.secret)}:${bytesToHex(restKey)}`)
    : identity.secret;
  const ciphertext = cipher.encrypt(plain);
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

export async function unwrapVault(record: VaultRecord, password: string): Promise<UnlockedVault> {
  const salt = hexToBytes(record.salt);
  const nonce = hexToBytes(record.nonce);
  const ciphertext = hexToBytes(record.ciphertext);
  const key = await deriveKey(password, salt);
  const cipher = xchacha20poly1305(key, nonce);
  try {
    const plain = cipher.decrypt(ciphertext);
    const text = bytesToUtf8(plain);
    if (text.startsWith(VAULT_TAG)) {
      const rest = text.slice(VAULT_TAG.length);
      const sep = rest.indexOf(":");
      const secretHex = sep >= 0 ? rest.slice(0, sep) : "";
      const restHex = sep >= 0 ? rest.slice(sep + 1) : "";
      const identity = fromSecret(hexToBytes(secretHex));
      if (identity.rpub !== record.rpub) {
        throw new ProtocolError("vault_mismatch");
      }
      return { identity, restKey: restKeyFromHex(restHex) };
    }
    // Boveda antigua: solo el `rsec`, sin clave de reposo.
    const identity = fromSecret(plain);
    if (identity.rpub !== record.rpub) {
      throw new ProtocolError("vault_mismatch");
    }
    return { identity, restKey: null };
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("wrong_password");
  }
}

/**
 * Sustituir la bóveda guardada destruye la identidad anterior, asi que tiene que
 * probarse la contraseña de la que se va. Antes esta comprobación solo vivia en
 * el `Navigate` de las pantallas, asi que bastaba una llamada directa para
 * borrar una identidad sin saber su contraseña. `backup_conflict` ya está
 * traducida en todos los idiomas y dice justo eso.
 */
export async function assertVaultOwnership(password?: string): Promise<void> {
  const record = loadVault();
  if (!record) return;
  if (!password) throw new ProtocolError("backup_conflict");
  await unwrapVault(record, password);
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
