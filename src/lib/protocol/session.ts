import { ProtocolError } from "./errors";

const UNLOCKED_KEY = "magicrita.unlocked";
const TAB_KEY = "magicrita.tab";
const LOCK_KEY = "magicrita.sessionLock";
/** Copia en claro que una versión anterior escribía en localStorage. */
const LEGACY_LIVE_KEY = "magicrita.unlockedLive";
/** El latido va cada 4 s, así que 15 s tolera tres latidos perdidos. */
const LOCK_TTL_MS = 15_000;

/**
 * La rsec desbloqueada vive solo en la memoria de esta pestaña, nunca en
 * almacenamiento. `sessionStorage` ya era lo mínimo persistente, pero Firefox
 * lo escribe a disco y sobrevive a un cierre por fallo; con la clave en un
 * `CryptoKey` no extraíble habría sido mejor, salvo por el bug de Safari
 * 312279 (una clave no extraíble guardada en IndexedDB vuelve `null` al
 * releerla). El coste es que recargar vuelve a pedir la contraseña: es
 * justamente lo que la contraseña del vault debe hacer.
 */
let unlockedRsec: string | null = null;

type SessionLock = {
  rpub: string;
  tabId: string;
  ts: number;
};

/** Limpia la rsec que versiones anteriores dejaron en almacenamiento. */
function purgeLegacyPlaintext(): void {
  // Acceder a un Storage puede lanzar (cookies deshabilitadas, iframe sandbox),
  // así que cada uno va en su propio try y no en un bucle sobre la lista.
  try {
    localStorage.removeItem(LEGACY_LIVE_KEY);
    localStorage.removeItem(UNLOCKED_KEY);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(LEGACY_LIVE_KEY);
    sessionStorage.removeItem(UNLOCKED_KEY);
  } catch {
    // ignore
  }
}

export function saveUnlockedRsec(rsec: string): void {
  purgeLegacyPlaintext();
  unlockedRsec = rsec;
}

export function loadUnlockedRsec(): string | null {
  purgeLegacyPlaintext();
  return unlockedRsec;
}

export function clearUnlockedRsec(): void {
  unlockedRsec = null;
  purgeLegacyPlaintext();
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
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
  } catch {
    // sin localStorage no hay exclusión entre pestañas: se sigue sin lock
  }
}

/** Un lock sin latido reciente pertenece a una pestaña que ya no está. */
function isHeld(lock: SessionLock | null): boolean {
  return !!lock && Date.now() - lock.ts < LOCK_TTL_MS;
}

/**
 * Una sola pestaña puede tener la rsec en claro a la vez. Antes esto devolvía
 * `true` siempre, así que abrir la app en dos ventanas dejaba dos sesiones
 * con la clave del vault y dos presencias compitiendo.
 */
export function claimSession(rpub: string): boolean {
  const lock = readLock();
  if (lock && lock.tabId !== tabId() && isHeld(lock)) return false;
  writeLock(rpub);
  return true;
}

/** `false` significa que otra pestaña tomó el lock mientras tanto. */
export function heartbeatSession(rpub: string): boolean {
  const lock = readLock();
  if (lock && lock.tabId !== tabId() && isHeld(lock)) return false;
  writeLock(rpub);
  return true;
}

export function releaseSession(rpub: string): void {
  const lock = readLock();
  if (!lock || lock.tabId !== tabId()) return;
  if (lock.rpub !== rpub) return;
  try {
    localStorage.removeItem(LOCK_KEY);
  } catch {
    // ignore
  }
}

export function notifySessionExists(): void {
  window.dispatchEvent(new Event("magicrita-session-exists"));
}

/**
 * Otra pestaña tocó el lock: el evento `storage` no llega a quien lo escribió,
 * así que esta pestaña puede ver el relevo y cerrar su sesión sola.
 */
export function watchSessionLock(onLost: () => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key !== null && event.key !== LOCK_KEY) return;
    const lock = readLock();
    if (!lock) return;
    if (lock.tabId === tabId()) return;
    if (!isHeld(lock)) return;
    onLost();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export function assertSingleSession(rpub: string): void {
  if (claimSession(rpub)) return;
  notifySessionExists();
  throw new ProtocolError("session_exists");
}
