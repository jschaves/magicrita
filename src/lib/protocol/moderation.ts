const PATTERNS = [
  "nazi",
  "nazis",
  "hitler",
  "kkk",
  "lynchar",
  "linchar",
  "genocidio",
  "genocide",
  "esclavos de mierda",
  "muerte a",
  "kill all",
  "white power",
  "heil ",
  "nigga",
  "nigger",
  "faggot",
  "maricón de mierda",
  "sudaca de mierda",
  "indio de mierda",
  "moro de mierda",
  "negro de mierda",
  "puta raza",
  "raza inferior",
  "subhumano",
  "subhumana",
  "exterminar",
  "gas the",
  "hate crime",
  "xenofob",
  "inmigrante de mierda",
  "refugiado de mierda",
];

const regexes = PATTERNS.map(
  (word) => new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
);

export function isFlaggedText(text: string): boolean {
  return regexes.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

export type TextPart = { text: string; flagged: boolean };

export function splitFlagged(text: string): TextPart[] {
  if (!text) return [];
  const hits: { start: number; end: number }[] = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null = re.exec(text);
    while (match) {
      hits.push({ start: match.index, end: match.index + match[0].length });
      if (!re.global) break;
      match = re.exec(text);
    }
  }
  if (hits.length === 0) return [{ text, flagged: false }];
  hits.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const hit of hits) {
    const last = merged.at(-1);
    if (last && hit.start <= last.end) last.end = Math.max(last.end, hit.end);
    else merged.push({ ...hit });
  }
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const hit of merged) {
    if (hit.start > cursor) parts.push({ text: text.slice(cursor, hit.start), flagged: false });
    parts.push({ text: text.slice(hit.start, hit.end), flagged: true });
    cursor = hit.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), flagged: false });
  return parts;
}
