import { isEnvelope, mediaRefsOf, verifyEnvelope, type Envelope } from "./envelope";
import { dropMedia, setQuotaReliever } from "./media";
import { ProtocolError } from "./errors";
import { dropNoticesFor } from "./notices";
import { dropSavedPosts } from "./saves";
import { noteAuthorSeen } from "./spam";
import { hasRestKey, isSealedString, openString, sealString } from "./rest";

export const MAX_STORED_POSTS = 100;
export const MAX_STORED_CHATS = 100;
export const MAX_DISTINCT_CHATS = 100;
/** localStorage va por delante de 5 MB: sin este techo un par hostil agota la cuota. */
const MAX_LOG_CHARS = 900_000;

const logCache = new Map<string, Envelope[]>();
/**
 * `allEnvelopes()` se llama muchas veces por render y recorría todas las claves
 * de localStorage cada vez. Se invalida desde aquí, en el único sitio que
 * escribe logs, para que no pueda quedar una vista obsoleta.
 *
 * El array devuelto es el mismo cada vez, y va congelado: el coste de la cache
 * es no reasignar, y compartirlo mutable convertía cualquier `.sort()` o
 * `.splice()` de un consumidor en un fallo que se nota lejos de su causa. Quien
 * necesite ordenarlo debe copiar antes (`[...allEnvelopes()].sort(...)`).
 */
let allCache: readonly Envelope[] | null = null;

export function allEnvelopes(): readonly Envelope[] {
  if (!allCache) allCache = Object.freeze(listKnownRpubs().flatMap((rpub) => loadLog(rpub)));
  return allCache;
}

function invalidateAll(): void {
  allCache = null;
}

export function resetLogCache(): void {
  logCache.clear();
  invalidateAll();
}

function logKey(rpub: string): string {
  return `magicrita.log.${rpub}`;
}

function hashesOf(log: Envelope[]): Set<string> {
  const set = new Set<string>();
  for (const event of log) {
    for (const ref of mediaRefsOf(event)) set.add(ref.hash);
  }
  return set;
}

function dropOrphanMedia(before: Envelope[], after: Envelope[]): void {
  const still = hashesOf(after);
  for (const event of before) {
    for (const ref of mediaRefsOf(event)) {
      if (!still.has(ref.hash)) void dropMedia(ref.hash);
    }
  }
}

/**
 * Sobres que NUNCA se recortan por tamano. El perfil (nombre y foto) y los de
 * control son pequenos, y sin ellos la cuenta parece vacia. Antes `capLogChars`
 * ordenaba por fecha y cortaba lo mas viejo, que es justo el perfil: al cruzar
 * el techo, lo primero que desaparecia era el nombre y luego los posts con sus
 * fotos.
 */
const ESSENTIAL_TYPES = new Set<Envelope["type"]>([
  "profile",
  "follows",
  "blocks",
  "gone",
  "invite",
  "chat_consent",
  "delete",
]);

function pruneLog(log: Envelope[]): Envelope[] {
  const keep = new Set<string>();
  const newest = (type: Envelope["type"], max: number) => {
    for (const event of log.filter((item) => item.type === type).sort((a, b) => b.ts - a.ts).slice(0, max)) {
      if (event.sig) keep.add(event.sig);
    }
  };
  newest("post", MAX_STORED_POSTS);
  const next = log.filter((item) => {
    if (item.type === "post") return Boolean(item.sig && keep.has(item.sig));
    return true;
  });
  const droppedPosts = log.filter(
    (item) => item.type === "post" && item.sig && !keep.has(item.sig),
  );
  dropOrphanMedia(log, next);
  if (droppedPosts.length) {
    dropSavedPosts(droppedPosts.map((item) => item.sig).filter((sig): sig is string => Boolean(sig)));
    for (const listener of trimListeners) listener(droppedPosts);
  }
  return capLogChars(next);
}

