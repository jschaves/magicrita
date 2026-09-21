import type { Envelope } from "./envelope";

export type LikeIndex = Record<string, Record<string, boolean>>;

const KEY = "magicrita.likeIndex";

export function loadLikeIndex(): LikeIndex {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LikeIndex;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLikeIndex(index: LikeIndex): void {
  localStorage.setItem(KEY, JSON.stringify(index));
}

export function mergeLikes(base: LikeIndex, events: Envelope[]): LikeIndex {
  const next: LikeIndex = { ...base };
  const likes = events
    .filter((event) => event.type === "like")
    .sort((a, b) => a.ts - b.ts);
  for (const event of likes) {
    if (event.type !== "like") continue;
    const target = event.body.target;
    next[target] = { ...next[target], [event.author]: event.body.on };
  }
  return next;
}

export function setLike(index: LikeIndex, target: string, rpub: string, on: boolean): LikeIndex {
  return {
    ...index,
    [target]: {
      ...index[target],
      [rpub]: on,
    },
  };
}

export function dropAuthorFromLikes(index: LikeIndex, author: string, postSigs: string[]): LikeIndex {
  const drop = new Set(postSigs);
  const next: LikeIndex = {};
  for (const [target, row] of Object.entries(index)) {
    if (drop.has(target)) continue;
    const copy = { ...row };
    delete copy[author];
    next[target] = copy;
  }
  return next;
}

export function likeStats(
  index: LikeIndex,
  target: string,
  me: string | null,
): { count: number; mine: boolean } {
  const row = index[target] ?? {};
  let count = 0;
  for (const on of Object.values(row)) if (on) count += 1;
  return { count, mine: Boolean(me && row[me]) };
}
