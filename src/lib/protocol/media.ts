import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "./bytes";
import { ProtocolError } from "./errors";

export const MAX_PHOTOS = 1;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_VOICE_BYTES = 500_000;
export const MAX_VOICE_MS = 30_000;
export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type MediaRef = {
  hash: string;
  mime: string;
  name: string;
  preview?: string;
};

type MediaRecord = {
  hash: string;
  mime: string;
  bytes: ArrayBuffer;
};

type RamBlob = { mime: string; bytes: Uint8Array };
const ram = new Map<string, RamBlob>();
const previews = new Map<string, string>();
const liveUrls = new Map<string, string>();
const PREVIEW_MAX_CHARS = 48_000;

export type PhotoTier = "lq" | "mq" | "hq";

export function mqKey(hash: string): string {
  return `${hash}:mq`;
}

type MediaListener = (hash: string) => void;
const mediaListeners = new Set<MediaListener>();

export function onMediaStored(listener: MediaListener): () => void {
  mediaListeners.add(listener);
  return () => {
    mediaListeners.delete(listener);
  };
}

export function notifyMedia(hash: string): void {
  for (const listener of mediaListeners) listener(hash);
}

export function rememberPreview(hash: string, preview?: string): void {
  if (hash && preview && preview.startsWith("data:image/") && preview.length > 32) {
    previews.set(hash, preview);
  }
}

export function loadPreview(hash: string): string | undefined {
  return previews.get(hash);
}

export function livePhotoUrl(hash: string): string | undefined {
  return liveUrls.get(hash);
}

export function rememberLiveUrl(hash: string, url: string): void {
  liveUrls.set(hash, url);
}

export function forgetLiveUrl(hash: string): void {
  liveUrls.delete(hash);
}

function rememberBytes(hash: string, mime: string, bytes: Uint8Array): void {
  ram.set(hash, { mime, bytes: bytes.slice() });
}

function tightBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function blobFromBytes(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: mime || "image/jpeg" });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img"));
    img.src = url;
  });
}

function drawToCanvas(image: HTMLImageElement, max: number): HTMLCanvasElement | null {
  const scale = Math.min(1, max / Math.max(image.width, image.height, 1));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

function drawPreview(image: HTMLImageElement, max: number, quality: number): string {
  const canvas = drawToCanvas(image, max);
  if (!canvas) return "";
  return canvas.toDataURL("image/jpeg", quality);
}

async function jpegFromImage(image: HTMLImageElement, max: number, quality: number): Promise<Uint8Array> {
  const canvas = drawToCanvas(image, max);
  if (!canvas) throw new Error("canvas");
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("jpeg"))), "image/jpeg", quality);
  });
  const buffer = await blob.arrayBuffer();
  const out = new Uint8Array(buffer.byteLength);
  out.set(new Uint8Array(buffer));
  return out;
}

export async function makePreviewDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  const url = URL.createObjectURL(blobFromBytes(bytes, mime));
  try {
    const image = await loadImage(url);
    const sizes = [720, 560, 420, 280];
    const qualities = [0.7, 0.58, 0.46, 0.34];
    for (const size of sizes) {
      for (const quality of qualities) {
        const data = drawPreview(image, size, quality);
        if (data.startsWith("data:image/") && data.length <= PREVIEW_MAX_CHARS) return data;
      }
    }
    return drawPreview(image, 240, 0.32);
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function putRecord(hash: string, mime: string, bytes: Uint8Array): Promise<void> {
  rememberBytes(hash, mime, bytes);
  const record: MediaRecord = { hash, mime, bytes: tightBuffer(bytes) };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb"));
    tx.objectStore(STORE).put(record);
  });
  db.close();
}

const DB_NAME = "magicrita-media";
const STORE = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "hash" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb"));
  });
}

export function isAcceptedPhoto(file: File): boolean {
  return (ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type);
}

export function isCompleteImage(bytes: Uint8Array, mime = ""): boolean {
  if (bytes.length < 256) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const from = Math.max(0, bytes.length - 2048);
    for (let i = from; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
    }
    return bytes.length > 16 * 1024;
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return bytes.length > 256;
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return bytes.length > 256;
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return bytes.length > 256;
  return mime.startsWith("image/") && bytes.length > 1024;
}