/** Techo de bytes por log. Lo que se recorta es lo pesado y viejo, nunca el perfil. */
function capLogChars(log: Envelope[]): Envelope[] {
  const keep = new Set<Envelope>();
  let total = 0;
  for (const item of log) {
    if (!ESSENTIAL_TYPES.has(item.type)) continue;
    total += JSON.stringify(item).length;
    keep.add(item);
  }
  for (const item of [...log].sort((a, b) => b.ts - a.ts)) {
    if (keep.has(item)) continue;
    const size = JSON.stringify(item).length;
    if (total + size > MAX_LOG_CHARS) continue;
    total += size;
    keep.add(item);
  }
  if (keep.size === log.length) return log;
  const next = log.filter((item) => keep.has(item)).sort((a, b) => a.ts - b.ts);
  dropOrphanMedia(log, next);
  return next;
}


function chatParties(event: Envelope): [string, string] | null {
  if (event.type !== "chat_text" && event.type !== "chat_consent") return null;
  const other = event.body.to;
  if (!other || other === event.author) return null;
  return [event.author, other];
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** Keep at most 100 conversations. A new one drops the one quiet the longest. */
export function pruneDistinctChats(): void {
  const activity = new Map<string, { a: string; b: string; ts: number }>();
  for (const rpub of listKnownRpubs()) {
    for (const event of loadLog(rpub)) {
      const parties = chatParties(event);
      if (!parties) continue;
      const key = pairKey(parties[0], parties[1]);
      const prev = activity.get(key);
      if (!prev || event.ts > prev.ts) activity.set(key, { a: parties[0], b: parties[1], ts: event.ts });
    }
  }
  const extra = activity.size - MAX_DISTINCT_CHATS;
  if (extra <= 0) return;
  const victims = [...activity.entries()]
    .sort((left, right) => left[1].ts - right[1].ts || left[0].localeCompare(right[0]))
    .slice(0, extra);
  const victimKeys = new Set(victims.map(([key]) => key));
  const touched = new Set<string>();
  for (const [, victim] of victims) {
    touched.add(victim.a);
    touched.add(victim.b);
  }
  const dropped: Envelope[] = [];
  for (const author of touched) {
    const log = loadLog(author);
    const next: Envelope[] = [];
    for (const item of log) {
      const parties = chatParties(item);
      if (parties && victimKeys.has(pairKey(parties[0], parties[1]))) {
        dropped.push(item);
        continue;
      }
      next.push(item);
    }
    if (next.length !== log.length) saveLog(author, next);
  }
  if (!dropped.length) return;
  for (const [, victim] of victims) {
    dropNoticesFor(victim.a, { from: victim.b });
    dropNoticesFor(victim.b, { from: victim.a });
  }
  const kept = listKnownRpubs().flatMap((rpub) => loadLog(rpub));
  dropOrphanMedia(dropped, kept);
  for (const listener of trimListeners) listener(dropped);
}

function pruneChatThread(a: string, b: string): void {
  const pick = (author: string, to: string) =>
    loadLog(author).filter((item) => item.type === "chat_text" && item.body.to === to);
  const all = [...pick(a, b), ...pick(b, a)].sort((left, right) => left.ts - right.ts);
  if (all.length <= MAX_STORED_CHATS) return;
  const drop = new Set(all.slice(0, all.length - MAX_STORED_CHATS).map((item) => item.sig));
  const leftover: Envelope[] = [];
  for (const author of [a, b]) {
    const log = loadLog(author);
    const next = log.filter((item) => !drop.has(item.sig));
    leftover.push(...next);
    if (next.length !== log.length) saveLog(author, next);
  }
  dropOrphanMedia(all, leftover);
  const droppedChats = all.filter((item) => item.sig && drop.has(item.sig));
  if (droppedChats.length) {
    for (const listener of trimListeners) listener(droppedChats);
  }
}

export function loadLog(rpub: string): Envelope[] {
  const cached = logCache.get(rpub);
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(logKey(rpub));
    if (!raw) {
      logCache.set(rpub, []);
      return [];
    }
    // `openString` devuelve el valor tal cual si es legado (texto plano) y `null`
    // si el log esta cifrado y todavia no hay clave (sin desbloquear).
    const text = openString(raw);
    if (text === null) {
      logCache.set(rpub, []);
      return [];
    }
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      logCache.set(rpub, []);
      return [];
    }
    const events = parsed.filter((item): item is Envelope => isEnvelope(item) && verifyEnvelope(item));
    const pruned = pruneLog(events.filter((item) => item.type !== "presence"));
    logCache.set(rpub, pruned);
    if (pruned.length !== events.length) {
      try {
        saveLog(rpub, pruned);
      } catch {
        // quota: still return the pruned view
      }
    }
    return pruned;
  } catch {
    return [];
  }
}

