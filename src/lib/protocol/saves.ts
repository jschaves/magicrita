function key(rpub: string): string {
  return `magicrita.saves.${rpub}`;
}

export function loadSaves(rpub: string): string[] {
  try {
    const raw = localStorage.getItem(key(rpub));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function saveSaves(rpub: string, ids: string[]): void {
  localStorage.setItem(key(rpub), JSON.stringify([...new Set(ids)]));
}

export function dropSavedPosts(postSigs: string[]): void {
  if (postSigs.length === 0) return;
  const drop = new Set(postSigs);
  const prefix = "magicrita.saves.";
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const item = localStorage.key(i);
    if (item?.startsWith(prefix)) keys.push(item);
  }
  for (const item of keys) {
    try {
      const parsed = JSON.parse(localStorage.getItem(item) ?? "[]") as unknown;
      if (!Array.isArray(parsed)) continue;
      const next = parsed.filter((id) => typeof id === "string" && !drop.has(id));
      localStorage.setItem(item, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
}

export function toggleSaved(rpub: string, target: string): string[] {
  const current = loadSaves(rpub);
  const next = current.includes(target) ? current.filter((id) => id !== target) : [...current, target];
  saveSaves(rpub, next);
  return next;
}
