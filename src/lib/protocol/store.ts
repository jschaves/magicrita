import { isEnvelope, verifyEnvelope, type Envelope } from "./envelope";
import { ProtocolError } from "./errors";
import { dropAuthorFromLikes, loadLikeIndex, saveLikeIndex } from "./likeIndex";
import { dropSavedPosts } from "./saves";

function logKey(rpub: string): string {
  return `magicrita.log.${rpub}`;
}

export function loadLog(rpub: string): Envelope[] {
  try {
    const raw = localStorage.getItem(logKey(rpub));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const events = parsed.filter((item): item is Envelope => isEnvelope(item) && verifyEnvelope(item));
    const pruned = events.filter((item) => item.type !== "presence");
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

export function saveLog(rpub: string, log: Envelope[]): void {
  localStorage.setItem(logKey(rpub), JSON.stringify(log));
}

export function appendEnvelope(rpub: string, envelope: Envelope): Envelope[] {
  if (!verifyEnvelope(envelope) || envelope.author !== rpub) {
    throw new ProtocolError("invalid_envelope");
  }
  const current = loadLog(rpub);
  const next = [...current.filter((item) => item.sig !== envelope.sig), envelope].sort((a, b) => a.ts - b.ts);
  saveLog(rpub, next);
  return next;
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
  add(postsOf(mine).slice(0, 40));
  add(recentOf(mine, "like", 400));
  add(recentOf(mine, "comment", 400));
  add(recentOf(mine, "report", 200));
  add(recentOf(mine, "delete", 200));
  for (const rpub of listKnownRpubs()) {
    if (rpub === selfRpub) continue;
    const log = loadLog(rpub);
    if (log.some((item) => item.type === "gone")) {
      add(lastOf(log, "gone"));
      continue;
    }
    add(lastOf(log, "profile"));
    add(postsOf(log).slice(0, 20));
    add(recentOf(log, "like", 80));
    add(recentOf(log, "comment", 80));
    add(recentOf(log, "report", 40));
    add(recentOf(log, "delete", 40));
  }
  return out;
}

export function recipientsOf(envelope: Envelope): string[] {
  const mine = envelope.author;
  if (envelope.type === "follows" || envelope.type === "blocks") {
    return envelope.body.rpubs.filter((rpub) => rpub && rpub !== mine);
  }
  if (envelope.type === "like" || envelope.type === "comment" || envelope.type === "report") {
    const target = envelope.body.target;
    const postSig = target.startsWith("image:") ? target.split(":")[1] ?? target : target;
    for (const rpub of listKnownRpubs()) {
      if (rpub === mine) continue;
      if (loadLog(rpub).some((item) => item.sig === postSig)) return [rpub];
    }
    return listKnownRpubs().filter((rpub) => rpub !== mine);
  }
  if (envelope.type === "post" || envelope.type === "profile" || envelope.type === "delete" || envelope.type === "gone") {
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

export function clearLog(rpub: string): void {
  localStorage.removeItem(logKey(rpub));
}

export function authorIsGone(rpub: string): boolean {
  return loadLog(rpub).some((item) => item.type === "gone");
}

export function applyAuthorGone(envelope: Envelope): boolean {
  if (envelope.type !== "gone" || !verifyEnvelope(envelope)) return false;
  const previous = loadLog(envelope.author);
  if (previous.some((item) => item.type === "gone")) return false;
  const postSigs = previous.filter((item) => item.type === "post" && item.sig).map((item) => item.sig);
  try {
    saveLog(envelope.author, [envelope]);
  } catch {
    return false;
  }
  dropSavedPosts(postSigs);
  try {
    saveLikeIndex(dropAuthorFromLikes(loadLikeIndex(), envelope.author, postSigs));
  } catch {
    // ignore
  }
  return true;
}
