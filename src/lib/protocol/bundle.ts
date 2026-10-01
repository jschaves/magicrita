import { scryptAsync } from "@noble/hashes/scrypt.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { base64ToBytes, bytesToBase64, randomBytes, utf8ToBytes } from "./bytes";
import { isEnvelope, mediaRefsOf, verifyEnvelope, type Envelope } from "./envelope";
import { ProtocolError } from "./errors";
import { loadMediaRecord, putMediaBytes, type MediaRef } from "./media";
import { saveTextFile } from "./native";
import { loadLog, mergeEnvelopes } from "./store";
import type { VaultRecord } from "./vault";

export const BUNDLE_TYPE = "magicrita-bundle";

/**
 * Tope del archivo de importacion. El bundle lleva la identidad cifrada, notas y
 * media en base64, asi que es grande, pero leer sin tope un archivo enorme
 * (o uno manipulado) agota la memoria de la pestana.
 */
export const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;

export type BundleKind = "public" | "backup";

export type BundleMedia = MediaRef & { data: string };

export type MagicRitaBundle = {
  v: 1;
  type: typeof BUNDLE_TYPE;
  kind: BundleKind;
  exportedAt: number;
  authors: string[];
  envelopes: Envelope[];
  media: BundleMedia[];
  vault?: VaultRecord;
};

/**
 * Backup cifrado con contrasena. Envuelve un `MagicRitaBundle` completo (notas,
 * media y boveda) tras cifrar su JSON con scrypt + XChaCha20-Poly1305. El
 * formato plano de arriba se sigue leyendo para no romper copias anteriores.
 */
export type EncryptedBundle = {
  v: 1;
  type: typeof BUNDLE_TYPE;
  encrypted: true;
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  nonce: string;
  data: string;
  kind: BundleKind;
  exportedAt: number;
};

export const BUNDLE_MIN_PASSWORD = 8;

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function isEncryptedBundle(value: unknown): value is EncryptedBundle {
  if (!value || typeof value !== "object") return false;
  const file = value as EncryptedBundle;
  return (
    file.v === 1 &&
    file.type === BUNDLE_TYPE &&
    file.encrypted === true &&
    typeof file.salt === "string" &&
    typeof file.nonce === "string" &&
    typeof file.data === "string"
  );
}

async function bundleKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await scryptAsync(password.normalize("NFKC"), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: 32,
  });
  return key instanceof Uint8Array ? key : Uint8Array.from(key);
}

export async function sealBundle(bundle: MagicRitaBundle, password: string): Promise<EncryptedBundle> {
  if (password.length < BUNDLE_MIN_PASSWORD) throw new ProtocolError("password_short");
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const key = await bundleKey(password, salt);
  const data = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(JSON.stringify(bundle)));
  return {
    v: 1,
    type: BUNDLE_TYPE,
    encrypted: true,
    kdf: "scrypt",
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    data: bytesToBase64(data),
    kind: bundle.kind,
    exportedAt: bundle.exportedAt,
  };
}

async function openEncryptedBundle(file: EncryptedBundle, password: string): Promise<unknown> {
  const key = await bundleKey(password, base64ToBytes(file.salt));
  const plain = xchacha20poly1305(key, base64ToBytes(file.nonce)).decrypt(base64ToBytes(file.data));
  return JSON.parse(new TextDecoder().decode(plain)) as unknown;
}

function isVaultRecord(value: unknown): value is VaultRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as VaultRecord;
  return (
    record.v === 1 &&
    typeof record.rpub === "string" &&
    typeof record.salt === "string" &&
    typeof record.nonce === "string" &&
    typeof record.ciphertext === "string"
  );
}

export function isBundle(value: unknown): value is MagicRitaBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as MagicRitaBundle;
  return (
    bundle.v === 1 &&
    bundle.type === BUNDLE_TYPE &&
    (bundle.kind === "public" || bundle.kind === "backup") &&
    Array.isArray(bundle.envelopes) &&
    Array.isArray(bundle.media)
  );
}

export async function buildBundle(opts: {
  kind: BundleKind;
  rpubs: string[];
  vault?: VaultRecord;
}): Promise<MagicRitaBundle> {
  const envelopes: Envelope[] = [];
  for (const rpub of opts.rpubs) {
    const log = loadLog(rpub);
    const subset =
      opts.kind === "public" ? log.filter((item) => item.type === "profile" || item.type === "post") : log;
    envelopes.push(...subset);
  }
  const seen = new Set<string>();
  const media: BundleMedia[] = [];
  for (const envelope of envelopes) {
    for (const ref of mediaRefsOf(envelope)) {
      if (seen.has(ref.hash)) continue;
      seen.add(ref.hash);
      const record = await loadMediaRecord(ref.hash);
      if (!record) continue;
      media.push({
        ...ref,
        data: bytesToBase64(new Uint8Array(record.bytes)),
      });
    }
  }
  return {
    v: 1,
    type: BUNDLE_TYPE,
    kind: opts.kind,
    exportedAt: Date.now(),
    authors: opts.rpubs,
    envelopes,
    media,
    vault: opts.kind === "backup" ? opts.vault : undefined,
  };
}

export async function applyBundle(bundle: MagicRitaBundle): Promise<string[]> {
  if (!isBundle(bundle)) throw new ProtocolError("invalid_bundle");
  for (const envelope of bundle.envelopes) {
    if (!isEnvelope(envelope) || !verifyEnvelope(envelope)) {
      throw new ProtocolError("invalid_envelope");
    }
  }
  for (const item of bundle.media) {
    if (typeof item.data !== "string") throw new ProtocolError("invalid_bundle");
    await putMediaBytes(item, base64ToBytes(item.data));
  }
  return mergeEnvelopes(bundle.envelopes);
}

export async function parseBundle(text: string, password?: string): Promise<MagicRitaBundle> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProtocolError("invalid_bundle");
  }
  if (isEncryptedBundle(parsed)) {
    if (!password) throw new ProtocolError("bundle_password");
    let plain: unknown;
    try {
      plain = await openEncryptedBundle(parsed, password);
    } catch {
      throw new ProtocolError("bundle_wrong_password");
    }
    parsed = plain;
  }
  if (!isBundle(parsed)) throw new ProtocolError("invalid_bundle");
  if (parsed.vault && !isVaultRecord(parsed.vault)) throw new ProtocolError("invalid_bundle");
  return parsed;
}

export async function downloadBundle(
  bundle: MagicRitaBundle | EncryptedBundle,
  filename: string,
): Promise<void> {
  await saveTextFile(filename, JSON.stringify(bundle), "application/json");
}
