import type { Envelope } from "./envelope";
import { verifyEnvelope } from "./envelope";

export const QUARANTINE_MS = 12 * 60 * 60 * 1000;
export const YOUNG_REPORT_HIDE = 3;
export const MAX_TEXT_LINKS = 2;
export const MAX_SAME_TEXT = 2;

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
  const first = authorFirstTs(events, rpub);
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
