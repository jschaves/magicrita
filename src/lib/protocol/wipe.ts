import { wipeMediaStore } from "./media";
import { stopMesh } from "./mesh";
import { SIGNUP_KEEP } from "./signupGuard";

const KEEP = SIGNUP_KEEP;

export async function wipeBrowserRita(): Promise<void> {
  stopMesh();
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("magicrita.") && !KEEP.has(key)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
  try {
    sessionStorage.removeItem("magicrita.unlocked");
  } catch {
    // ignore
  }
  await wipeMediaStore();
}
