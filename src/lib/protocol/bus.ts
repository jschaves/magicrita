import { isEnvelope, mediaRefsOf, verifyEnvelope, type Envelope } from "./envelope";
import { rememberPreview } from "./media";
import { shouldRejectSpam } from "./spam";
import { appendEnvelope, applyAuthorGone, loadLog } from "./store";

const CHANNEL = "magicrita-live";
const STORAGE_KEY = "magicrita.live-ping";

export function broadcastEnvelope(envelope: Envelope): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(envelope);
    channel.close();
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ envelope, t: Date.now() }));
  } catch {
    // ignore
  }
}

export function listenEnvelopes(onEnvelope: (envelope: Envelope) => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => {
      if (isEnvelope(event.data)) onEnvelope(event.data);
    };
  } catch {
    channel = null;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as { envelope?: unknown };
      if (parsed.envelope && isEnvelope(parsed.envelope)) onEnvelope(parsed.envelope);
    } catch {
      // ignore
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}

export function acceptRemoteEnvelope(envelope: Envelope): boolean {
  if (!isEnvelope(envelope) || !verifyEnvelope(envelope)) return false;
  if (envelope.type === "presence") return false;
  if (envelope.type === "gone") return applyAuthorGone(envelope);
  const existing = loadLog(envelope.author);
  // Un `gone` tapa la cuenta, pero si el autor vuelve y firma algo mas nuevo,
  // eso manda: un par que aun guarda el gone viejo no puede dejarlo invisible
  // ni rechazarle la actividad nueva para siempre.
  const gone = existing.find((item) => item.type === "gone");
  if (gone && envelope.ts <= gone.ts) return false;
  if (existing.some((item) => item.sig === envelope.sig)) return false;
  if (shouldRejectSpam(envelope, existing)) return false;
  appendEnvelope(envelope.author, envelope);
  // Guarda los thumbnails que vienen dentro del sobre para pintarlos al momento.
  for (const ref of mediaRefsOf(envelope)) rememberPreview(ref.hash, ref.preview);
  return true;
}
