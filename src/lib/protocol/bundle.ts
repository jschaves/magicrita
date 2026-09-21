import { base64ToBytes, bytesToBase64 } from "./bytes";
import { isEnvelope, mediaRefsOf, verifyEnvelope, type Envelope } from "./envelope";
import { ProtocolError } from "./errors";
import { loadMediaRecord, putMediaBytes, type MediaRef } from "./media";
import { loadLog, mergeEnvelopes } from "./store";
import type { VaultRecord } from "./vault";

export const BUNDLE_TYPE = "magicrita-bundle";

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

export function parseBundle(text: string): MagicRitaBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProtocolError("invalid_bundle");
  }
  if (!isBundle(parsed)) throw new ProtocolError("invalid_bundle");
  if (parsed.vault && !isVaultRecord(parsed.vault)) throw new ProtocolError("invalid_bundle");
  return parsed;
}

export function downloadBundle(bundle: MagicRitaBundle, filename: string): void {
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
