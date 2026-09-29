import { hexToBytes, utf8ToBytes } from "./bytes";
import { parseRpub, verifyBytes } from "./identity";
import {
  ICE_SERVERS,
  liveRpubs,
  onLiveSignal,
  sendLiveSignal,
  selfRpub,
  signWithSelf,
  type LiveSignal,
} from "./mesh";

/**
 * Directos efímeros. **No se guarda nada**: ni en el dispositivo ni en el relé.
 * El que emite captura cámara y micro y anuncia (id, título, inicio) por
 * `signal`; cada espectador abre una conexión P2P de una dirección con el
 * emisor (un `RTCPeerConnection` por espectador). Al terminar, todo se cierra y
 * desaparece. El relé solo reenvía la señalización, firmada con la `rsec`.
 *
 * Estado en RAM, expuesto con `subscribe`/`getSnapshot` para React.
 */

export type LiveInfo = {
  id: string;
  host: string;
  title: string;
  startedAt: number;
  seenAt: number;
};

export type LiveSession =
  | { role: "broadcast"; id: string; title: string; local: MediaStream; viewers: number }
  | { role: "viewing"; id: string; host: string; remote: MediaStream | null }
  | null;

export type LiveSnapshot = {
  lives: LiveInfo[];
  session: LiveSession;
};

const LIVE_DOMAIN = "rita-live-v1";
/** Un anuncio sin refresco en este tiempo se considera terminado. */
const ANNOUNCE_TTL_MS = 15_000;
const ANNOUNCE_EVERY_MS = 5_000;

type Broadcast = {
  id: string;
  title: string;
  startedAt: number;
  local: MediaStream;
  pcs: Map<string, RTCPeerConnection>;
  timer: number;
};

type Viewing = {
  id: string;
  host: string;
  pc: RTCPeerConnection;
  remote: MediaStream | null;
  queuedIce: RTCIceCandidateInit[];
};

const lives = new Map<string, LiveInfo>();
let broadcast: Broadcast | null = null;
let viewing: Viewing | null = null;
let pruneTimer = 0;

const listeners = new Set<() => void>();
let snapshot: LiveSnapshot = { lives: [], session: null };

function emit() {
  snapshot = {
    lives: [...lives.values()],
    session: broadcast
      ? {
          role: "broadcast",
          id: broadcast.id,
          title: broadcast.title,
          local: broadcast.local,
          viewers: broadcast.pcs.size,
        }
      : viewing
        ? { role: "viewing", id: viewing.id, host: viewing.host, remote: viewing.remote }
        : null,
  };
  for (const listener of listeners) listener();
}

