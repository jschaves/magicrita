import type { Envelope } from "./envelope";
import { allEnvelopes as allEnvelopesCached } from "./store";
import { isQuarantined, reportHideAfter } from "./spam";

export const PRESENCE_MS = 90_000;
export const FEED_VISIBLE = 16;
export const MAX_AUTHOR_POSTS = 100;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function visiblePostsOf(events: Envelope[], author?: string): Envelope[] {
  const deleted = new Set<string>();
  const replaced = new Set<string>();
  for (const event of events) {
    if (event.type === "delete") deleted.add(event.body.target);
    if (event.type === "post" && event.body.replaces) replaced.add(event.body.replaces);
  }
  return events
    .filter((event): event is Envelope & { type: "post" } => event.type === "post")
    .filter((event) => !author || event.author === author)
    .filter((event) => Boolean(event.sig) && !deleted.has(event.sig) && !replaced.has(event.sig))
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
}

export function rootPostTs(events: readonly Envelope[], post: Envelope): number {
  if (post.type !== "post") return post.ts;
  const bySig = new Map(
    events.filter((event) => event.type === "post" && event.sig).map((event) => [event.sig, event]),
  );
  let current = post;
  const seen = new Set<string>();
  while (current.type === "post" && current.body.replaces && current.sig && !seen.has(current.sig)) {
    seen.add(current.sig);
    const previous = bySig.get(current.body.replaces);
    if (!previous || previous.type !== "post") break;
    current = previous;
  }
  return current.ts;
}

export function canEditPost(events: readonly Envelope[], post: Envelope, now = Date.now()): boolean {
  return post.type === "post" && now - rootPostTs(events, post) <= EDIT_WINDOW_MS;
}

export function postLineageSigs(events: Envelope[], post: Envelope): string[] {
  if (post.type !== "post" || !post.sig) return [];
  const bySig = new Map(
    events.filter((event) => event.type === "post" && event.sig).map((event) => [event.sig, event]),
  );
  const sigs: string[] = [];
  let current: Envelope | undefined = post;
  const seen = new Set<string>();
  while (current?.type === "post" && current.sig && !seen.has(current.sig)) {
    seen.add(current.sig);
    sigs.push(current.sig);
    current = current.body.replaces ? bySig.get(current.body.replaces) : undefined;
  }
  return sigs;
}

export function allEnvelopes(): readonly Envelope[] {
  return allEnvelopesCached();
}

export function commentsOf(all: readonly Envelope[], postSig: string): Envelope[] {
  const deleted = new Set<string>();
  const replaced = new Set<string>();
  for (const event of all) {
    if (event.type === "delete") deleted.add(event.body.target);
    if (event.type === "comment" && event.body.replaces) replaced.add(event.body.replaces);
  }
  return all
    .filter((event) => event.type === "comment" && event.body.target === postSig)
    .filter((event) => Boolean(event.sig) && !deleted.has(event.sig) && !replaced.has(event.sig))
    .sort((a, b) => a.ts - b.ts);
}

export function rootCommentTs(events: readonly Envelope[], comment: Envelope): number {
  if (comment.type !== "comment") return comment.ts;
  const bySig = new Map(
    events.filter((event) => event.type === "comment" && event.sig).map((event) => [event.sig, event]),
  );
  let current = comment;
  const seen = new Set<string>();
  while (current.type === "comment" && current.body.replaces && current.sig && !seen.has(current.sig)) {
    seen.add(current.sig);
    const previous = bySig.get(current.body.replaces);
    if (!previous || previous.type !== "comment") break;
    current = previous;
  }
  return current.ts;
}

export function canMutateComment(events: readonly Envelope[], comment: Envelope, now = Date.now()): boolean {
  return comment.type === "comment" && now - rootCommentTs(events, comment) <= EDIT_WINDOW_MS;
}

export function commentLineageSigs(events: Envelope[], comment: Envelope): string[] {
  if (comment.type !== "comment" || !comment.sig) return [];
  const bySig = new Map(
    events.filter((event) => event.type === "comment" && event.sig).map((event) => [event.sig, event]),
  );
  const sigs: string[] = [];
  let current: Envelope | undefined = comment;
  const seen = new Set<string>();
  while (current?.type === "comment" && current.sig && !seen.has(current.sig)) {
    seen.add(current.sig);
    sigs.push(current.sig);
    current = current.body.replaces ? bySig.get(current.body.replaces) : undefined;
  }
  return sigs;
}

export function reportsOf(all: readonly Envelope[], target: string): Set<string> {
  const latest = new Map<string, boolean>();
  for (const event of all) {
    if (event.type !== "report" || event.body.target !== target) continue;
    latest.set(event.author, event.body.on !== false);
  }
  const authors = new Set<string>();
  for (const [author, on] of latest) if (on) authors.add(author);
  return authors;
}

export function isHiddenByReports(
  all: Envelope[],
  target: string,
  opts?: { author?: string; me?: string | null; follows?: string[] },
): boolean {
  const young =
    Boolean(opts?.author) &&
    isQuarantined(all, opts?.author ?? "", opts?.me ?? null, opts?.follows ?? []);
  return reportsOf(all, target).size >= reportHideAfter(young);
}

export function reportedByMe(all: readonly Envelope[], target: string, me: string | null): boolean {
  return Boolean(me && reportsOf(all, target).has(me));
}

export function imageTarget(postSig: string, hash: string): string {
  return `image:${postSig}:${hash}`;
}

export function latestBlocks(log: Envelope[]): string[] {
  const found = log.filter((item) => item.type === "blocks").at(-1);
  return found && found.type === "blocks" ? found.body.rpubs : [];
}

export function isOnline(all: readonly Envelope[], rpub: string, now = Date.now()): boolean {
  let last = 0;
  for (const event of all) {
    if (event.author !== rpub) continue;
    if (event.type === "presence" || event.type === "post" || event.type === "comment" || event.type === "like") {
      last = Math.max(last, event.ts);
    }
  }
  return now - last < PRESENCE_MS;
}
