const ATTEMPTS_KEY = "magicrita.signup.attempts";
const LAST_CREATED_KEY = "magicrita.signup.lastCreated";
const ATTEMPT_WINDOW_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const SUCCESS_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export type CreateBlock = { reason: "exists" | "rate"; minutes: number };

function readAttempts(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    const cut = Date.now() - ATTEMPT_WINDOW_MS;
    return raw.filter((item): item is number => typeof item === "number" && item > cut);
  } catch {
    return [];
  }
}

function writeAttempts(list: number[]): void {
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(list));
}

function lastCreated(): number {
  const raw = Number(localStorage.getItem(LAST_CREATED_KEY) || 0);
  return Number.isFinite(raw) ? raw : 0;
}

function minutesFrom(ts: number): number {
  return Math.max(1, Math.ceil((ts - Date.now()) / 60000));
}

export function hasLocalAccount(): boolean {
  try {
    return Boolean(localStorage.getItem("magicrita.vault"));
  } catch {
    return false;
  }
}

export function createBlock(): CreateBlock | null {
  if (hasLocalAccount()) return { reason: "exists", minutes: 0 };
  const created = lastCreated();
  if (created && Date.now() - created < SUCCESS_COOLDOWN_MS) {
    return { reason: "rate", minutes: minutesFrom(created + SUCCESS_COOLDOWN_MS) };
  }
  const attempts = readAttempts();
  if (attempts.length >= MAX_ATTEMPTS) {
    const oldest = Math.min(...attempts);
    return { reason: "rate", minutes: minutesFrom(oldest + ATTEMPT_WINDOW_MS) };
  }
  return null;
}

export function noteCreateAttempt(): void {
  writeAttempts([...readAttempts(), Date.now()]);
}

export function noteCreateSuccess(): void {
  localStorage.setItem(LAST_CREATED_KEY, String(Date.now()));
  writeAttempts([]);
}

