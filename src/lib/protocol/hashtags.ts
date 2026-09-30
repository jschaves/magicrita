import type { Envelope } from "./envelope";
import { stripBlobText } from "./media";

const HASHTAG_SOURCE = "(?<![\\p{L}\\p{N}_])#([\\p{L}\\p{N}_]{1,64})";

export type TextToken = { text: string; tag?: string };

export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").trim().toLowerCase();
}

export function tokenizeHashtags(text: string): TextToken[] {
  if (!text) return [];
  const re = new RegExp(HASHTAG_SOURCE, "gu");
  const tokens: TextToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null = re.exec(text);
  while (match) {
    if (match.index > cursor) tokens.push({ text: text.slice(cursor, match.index) });
    tokens.push({ text: match[0], tag: normalizeTag(match[1]) });
    cursor = match.index + match[0].length;
    match = re.exec(text);
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor) });
  return tokens;
}

export function textHasHashtag(text: string, tag: string): boolean {
  const wanted = normalizeTag(tag);
  if (!wanted) return false;
  return tokenizeHashtags(stripBlobText(text)).some((token) => token.tag === wanted);
}

export function filterPostsByTag<T extends { event: Envelope }>(
  items: T[],
  tag: string,
  commentsOf: (postSig: string) => readonly Envelope[],
): T[] {
  const wanted = normalizeTag(tag);
  if (!wanted) return items;
  return items.filter((item) => {
    const event = item.event;
    if (event.type !== "post" || !event.sig) return false;
    if (textHasHashtag(event.body.text, wanted)) return true;
    return commentsOf(event.sig).some(
      (comment) => comment.type === "comment" && textHasHashtag(comment.body.text, wanted),
    );
  });
}
