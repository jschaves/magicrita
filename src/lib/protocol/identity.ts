import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "./bytes";
import { ProtocolError } from "./errors";

export const RPUB_PREFIX = "rpub_";
export const RSEC_PREFIX = "rsec_";

export type Identity = {
  secret: Uint8Array;
  publicKey: Uint8Array;
  rpub: string;
  rsec: string;
};

export function createIdentity(): Identity {
  const secret = ed25519.utils.randomSecretKey();
  return fromSecret(secret);
}

export function fromSecret(secret: Uint8Array): Identity {
  if (secret.length !== 32) {
    throw new ProtocolError("secret_length");
  }
  const publicKey = ed25519.getPublicKey(secret);
  return {
    secret,
    publicKey,
    rpub: encodeRpub(publicKey),
    rsec: encodeRsec(secret),
  };
}

export function encodeRpub(publicKey: Uint8Array): string {
  return RPUB_PREFIX + bytesToHex(publicKey);
}

export function encodeRsec(secret: Uint8Array): string {
  return RSEC_PREFIX + bytesToHex(secret);
}

export function parseRpub(input: string): Uint8Array {
  const value = input.trim();
  if (!value.startsWith(RPUB_PREFIX)) {
    throw new ProtocolError("rpub_prefix");
  }
  const hex = value.slice(RPUB_PREFIX.length);
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) {
    throw new ProtocolError("rpub_invalid");
  }
  return bytes;
}

export function parseSecretInput(input: string): Uint8Array {
  const value = input.trim();
  if (!value) {
    throw new ProtocolError("rsec_empty");
  }
  if (value.startsWith(RSEC_PREFIX)) {
    const bytes = hexToBytes(value.slice(RSEC_PREFIX.length));
    if (bytes.length !== 32) {
      throw new ProtocolError("rsec_invalid");
    }
    return bytes;
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return hexToBytes(value);
  }
  throw new ProtocolError("rsec_format");
}

export function shortenId(id: string): string {
  if (id.length < 18) return id;
  return `${id.slice(0, 12)}…${id.slice(-4)}`;
}

export function signBytes(secret: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, secret);
}

export function verifyBytes(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return ed25519.verify(signature, message, publicKey);
}
