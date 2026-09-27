/**
 * Política local de llamadas de voz. Vive solo en este dispositivo (nada va al
 * relé) y decide a la vez quién puede llamarte y para quién ves el botón de
 * llamar. Por defecto, nadie.
 */
export type CallPolicy = "nobody" | "follows" | "everyone";

const KEY = "magicrita.callPolicy";

export const CALL_POLICIES: CallPolicy[] = ["nobody", "follows", "everyone"];

export function loadCallPolicy(): CallPolicy {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "nobody" || value === "follows" || value === "everyone") return value;
  } catch {
    // ignore
  }
  return "nobody";
}

export function saveCallPolicy(policy: CallPolicy): void {
  try {
    localStorage.setItem(KEY, policy);
  } catch {
    // ignore
  }
}
