import { ProtocolError } from "./errors";

const UNLOCKED_KEY = "magicrita.unlocked";
const LIVE_KEY = "magicrita.unlockedLive";
const TAB_KEY = "magicrita.tab";
const LOCK_KEY = "magicrita.sessionLock";

type SessionLock = {
  rpub: string;
  tabId: string;
  ts: number;
};

export function saveUnlockedRsec(rsec: string): void {
  sessionStorage.setItem(UNLOCKED_KEY, rsec);
  try {
    localStorage.setItem(LIVE_KEY, rsec);
  } catch {
    // ignore
  }
}

export function loadUnlockedRsec(): string | null {
  return sessionStorage.getItem(UNLOCKED_KEY) || localStorage.getItem(LIVE_KEY);
}

export function clearUnlockedRsec(): void {
  sessionStorage.removeItem(UNLOCKED_KEY);
  try {
    localStorage.removeItem(LIVE_KEY);
  } catch {
    // ignore
  }
}

export function tabId(): string {
  let id = sessionStorage.getItem(TAB_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, id);
  }
  return id;
}

function readLock(): SessionLock | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionLock;
    if (!parsed.rpub || !parsed.tabId || typeof parsed.ts !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLock(rpub: string): void {
  const lock: SessionLock = { rpub, tabId: tabId(), ts: Date.now() };
  localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
}

export function claimSession(rpub: string): boolean {
  writeLock(rpub);
  return true;
}

export function heartbeatSession(rpub: string): void {
  const lock = readLock();
  if (lock && lock.tabId !== tabId()) return;
  writeLock(rpub);
}

export function releaseSession(rpub: string): void {
  const lock = readLock();
  if (!lock || lock.tabId !== tabId()) return;
  if (lock.rpub !== rpub) return;
  localStorage.removeItem(LOCK_KEY);
}

export function notifySessionExists(): void {
  window.dispatchEvent(new Event("magicrita-session-exists"));
}

export function assertSingleSession(rpub: string): void {
  if (claimSession(rpub)) return;
  notifySessionExists();
  throw new ProtocolError("session_exists");
}