export function stripBlobText(text: string): string {
  return text
    .replace(/blob:[^\s]+/gi, "")
    .replace(/data:image\/[^\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ingestPhoto(file: File): Promise<MediaRef> {
  if (!isAcceptedPhoto(file)) {
    throw new ProtocolError("media_type");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new ProtocolError("media_too_large");
  }
  const original = new Uint8Array(await file.arrayBuffer());
  const sourceUrl = URL.createObjectURL(blobFromBytes(original, file.type));
  const hq = original;
  const mime = file.type;
  let mq: Uint8Array | null = null;
  let preview = "";
  try {
    const image = await loadImage(sourceUrl);
    mq = await jpegFromImage(image, 1920, 0.92);
    const steps: Array<[number, number]> = [
      [720, 0.68],
      [560, 0.58],
      [420, 0.5],
      [320, 0.42],
      [240, 0.36],
      [160, 0.3],
      [96, 0.26],
    ];
    preview = "";
    for (const [size, quality] of steps) {
      const data = drawPreview(image, size, quality);
      if (data.startsWith("data:image/") && data.length <= 6_000) {
        preview = data;
        break;
      }
    }
    if (!preview) preview = drawPreview(image, 80, 0.22);
  } catch {
    preview = await makePreviewDataUrl(original, file.type);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
  const hash = bytesToHex(sha256(hq));
  rememberPreview(hash, preview);
  rememberLiveUrl(hash, URL.createObjectURL(file));
  await putRecord(hash, mime, hq);
  if (mq) await putRecord(mqKey(hash), "image/jpeg", mq);
  notifyMedia(hash);
  const ref: MediaRef = { hash, mime, name: file.name };
  if (preview) ref.preview = preview;
  return ref;
}

export async function ingestVoice(blob: Blob): Promise<MediaRef> {
  if (blob.size > MAX_VOICE_BYTES) throw new ProtocolError("media_too_large");
  const rawType = (blob.type || "audio/webm").split(";")[0];
  const mime = rawType.startsWith("audio/") ? rawType : "audio/webm";
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength < 16) throw new ProtocolError("media_type");
  const hash = bytesToHex(sha256(bytes));
  await putRecord(hash, mime, bytes);
  rememberLiveUrl(hash, URL.createObjectURL(blob));
  notifyMedia(hash);
  return { hash, mime, name: "voice" };
}

export async function loadMediaRecord(hash: string): Promise<MediaRecord | null> {
  const hit = ram.get(hash);
  if (hit) {
    return { hash, mime: hit.mime, bytes: tightBuffer(hit.bytes) };
  }
  const db = await openDb();
  const record = await new Promise<MediaRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(hash);
    request.onsuccess = () => resolve(request.result as MediaRecord | undefined);
    request.onerror = () => reject(request.error ?? new Error("indexeddb"));
  });
  db.close();
  if (!record?.bytes) return null;
  rememberBytes(hash, record.mime, new Uint8Array(record.bytes));
  return record;
}

export async function putMediaBytes(ref: MediaRef, bytes: Uint8Array): Promise<void> {
  const hash = bytesToHex(sha256(bytes));
  if (hash !== ref.hash) {
    throw new ProtocolError("media_hash");
  }
  if (ref.preview) rememberPreview(hash, ref.preview);
  await putRecord(hash, ref.mime, bytes);
  rememberLiveUrl(hash, URL.createObjectURL(blobFromBytes(bytes, ref.mime)));
  notifyMedia(hash);
}

export async function putMediaTier(hash: string, tier: "mq" | "hq", mime: string, bytes: Uint8Array): Promise<void> {
  if (tier === "hq") {
    await putMediaBytes({ hash, mime, name: hash }, bytes);
    return;
  }
  await putRecord(mqKey(hash), mime || "image/jpeg", bytes);
  rememberLiveUrl(hash, URL.createObjectURL(blobFromBytes(bytes, mime || "image/jpeg")));
  notifyMedia(hash);
}

export function peekRamPhotoUrl(hash: string): string | null {
  const live = liveUrls.get(hash);
  if (live) return live;
  const hit = ram.get(hash) ?? ram.get(mqKey(hash));
  if (!hit || hit.bytes.byteLength < 32) return null;
  const url = URL.createObjectURL(blobFromBytes(hit.bytes, hit.mime));
  rememberLiveUrl(hash, url);
  return url;
}

export async function ensurePhotoSrc(hash: string, fresh = false): Promise<string | null> {
  if (!fresh) {
    const existing = livePhotoUrl(hash);
    if (existing) return existing;
  }
  const rec = (await loadMediaRecord(hash)) ?? (await loadMediaRecord(mqKey(hash)));
  if (!rec?.bytes) return null;
  const url = URL.createObjectURL(blobFromBytes(new Uint8Array(rec.bytes), rec.mime || "image/jpeg"));
  liveUrls.set(hash, url);
  return url;
}

export async function loadPhotoUrl(hash: string): Promise<string | null> {
  const hit = ram.get(hash);
  if (hit) return URL.createObjectURL(blobFromBytes(hit.bytes, hit.mime));
  const record = await loadMediaRecord(hash);
  if (!record) return null;
  return URL.createObjectURL(blobFromBytes(new Uint8Array(record.bytes), record.mime));
}

export async function avatarThumb(hash: string): Promise<string | null> {
  const url = await loadPhotoUrl(hash);
  if (!url) return null;
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("img"));
      img.src = url;
    });
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas.toDataURL("image/jpeg", 0.72);
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function clearAllPhotos(): Promise<void> {
  ram.clear();
  previews.clear();
  for (const url of liveUrls.values()) URL.revokeObjectURL(url);
  liveUrls.clear();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb"));
    tx.objectStore(STORE).clear();
  });
  db.close();
}

export async function wipeMediaStore(): Promise<void> {
  ram.clear();
  previews.clear();
  for (const url of liveUrls.values()) URL.revokeObjectURL(url);
  liveUrls.clear();
  try {
    const db = await openDb();
    db.close();
  } catch {
    // ignore
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
