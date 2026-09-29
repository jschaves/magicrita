import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from "./bytes";
import { ProtocolError } from "./errors";
import { isEnvelope, verifyEnvelope, type Envelope } from "./envelope";

/**
 * Sincronizacion sin conexion. Empaqueta sobres ya firmados en un texto portable
 * (`magicrita-sync:1:<base64>`) que se puede copiar o guardar en un fichero y
 * pasar a otro dispositivo a mano (QR, USB, mensajeria...). No hay servidor ni
 * red: cada sobre se reverifica al importarlo.
 */
export const SYNC_PREFIX = "magicrita-sync:1:";
export const SYNC_MAX_ENVELOPES = 4_000;
export const SYNC_MAX_CHARS = 8 * 1024 * 1024;

export function encodeSync(envelopes: readonly Envelope[]): string {
  const clean = envelopes.filter((item) => isEnvelope(item) && verifyEnvelope(item));
  if (clean.length === 0) throw new ProtocolError("sync_empty");
  const slice = clean.slice(0, SYNC_MAX_ENVELOPES);
  const payload = JSON.stringify({ v: 1, envelopes: slice });
  return SYNC_PREFIX + bytesToBase64(utf8ToBytes(payload));
}

export function decodeSync(text: string): Envelope[] {
  const value = text.trim();
  if (!value) throw new ProtocolError("sync_format");
  if (value.length > SYNC_MAX_CHARS) throw new ProtocolError("sync_too_large");
  const body = value.startsWith(SYNC_PREFIX) ? value.slice(SYNC_PREFIX.length) : value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytesToUtf8(base64ToBytes(body.replace(/\s+/g, ""))));
  } catch {
    throw new ProtocolError("sync_format");
  }
  const list = (parsed as { envelopes?: unknown }).envelopes;
  if (!Array.isArray(list) || list.length > SYNC_MAX_ENVELOPES) throw new ProtocolError("sync_format");
  const out: Envelope[] = [];
  for (const item of list) {
    if (!isEnvelope(item) || !verifyEnvelope(item)) continue;
    out.push(item);
  }
  if (out.length === 0) throw new ProtocolError("sync_empty");
  return out;
}

export function syncSummary(envelopes: readonly Envelope[]): { total: number; authors: number } {
  const authors = new Set<string>();
  for (const item of envelopes) authors.add(item.author);
  return { total: envelopes.length, authors: authors.size };
}
