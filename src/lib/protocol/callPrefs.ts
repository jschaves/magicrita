/**
 * Política local de llamadas. Vive solo en este dispositivo (nada va al relé) y
 * decide a la vez quién puede llamarte y para quién ves el botón de llamar. Hay
 * una política para llamadas de audio y otra para videollamadas. Por defecto,
 * nadie.
 */
export type CallPolicy = "nobody" | "follows" | "everyone";

export type CallMedia = "audio" | "video";

const KEYS: Record<CallMedia, string> = {
  audio: "magicrita.callPolicy",
  video: "magicrita.videoCallPolicy",
};

export const CALL_POLICIES: CallPolicy[] = ["nobody", "follows", "everyone"];

export function loadCallPolicy(media: CallMedia): CallPolicy {
  try {
    const value = localStorage.getItem(KEYS[media]);
    if (value === "nobody" || value === "follows" || value === "everyone") return value;
  } catch {
    // ignore
  }
  return "nobody";
}

export function saveCallPolicy(media: CallMedia, policy: CallPolicy): void {
  try {
    localStorage.setItem(KEYS[media], policy);
  } catch {
    // ignore
  }
}

/** Override por contacto: "allow" / "deny" mandan sobre la política general. */
export type PeerCallOverride = "allow" | "deny";

const PEER_PREFIX = "magicrita.callPeer.";

export function loadPeerCall(media: CallMedia, peer: string): PeerCallOverride | null {
  try {
    const value = localStorage.getItem(`${PEER_PREFIX}${media}.${peer}`);
    if (value === "allow" || value === "deny") return value;
  } catch {
    // ignore
  }
  return null;
}

export function savePeerCall(media: CallMedia, peer: string, value: PeerCallOverride | null): void {
  try {
    const key = `${PEER_PREFIX}${media}.${peer}`;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
