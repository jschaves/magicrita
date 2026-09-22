import type { Envelope } from "./envelope";

export const MAX_NOTICES = 10;

export type NoticeKind = "chat" | "request" | "invite";

export type Notice = {
  id: string;
  kind: NoticeKind;
  from: string;
  ts: number;
};

function storageKey(rpub: string): string {
  return `magicrita.notices.${rpub}`;
}

export function loadNotices(rpub: string): Notice[] {
  try {
    const raw = sessionStorage.getItem(storageKey(rpub));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Notice => {
        return (
          item &&
          typeof item.id === "string" &&
          (item.kind === "chat" || item.kind === "request" || item.kind === "invite") &&
          typeof item.from === "string" &&
          typeof item.ts === "number"
        );
      })
      .slice(0, MAX_NOTICES);
  } catch {
    return [];
  }
}

export function saveNotices(rpub: string, list: Notice[]): void {
  sessionStorage.setItem(storageKey(rpub), JSON.stringify(list.slice(0, MAX_NOTICES)));
}

export function pushNotice(rpub: string, notice: Notice): Notice[] {
  const list = loadNotices(rpub).filter((item) => item.id !== notice.id);
  const next = [notice, ...list].sort((a, b) => b.ts - a.ts).slice(0, MAX_NOTICES);
  saveNotices(rpub, next);
  return next;
}

export function dropNotice(rpub: string, id: string): Notice[] {
  const next = loadNotices(rpub).filter((item) => item.id !== id);
  saveNotices(rpub, next);
  return next;
}

export function dropNoticesFor(
  rpub: string,
  match: { kind?: NoticeKind | NoticeKind[]; from?: string },
): Notice[] {
  const kinds = match.kind ? (Array.isArray(match.kind) ? match.kind : [match.kind]) : null;
  const next = loadNotices(rpub).filter((item) => {
    if (kinds && !kinds.includes(item.kind)) return true;
    if (match.from && item.from !== match.from) return true;
    return false;
  });
  saveNotices(rpub, next);
  return next;
}

export function noticeFromEnvelope(envelope: Envelope, me: string): Notice | null {
  if (!me || envelope.author === me || !envelope.sig) return null;
  if (envelope.type === "chat_text" && envelope.body.to === me) {
    return { id: envelope.sig, kind: "chat", from: envelope.author, ts: envelope.ts };
  }
  if (envelope.type === "chat_consent" && envelope.body.to === me && envelope.body.on) {
    return { id: envelope.sig, kind: "request", from: envelope.author, ts: envelope.ts };
  }
  if (envelope.type === "invite" && envelope.body.rpub === me) {
    return { id: envelope.sig, kind: "invite", from: envelope.author, ts: envelope.ts };
  }
  return null;
}

let beepCtx: AudioContext | null = null;

export function playNoticeBeep(): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!beepCtx) beepCtx = new AC();
    if (beepCtx.state === "suspended") void beepCtx.resume();
    const osc = beepCtx.createOscillator();
    const gain = beepCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.07, beepCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, beepCtx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(beepCtx.destination);
    osc.start();
    osc.stop(beepCtx.currentTime + 0.16);
  } catch {
    // ignore
  }
}

export function pingDesktop(title: string, body: string, tag: string): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const note = new Notification(title, { body, tag });
    window.setTimeout(() => note.close(), 8000);
  } catch {
    // ignore
  }
}