const trimListeners = new Set<(dropped: Envelope[]) => void>();

export function onStorageTrim(listener: (dropped: Envelope[]) => void): () => void {
  trimListeners.add(listener);
  return () => trimListeners.delete(listener);
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22);
}

function writeLogRaw(rpub: string, log: Envelope[]): void {
  logCache.set(rpub, log);
  invalidateAll();
  localStorage.setItem(logKey(rpub), sealString(JSON.stringify(log)));
}

/**
 * Re-cifra los logs que aun esten en texto plano (instalaciones anteriores al
 * cifrado en reposo). Se llama una vez tras desbloquear; es idempotente.
 */
export function migrateLogsAtRest(): void {
  if (!hasRestKey()) return;
  for (const rpub of listKnownRpubs()) {
    try {
      const raw = localStorage.getItem(logKey(rpub));
      if (!raw || isSealedString(raw)) continue;
      writeLogRaw(rpub, loadLog(rpub));
    } catch {
      // cuota o almacen no disponible: se reintentara en el proximo desbloqueo
    }
  }
}

function readLogRaw(rpub: string): Envelope[] {
  return loadLog(rpub);
}

function freeQuarter(rpub: string): Envelope[] {
  const log = readLogRaw(rpub);
  const posts = log.filter((item) => item.type === "post").sort((a, b) => a.ts - b.ts);
  const chats = log.filter((item) => item.type === "chat_text").sort((a, b) => a.ts - b.ts);
  const dropPosts = posts.length ? posts.slice(0, Math.max(1, Math.ceil(posts.length * 0.25))) : [];
  const dropChats = chats.length ? chats.slice(0, Math.max(1, Math.ceil(chats.length * 0.25))) : [];
  const drop = new Set([...dropPosts, ...dropChats].map((item) => item.sig).filter(Boolean));
  if (drop.size === 0) return [];
  const next = log.filter((item) => !item.sig || !drop.has(item.sig));
  dropOrphanMedia(log, next);
  dropSavedPosts(dropPosts.map((item) => item.sig).filter((sig): sig is string => Boolean(sig)));
  writeLogRaw(rpub, next);
  for (const chat of dropChats) {
    if (chat.type !== "chat_text") continue;
    const other = chat.body.to;
    const otherLog = readLogRaw(other);
    const trimmed = otherLog.filter((item) => item.sig !== chat.sig);
    if (trimmed.length !== otherLog.length) {
      dropOrphanMedia(otherLog, trimmed);
      writeLogRaw(other, trimmed);
    }
  }
  const dropped = [...dropPosts, ...dropChats];
  for (const listener of trimListeners) listener(dropped);
  return dropped;
}

function relieveQuota(): void {
  for (const rpub of listKnownRpubs()) freeQuarter(rpub);
}

export function saveLog(rpub: string, log: Envelope[]): void {
  try {
    writeLogRaw(rpub, log);
    return;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
  }
  // Primero se recorta el log que se esta guardando. Antes se recortaba a
  // TODOS los autores en cuanto uno no cabia, asi que guardar lo que llegaba de
  // un par podia tirar posts del usuario actual que no tenian nada que ver.
  freeQuarter(rpub);
  try {
    writeLogRaw(rpub, pruneLog(log));
    return;
  } catch (retry) {
    if (!isQuotaError(retry)) throw retry;
  }
  relieveQuota();
  writeLogRaw(rpub, pruneLog(log));
}

