import { loadBetaInvite, saveBetaInvite } from "./betaInvite";
import { wipeMediaStore } from "./media";
import { resetMeshState } from "./mesh";
import { resetLogCache } from "./store";

const PREFIX = "magicrita.";

function ritaKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

function dropStorage(storage: Storage): void {
  for (const key of ritaKeys(storage)) storage.removeItem(key);
}

export function purgeForeignIdentities(keepRpub: string): void {
  const suffixes = ["log.", "saves.", "notices.", "pow."];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const rest = key.slice(PREFIX.length);
    const scoped = suffixes.find((item) => rest.startsWith(item));
    if (!scoped) continue;
    const rpub = rest.slice(scoped.length);
    if (rpub && rpub !== keepRpub) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
  resetLogCache();
}

export async function wipeBrowserRita(): Promise<void> {
  resetMeshState();
  resetLogCache();
  dropStorage(localStorage);
  try {
    dropStorage(sessionStorage);
  } catch {
    // ignore
  }
  await wipeMediaStore();
  if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
    try {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs
          .filter((db) => db.name && db.name.startsWith("magicrita"))
          .map(
            (db) =>
              new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(db.name as string);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              }),
          ),
      );
    } catch {
      // ignore
    }
  }
}

export async function wipeRitaPreservingInvite(): Promise<void> {
  const invite = loadBetaInvite();
  await wipeBrowserRita();
  if (invite) saveBetaInvite(invite);
}
