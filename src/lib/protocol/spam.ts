import type { Envelope } from "./envelope";
import { verifyEnvelope } from "./envelope";

export const QUARANTINE_MS = 12 * 60 * 60 * 1000;
export const YOUNG_REPORT_HIDE = 3;
export const MAX_TEXT_LINKS = 2;
export const MAX_SAME_TEXT = 2;

/**
 * Momento en que ESTA maquina vio a cada autor por primera vez. `ts` viene
 * firmado pero lo elige el autor, asi que la cuarentena no se puede fiar de el:
 * bastaba firmar el primer post con `ts` de hace 13 h para saltarse las 12 h de
 * cuarentena que existen para fren as granjas. Aqui el valor es local y no se
 * puede falsear desde fuera.
 */
const SEEN_KEY = "magicrita.seen.first";
const SEEN_MAX = 4_000;
let seenCache: Record<string, number> | null = null;

function readSeen(): Record<string, number> {
  if (seenCache) return seenCache;
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as unknown;
    const out: Record<string, number> = {};
    if (raw && typeof raw === "object") {
      for (const [rpub, at] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof at === "number" && Number.isFinite(at) && at > 0) out[rpub] = at;
      }
    }
    seenCache = out;
  } catch {
    seenCache = {};
  }
  return seenCache;
}

function writeSeen(seen: Record<string, number>): void {
  seenCache = seen;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // sin quota seguimos en memoria
  }
}

export function noteAuthorSeen(rpub: string, now = Date.now()): void {
  if (!rpub) return;
  const seen = readSeen();
  const previous = seen[rpub];
  if (previous !== undefined && previous <= now) return;
  const next = { ...seen, [rpub]: now };
  const keys = Object.keys(next);
  if (keys.length > SEEN_MAX) {
    const ordered = keys.sort((a, b) => (next[a] ?? 0) - (next[b] ?? 0));
    for (const key of ordered.slice(0, keys.length - SEEN_MAX)) delete next[key];
  }
  writeSeen(next);
}

export function forgetSeen(rpub: string): void {
  const seen = readSeen();
  if (!(rpub in seen)) return;
  const next = { ...seen };
  delete next[rpub];
  writeSeen(next);
}

function observedFirstTs(rpub: string): number | null {
  const at = readSeen()[rpub];
  return typeof at === "number" ? at : null;
}

export function resetSeenCache(): void {
  seenCache = null;
}

export function countLinks(text: string): number {
  return (text.match(/https?:\/\/[^\s<>]+/gi) ?? []).length;
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function authorFirstTs(events: Envelope[], rpub: string): number | null {
  let first: number | null = null;
  for (const event of events) {
    if (event.author !== rpub) continue;
    if (first === null || event.ts < first) first = event.ts;
  }
  return first;
}

export function vouchedBy(events: Envelope[], inviters: string[], now = Date.now()): Set<string> {
  const trusted = new Set(inviters);
  const out = new Set<string>();
  for (const event of events) {
    if (event.type !== "invite") continue;
    if (!trusted.has(event.author)) continue;
    if (event.body.exp < now) continue;
    out.add(event.body.rpub);
  }
  return out;
}

export function isTrustedAuthor(
  events: Envelope[],
  rpub: string,
  me: string | null,
  follows: string[],
  now = Date.now(),
): boolean {
  if (!rpub) return false;
  if (me && rpub === me) return true;
  if (follows.includes(rpub)) return true;
  const inviters = me ? [me, ...follows] : follows;
  return vouchedBy(events, inviters, now).has(rpub);
}

export function isYoungAuthor(events: Envelope[], rpub: string, now = Date.now()): boolean {
  // Lo observado localmente manda: nunca es anterior a cuando llegamos a ver al
  // autor, por mucho ts antiguo que firme. Solo si no hay observacion (log
  // importado, otro dispositivo) caemos en el ts declarado.
  const observed = observedFirstTs(rpub);
  const first = observed ?? authorFirstTs(events, rpub);
  if (first === null) return true;
  return now - first < QUARANTINE_MS;
}

export function isQuarantined(
  events: Envelope[],
  rpub: string,
  me: string | null,
  follows: string[],
  now = Date.now(),
  live?: Set<string>,
): boolean {
  if (isTrustedAuthor(events, rpub, me, follows, now)) return false;
  if (live?.has(rpub)) return false;
  return isYoungAuthor(events, rpub, now);
}

export function reportHideAfter(young: boolean): number {
  return young ? YOUNG_REPORT_HIDE : 10;
}

export function shouldRejectSpam(envelope: Envelope, existing: Envelope[]): boolean {
  if (!verifyEnvelope(envelope)) return true;
  if (envelope.type === "post" && countLinks(envelope.body.text) > MAX_TEXT_LINKS) return true;
  if (envelope.type === "comment" && countLinks(envelope.body.text) > MAX_TEXT_LINKS) return true;
  if (envelope.type === "post") {
    const norm = normalizeText(envelope.body.text);
    if (!norm) return false;
    let same = 0;
    for (const item of existing) {
      if (item.type !== "post") continue;
      if (item.sig === envelope.sig) continue;
      if (normalizeText(item.body.text) === norm) same += 1;
      if (same >= MAX_SAME_TEXT) return true;
    }
  }
  return false;
}