export function forgetTarget(sig: string): void {
  if (!sig) return;
  dropSavedPosts([sig]);
  for (const rpub of listKnownRpubs()) {
    const log = readLogRaw(rpub);
    const next = log.filter((item) => item.sig !== sig);
    if (next.length !== log.length) {
      dropOrphanMedia(log, next);
      writeLogRaw(rpub, next);
    }
  }
}

function dropReplacedMedia(previous: Envelope | undefined, next: Envelope): void {
  if (!previous) return;
  const keep = new Set(mediaRefsOf(next).map((ref) => ref.hash));
  for (const ref of mediaRefsOf(previous)) {
    if (!keep.has(ref.hash)) void dropMedia(ref.hash);
  }
}

export function appendEnvelope(rpub: string, envelope: Envelope): Envelope[] {
  if (!verifyEnvelope(envelope) || envelope.author !== rpub) {
    throw new ProtocolError("invalid_envelope");
  }
  noteAuthorSeen(rpub);
  const current = loadLog(rpub);
  const replaced =
    (envelope.type === "post" || envelope.type === "comment" || envelope.type === "chat_text") &&
    envelope.body.replaces
      ? current.find((item) => item.sig === envelope.body.replaces)
      : undefined;
  dropReplacedMedia(replaced, envelope);
  const next = pruneLog(
    [...current.filter((item) => item.sig !== envelope.sig), envelope].sort((a, b) => a.ts - b.ts),
  );
  saveLog(rpub, next);
  if (envelope.type === "delete") forgetTarget(envelope.body.target);
  if (envelope.type === "chat_text") pruneChatThread(envelope.author, envelope.body.to);
  if (envelope.type === "chat_text" || envelope.type === "chat_consent") pruneDistinctChats();
  return loadLog(rpub);
}

export function latestProfile(log: Envelope[]): Envelope | null {
  const profiles = log.filter((item) => item.type === "profile");
  return profiles.at(-1) ?? null;
}

export function postsOf(log: Envelope[]): Envelope[] {
  return log.filter((item) => item.type === "post").sort((a, b) => b.ts - a.ts);
}