export function subscribeLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLiveSnapshot(): LiveSnapshot {
  return snapshot;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function iceJson(candidate: RTCIceCandidate): RTCIceCandidateInit {
  if (typeof candidate.toJSON === "function") return candidate.toJSON();
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

function bodyOf(signal: LiveSignal): string {
  if (signal.kind === "announce") return `${signal.title ?? ""}\n${signal.startedAt ?? 0}`;
  if (signal.desc) return `${signal.desc.type ?? ""}\n${signal.desc.sdp ?? ""}`;
  if (signal.cand) return signal.cand.candidate ?? "";
  return "";
}

function canonical(id: string, to: string, rpub: string, kind: string, body: string): string {
  return [LIVE_DOMAIN, id, to, rpub, kind, body].join("\n");
}

function sendSigned(to: string, partial: LiveSignal): void {
  const me = selfRpub();
  if (!me) return;
  const sig = signWithSelf(canonical(partial.id, to, me, partial.kind, bodyOf(partial)));
  if (!sig) return;
  sendLiveSignal(to, { ...partial, rpub: me, sig });
}

function verifyIncoming(from: string, signal: LiveSignal): boolean {
  if (!signal || typeof signal.id !== "string" || typeof signal.sig !== "string") return false;
  if (signal.rpub !== from) return false;
  const me = selfRpub();
  if (!me) return false;
  try {
    const message = utf8ToBytes(canonical(signal.id, me, from, signal.kind, bodyOf(signal)));
    return verifyBytes(parseRpub(from), message, hexToBytes(signal.sig));
  } catch {
    return false;
  }
}

function broadcastSigned(partial: LiveSignal): void {
  for (const to of liveRpubs()) sendSigned(to, partial);
}

async function getMedia(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("live_insecure");
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch {
    throw new Error("live_denied");
  }
}

const pendingIce = new WeakMap<RTCPeerConnection, RTCIceCandidateInit[]>();

function flushIce(pc: RTCPeerConnection): void {
  const queued = pendingIce.get(pc);
  if (!queued) return;
  pendingIce.delete(pc);
  for (const cand of queued) void pc.addIceCandidate(cand).catch(() => undefined);
}

function newPc(peer: string, id: string): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (event) => {
    if (event.candidate) sendSigned(peer, { id, kind: "cand", cand: iceJson(event.candidate) });
  };
  return pc;
}

function pcFor(from: string, id: string): RTCPeerConnection | null {
  if (broadcast && broadcast.id === id) return broadcast.pcs.get(from) ?? null;
  if (viewing && viewing.id === id && viewing.host === from) return viewing.pc;
  return null;
}

function pruneExpired() {
  const now = Date.now();
  let changed = false;
  for (const [id, info] of lives) {
    if (now - info.seenAt > ANNOUNCE_TTL_MS) {
      lives.delete(id);
      changed = true;
      if (viewing?.id === id) endViewing();
    }
  }
  if (changed) emit();
  if (lives.size === 0 && pruneTimer) {
    window.clearInterval(pruneTimer);
    pruneTimer = 0;
  }
}

function rememberPrune() {
  if (!pruneTimer) pruneTimer = window.setInterval(pruneExpired, 5_000);
}

function endViewing() {
  if (!viewing) return;
  const pc = viewing.pc;
  viewing = null;
  try {
    pc.close();
  } catch {
    // ya cerrado
  }
}

function announce() {
  if (!broadcast) return;
  broadcastSigned({
    id: broadcast.id,
    kind: "announce",
    title: broadcast.title,
    startedAt: broadcast.startedAt,
  });
}

export async function startBroadcast(title: string): Promise<void> {
  if (broadcast || viewing) throw new Error("live_busy");
  if (!selfRpub()) throw new Error("live_offline");
  const local = await getMedia();
  if (broadcast || viewing) {
    for (const track of local.getTracks()) track.stop();
    throw new Error("live_busy");
  }
  broadcast = {
    id: newId(),
    title: title.trim().slice(0, 80) || "Directo",
    startedAt: Date.now(),
    local,
    pcs: new Map(),
    timer: 0,
  };
  announce();
  broadcast.timer = window.setInterval(announce, ANNOUNCE_EVERY_MS);
  emit();
}

export function stopBroadcast(): void {
  if (!broadcast) return;
  const session = broadcast;
  broadcast = null;
  for (const to of liveRpubs()) sendSigned(to, { id: session.id, kind: "end" });
  window.clearInterval(session.timer);
  for (const pc of session.pcs.values()) {
    try {
      pc.close();
    } catch {
      // ignore
    }
  }
  for (const track of session.local.getTracks()) track.stop();
  emit();
}

export function requestLives(): void {
  const me = selfRpub();
  if (!me) return;
  const id = newId();
  for (const to of liveRpubs()) sendSigned(to, { id, kind: "discover" });
}

export async function joinLive(id: string): Promise<void> {
  const info = lives.get(id);
  if (!info) return;
  if (broadcast || viewing) throw new Error("live_busy");
  viewing = { id, host: info.host, pc: newPc(info.host, id), remote: null, queuedIce: [] };
  sendSigned(info.host, { id, kind: "join" });
  emit();
}

export function leaveLive(): void {
  if (!viewing) return;
  const session = viewing;
  sendSigned(session.host, { id: session.id, kind: "leave" });
  endViewing();
  emit();
}

async function onJoin(from: string, signal: LiveSignal): Promise<void> {
  if (!broadcast || broadcast.id !== signal.id) return;
  let pc = broadcast.pcs.get(from);
  if (pc && pc.connectionState !== "closed") {
    // Ya hay una conexión; reenvía la oferta por si el join se repitió.
  } else {
    pc = newPc(from, broadcast.id);
    broadcast.pcs.set(from, pc);
    pc.onconnectionstatechange = () => {
      if (pc!.connectionState === "failed" || pc!.connectionState === "closed") {
        try {
          pc!.close();
        } catch {
          // ignore
        }
        broadcast?.pcs.delete(from);
        emit();
      }
    };
    for (const track of broadcast.local.getTracks()) pc.addTrack(track, broadcast.local);
  }
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSigned(from, { id: broadcast.id, kind: "offer", desc: pc.localDescription ?? offer });
  emit();
}

async function onOffer(from: string, signal: LiveSignal): Promise<void> {
  if (!viewing || viewing.id !== signal.id || viewing.host !== from || !signal.desc) return;
  const session = viewing;
  const pc = session.pc;
  pc.ontrack = (event) => {
    if (viewing !== session) return;
    session.remote = event.streams[0] ?? new MediaStream([event.track]);
    emit();
  };
  await pc.setRemoteDescription(signal.desc);
  flushIce(pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSigned(session.host, { id: session.id, kind: "answer", desc: pc.localDescription ?? answer });
}

async function onAnswer(from: string, signal: LiveSignal): Promise<void> {
  if (!broadcast || broadcast.id !== signal.id || !signal.desc) return;
  const pc = broadcast.pcs.get(from);
  if (!pc) return;
  await pc.setRemoteDescription(signal.desc);
  flushIce(pc);
}

function onCand(from: string, signal: LiveSignal): void {
  if (!signal.cand) return;
  const pc = pcFor(from, signal.id);
  if (!pc) return;
  if (!pc.remoteDescription) {
    const queued = pendingIce.get(pc) ?? [];
    queued.push(signal.cand);
    pendingIce.set(pc, queued);
    return;
  }
  void pc.addIceCandidate(signal.cand).catch(() => undefined);
}

function handleSignal(from: string, signal: LiveSignal) {
  if (!verifyIncoming(from, signal)) return;
  switch (signal.kind) {
    case "announce": {
      if (typeof signal.startedAt !== "number" || from === selfRpub()) return;
      lives.set(signal.id, {
        id: signal.id,
        host: from,
        title: (signal.title ?? "Directo").slice(0, 80),
        startedAt: signal.startedAt,
        seenAt: Date.now(),
      });
      rememberPrune();
      emit();
      return;
    }
    case "discover": {
      announce();
      return;
    }
    case "end": {
      if (lives.delete(signal.id)) emit();
      if (viewing?.id === signal.id) {
        endViewing();
        emit();
      }
      if (broadcast?.id === signal.id) return;
      return;
    }
    case "join":
      void onJoin(from, signal);
      return;
    case "leave": {
      if (!broadcast || broadcast.id !== signal.id) return;
      const pc = broadcast.pcs.get(from);
      if (pc) {
        try {
          pc.close();
        } catch {
          // ignore
        }
        broadcast.pcs.delete(from);
        emit();
      }
      return;
    }
    case "offer":
      void onOffer(from, signal);
      return;
    case "answer":
      void onAnswer(from, signal);
      return;
    case "cand":
      onCand(from, signal);
      return;
  }
}

onLiveSignal(handleSignal);

/** Al cerrar sesión o borrar la identidad: corta cualquier directo. */
export function resetLive(): void {
  if (broadcast) stopBroadcast();
  if (viewing) {
    endViewing();
    emit();
  }
  lives.clear();
  emit();
}
