import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, bytesToUtf8, hexToBytes, randomBytes, utf8ToBytes } from "./bytes";
import type { Envelope } from "./envelope";
import type { MediaRef } from "./media";
import { MAX_STORED_CHATS } from "./store";
import { parseRpub, type Identity } from "./identity";
import { latestBlocks } from "./social";
import { loadLog } from "./store";

export type ChatPhase = "none" | "outgoing" | "incoming" | "open" | "closed" | "blocked";

export type ChatLine = {
  sig: string;
  author: string;
  ts: number;
  text: string | null;
  audio?: MediaRef;
};

function sharedKey(secret: Uint8Array, theirRpub: string): Uint8Array {
  const xSec = ed25519.utils.toMontgomerySecret(secret);
  const xPub = ed25519.utils.toMontgomery(parseRpub(theirRpub));
  return sha256(x25519.getSharedSecret(xSec, xPub));
}

export function sealChat(identity: Identity, theirRpub: string, text: string): { n: string; box: string } {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(sharedKey(identity.secret, theirRpub), nonce);
  return { n: bytesToHex(nonce), box: bytesToHex(cipher.encrypt(utf8ToBytes(text))) };
}

export function openChat(identity: Identity, theirRpub: string, n: string, box: string): string | null {
  try {
    const cipher = xchacha20poly1305(sharedKey(identity.secret, theirRpub), hexToBytes(n));
    return bytesToUtf8(cipher.decrypt(hexToBytes(box)));
  } catch {
    return null;
  }
}

export function latestConsent(events: Envelope[], from: string, to: string): boolean | null {
  let on: boolean | null = null;
  let ts = -1;
  for (const event of events) {
    if (event.type !== "chat_consent") continue;
    if (event.author !== from || event.body.to !== to) continue;
    if (event.ts >= ts) {
      ts = event.ts;
      on = event.body.on;
    }
  }
  return on;
}

export function isChatBlocked(events: Envelope[], me: string, them: string, myBlocks: string[]): boolean {
  if (myBlocks.includes(them)) return true;
  const listed = latestBlocks(events.filter((item) => item.author === them));
  if (listed.includes(me)) return true;
  return latestBlocks(loadLog(them)).includes(me);
}

export function chatPhase(
  events: Envelope[],
  me: string,
  them: string,
  myBlocks: string[],
): ChatPhase {
  if (isChatBlocked(events, me, them, myBlocks)) return "blocked";
  const mine = latestConsent(events, me, them);
  const theirs = latestConsent(events, them, me);
  if (mine === true && theirs === true) return "open";
  if (mine === true) return "outgoing";
  if (theirs === true) return "incoming";
  if (mine === false || theirs === false) return "closed";
  return "none";
}

export function chatPeers(events: Envelope[], me: string): string[] {
  const set = new Set<string>();
  for (const event of events) {
    if (event.type !== "chat_consent" && event.type !== "chat_text") continue;
    if (event.author === me) set.add(event.body.to);
    else if (event.body.to === me) set.add(event.author);
  }
  return [...set];
}

export function chatPeersWithMessages(events: Envelope[], me: string): string[] {
  const set = new Set<string>();
  for (const event of events) {
    if (event.type !== "chat_text") continue;
    if (event.author === me) set.add(event.body.to);
    else if (event.body.to === me) set.add(event.author);
  }
  return [...set];
}

export function chatLines(events: Envelope[], identity: Identity, them: string): ChatLine[] {
  const me = identity.rpub;
  const lines: ChatLine[] = [];
  for (const event of events) {
    if (event.type !== "chat_text") continue;
    const mine = event.author === me && event.body.to === them;
    const theirs = event.author === them && event.body.to === me;
    if (!mine && !theirs) continue;
    const audio = event.body.media?.find((item) => item.mime.startsWith("audio/"));
    const raw = openChat(identity, them, event.body.n, event.body.box);
    lines.push({
      sig: event.sig,
      author: event.author,
      ts: event.ts,
      text: audio ? (raw && raw.trim() ? raw : null) : raw,
      audio,
    });
  }
  return lines.sort((a, b) => a.ts - b.ts).slice(-MAX_STORED_CHATS);
}
