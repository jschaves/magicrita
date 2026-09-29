import { scryptAsync } from "@noble/hashes/scrypt.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from "./bytes";
import { ProtocolError } from "./errors";
import {
  isEnvelope,
  signRecoveryShare,
  verifyEnvelope,
  type Envelope,
  type RecoveryShareBody,
} from "./envelope";
import { fromSecret, type Identity } from "./identity";
import { combine, split } from "./shamir";

/**
 * Recuperacion social de la identidad. Al configurarla, el `rsec` se divide con
 * Shamir (M-de-N) y cada participacion se cifra con una clave derivada de la
 * **contraseña de recuperacion** del dueño. Cada participacion viaja como sobre
 * firmado al dispositivo de un guardian, que solo guarda un blob que no puede
 * leer. Para recuperar, se juntan M participaciones (a mano o por P2P) y la
 * contraseña; nunca hace falta un servidor.
 */
export const RECOVERY_SHARE_PREFIX = "magicrita-recovery:1:";
export const RECOVERY_MIN_THRESHOLD = 2;
export const RECOVERY_MAX_GUARDIANS = 7;
export const RECOVERY_MIN_PASSWORD = 10;

export type RecoveryOptions = {
  password: string;
  guardians: string[];
  threshold: number;
  generation?: number;
};

export type RecoveryShareEnvelope = Extract<Envelope, { type: "recovery_share" }>;

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await scryptAsync(password.normalize("NFKC"), salt, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    dkLen: 32,
  });
  return key instanceof Uint8Array ? key : Uint8Array.from(key);
}

export async function createRecoveryShares(
  identity: Identity,
  options: RecoveryOptions,
): Promise<RecoveryShareEnvelope[]> {
  const guardians = [...new Set(options.guardians.filter((rpub) => rpub && rpub !== identity.rpub))];
  const total = guardians.length;
  if (total < RECOVERY_MIN_THRESHOLD) throw new ProtocolError("recovery_guardians");
  if (total > RECOVERY_MAX_GUARDIANS) throw new ProtocolError("recovery_too_many");
  const threshold = Math.floor(options.threshold);
  if (threshold < RECOVERY_MIN_THRESHOLD || threshold > total) {
    throw new ProtocolError("recovery_threshold");
  }
  if (options.password.length < RECOVERY_MIN_PASSWORD) throw new ProtocolError("recovery_password");

  const generation = options.generation ?? 1;
  const salt = randomBytes(16);
  const key = await deriveKey(options.password, salt);
  const shares = split(identity.secret, total, threshold);
  const id = `${identity.rpub.slice(-12)}-${generation}`;
  const envelopes: RecoveryShareEnvelope[] = [];
  for (let i = 0; i < total; i += 1) {
    const share = shares[i]!;
    const nonce = randomBytes(24);
    const box = xchacha20poly1305(key, nonce).encrypt(share.y);
    const body: RecoveryShareBody = {
      to: guardians[i]!,
      owner: identity.rpub,
      id,
      index: share.x,
      total,
      threshold,
      generation,
      salt: bytesToHex(salt),
      n: bytesToHex(nonce),
      box: bytesToHex(box),
    };
    envelopes.push(signRecoveryShare(identity, body) as RecoveryShareEnvelope);
  }
  return envelopes;
}

/** Participaciones que este dispositivo guarda para otros (soy su guardian). */
export function guardianShares(log: readonly Envelope[], me: string): RecoveryShareEnvelope[] {
  return log.filter(
    (env): env is RecoveryShareEnvelope =>
      env.type === "recovery_share" && env.body.to === me && verifyEnvelope(env),
  );
}

export function shareToText(envelope: RecoveryShareEnvelope): string {
  return RECOVERY_SHARE_PREFIX + bytesToBase64(utf8ToBytes(JSON.stringify(envelope)));
}

export function parseShareText(text: string): RecoveryShareEnvelope {
  const value = text.trim();
  if (!value) throw new ProtocolError("recovery_share_format");
  const body = value.startsWith(RECOVERY_SHARE_PREFIX) ? value.slice(RECOVERY_SHARE_PREFIX.length) : value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytesToUtf8(base64ToBytes(body.replace(/\s+/g, ""))));
  } catch {
    throw new ProtocolError("recovery_share_format");
  }
  if (!isEnvelope(parsed) || parsed.type !== "recovery_share" || !verifyEnvelope(parsed)) {
    throw new ProtocolError("recovery_share_format");
  }
  return parsed;
}

export async function recombineShares(
  envelopes: readonly RecoveryShareEnvelope[],
  password: string,
): Promise<Identity> {
  if (envelopes.length === 0) throw new ProtocolError("recovery_need_shares");
  const owner = envelopes[0]!.body.owner;
  const salt = envelopes[0]!.body.salt;
  const threshold = envelopes[0]!.body.threshold;
  if (
    envelopes.some(
      (env) =>
        env.body.owner !== owner ||
        env.body.salt !== salt ||
        env.body.threshold !== threshold ||
        !verifyEnvelope(env),
    )
  ) {
    throw new ProtocolError("recovery_mismatch");
  }
  const key = await deriveKey(password, hexToBytes(salt));
  const parts: { x: number; y: Uint8Array }[] = [];
  const seen = new Set<number>();
  for (const env of envelopes) {
    const share = env.body;
    if (seen.has(share.index)) continue;
    seen.add(share.index);
    try {
      const y = xchacha20poly1305(key, hexToBytes(share.n)).decrypt(hexToBytes(share.box));
      parts.push({ x: share.index, y });
    } catch {
      throw new ProtocolError("recovery_wrong_password");
    }
  }
  if (parts.length < threshold) throw new ProtocolError("recovery_need_shares");
  const secret = combine(parts);
  const identity = fromSecret(secret);
  if (identity.rpub !== owner) throw new ProtocolError("recovery_wrong_password");
  return identity;
}