function recentOf(log: Envelope[], type: Envelope["type"], limit: number): Envelope[] {
  return log
    .filter((item) => item.type === type)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

function lastOf(log: Envelope[], type: Envelope["type"]): Envelope[] {
  const found = log.filter((item) => item.type === type).at(-1);
  return found ? [found] : [];
}

/** Sobres a entregar cuando un par se conecta: lo propio y lo que hayamos visto de otros. */
export function envelopesToSync(selfRpub: string): Envelope[] {
  const seen = new Set<string>();
  const out: Envelope[] = [];
  const add = (items: Envelope[]) => {
    for (const item of items) {
      if (!item?.sig || seen.has(item.sig) || item.type === "presence") continue;
      seen.add(item.sig);
      out.push(item);
    }
  };
  const mine = loadLog(selfRpub);
  add(lastOf(mine, "profile"));
  add(lastOf(mine, "follows"));
  add(lastOf(mine, "blocks"));
  add(lastOf(mine, "gone"));
  add(postsOf(mine).slice(0, MAX_STORED_POSTS));
  add(recentOf(mine, "like", 400));
  add(recentOf(mine, "comment", 400));
  add(recentOf(mine, "report", 200));
  add(recentOf(mine, "delete", 200));
  add(recentOf(mine, "chat_consent", 80));
  add(recentOf(mine, "chat_text", MAX_STORED_CHATS));
  for (const rpub of listKnownRpubs()) {
    if (rpub === selfRpub) continue;
    const log = loadLog(rpub);
    if (log.some((item) => item.type === "gone")) {
      add(lastOf(log, "gone"));
      continue;
    }
    add(lastOf(log, "profile"));
    add(postsOf(log).slice(0, MAX_STORED_POSTS));
    add(recentOf(log, "like", 80));
    add(recentOf(log, "comment", 80));
    add(recentOf(log, "report", 40));
    add(recentOf(log, "delete", 40));
    add(recentOf(log, "chat_consent", 20));
    add(recentOf(log, "chat_text", MAX_STORED_CHATS));
  }
  return out;
}

export function recipientsOf(envelope: Envelope): string[] {
  const mine = envelope.author;
  if (envelope.type === "follows" || envelope.type === "blocks") {
    return envelope.body.rpubs.filter((rpub) => rpub && rpub !== mine);
  }
  if (envelope.type === "chat_consent" || envelope.type === "chat_text" || envelope.type === "recovery_share") {
    return envelope.body.to && envelope.body.to !== mine ? [envelope.body.to] : [];
  }
  if (
    envelope.type === "like" ||
    envelope.type === "comment" ||
    envelope.type === "report" ||
    envelope.type === "attest"
  ) {
    const target = envelope.body.target;
    const postSig = target.startsWith("image:") ? target.split(":")[1] ?? target : target;
    for (const rpub of listKnownRpubs()) {
      if (rpub === mine) continue;
      if (loadLog(rpub).some((item) => item.sig === postSig)) return [rpub];
    }
    return listKnownRpubs().filter((rpub) => rpub !== mine);
  }
  if (
    envelope.type === "post" ||
    envelope.type === "profile" ||
    envelope.type === "delete" ||
    envelope.type === "gone" ||
    envelope.type === "invite"
  ) {
    return listKnownRpubs().filter((rpub) => rpub !== mine);
  }
  return [];
}

export function latestFollows(log: Envelope[]): string[] {
  const found = log.filter((item) => item.type === "follows").at(-1);
  return found && found.type === "follows" ? found.body.rpubs : [];
}

export function listKnownRpubs(): string[] {
  const prefix = "magicrita.log.";
  const rpubs: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) rpubs.push(key.slice(prefix.length));
  }
  return rpubs.sort();
}

export function mergeEnvelopes(envelopes: Envelope[]): string[] {
  const authors = new Set<string>();
  for (const envelope of envelopes) {
    if (!verifyEnvelope(envelope) || !isEnvelope(envelope)) {
      throw new ProtocolError("invalid_envelope");
    }
    authors.add(envelope.author);
    appendEnvelope(envelope.author, envelope);
  }
  return [...authors];
}

export function authorIsGone(rpub: string): boolean {
  const log = loadLog(rpub);
  let goneTs = -1;
  let newest = -1;
  for (const item of log) {
    if (item.ts > newest) newest = item.ts;
    if (item.type === "gone" && item.ts > goneTs) goneTs = item.ts;
  }
  // Solo sigue "ido" si su ultima firma es el gone; si despues publico algo
  // (o restauro un backup con eventos mas nuevos), vuelve a estar aqui.
  return goneTs >= 0 && goneTs >= newest;
}

export function applyAuthorGone(envelope: Envelope): boolean {
  if (envelope.type !== "gone" || !verifyEnvelope(envelope)) return false;
  const previous = loadLog(envelope.author);
  const priorGone = previous.reduce<Envelope | null>(
    (best, item) => (item.type === "gone" && (!best || item.ts > best.ts) ? item : best),
    null,
  );
  if (priorGone && priorGone.ts >= envelope.ts) return false;
  // NO se borra el historial. Antes el log quedaba en [gone] y un par que
  // todavia guardaba un gone de una sesion anterior lo reenviaba al conectar,
  // destruyendo perfil, posts y fotos del usuario. Ahora el gone solo se anade:
  // marca al autor como ausente (`authorIsGone`) sin tocar sus datos. Si vuelve
  // a firmar algo mas nuevo, reaparece con todo intacto.
  appendEnvelope(envelope.author, envelope);
  return true;
}

setQuotaReliever(() => {
  for (const rpub of listKnownRpubs()) freeQuarter(rpub);
});

