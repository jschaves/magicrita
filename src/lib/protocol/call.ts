import { ICE_SERVERS, isPeerLive, onCallSignal, publishCallPerms, selfRpub, sendCallSignal, setCallPermProvider, signWithSelf, type CallSignal } from "./mesh";
import { hexToBytes, utf8ToBytes } from "./bytes";
import { parseRpub, verifyBytes } from "./identity";
import { loadCallPolicy, loadPeerCall, type CallMedia } from "./callPrefs";
import { latestFollows, loadLog } from "./store";

/**
 * Llamada P2P de audio o vídeo.
 *
 * No pasa por el relé más que la señalización (oferta/respuesta/ICE y el
 * "colgar"), reutilizando el mismo mensaje `signal` que los canales de datos.
 * El audio/vídeo va directo entre los dos navegadores. El relé no guarda nada.
 *
 * Cada señal va firmada con la `rsec` y el receptor solo la acepta si la firma
 * cuadra con la identidad del par y está atada a esta llamada y a este
 * destinatario. Así el relé no puede cambiar la huella DTLS del SDP ni inyectar
 * ICE: no tiene la `rsec` de nadie, así que no hay MITM.
 *
 * Solo hay una llamada a la vez. El estado se expone con `subscribe`/`snapshot`
 * para que React lo lea con `useSyncExternalStore`.
 */

export type CallPhase = "outgoing" | "incoming" | "active";

export type CallSnapshot = {
  peer: string;
  phase: CallPhase;
  video: boolean;
  muted: boolean;
  camOff: boolean;
  local: MediaStream | null;
  remote: MediaStream | null;
};

type ActiveCall = {
  peer: string;
  id: string;
  video: boolean;
  phase: CallPhase;
  muted: boolean;
  camOff: boolean;
  caller: boolean;
  pc: RTCPeerConnection;
  local: MediaStream | null;
  remote: MediaStream | null;
  pendingOffer?: RTCSessionDescriptionInit;
  queuedIce: RTCIceCandidateInit[];
  timer: number;
};

let current: ActiveCall | null = null;
let snapshot: CallSnapshot | null = null;
const listeners = new Set<() => void>();

function emit() {
  snapshot = current
    ? {
        peer: current.peer,
        phase: current.phase,
        video: current.video,
        muted: current.muted,
        camOff: current.camOff,
        local: current.local,
        remote: current.remote,
      }
    : null;
  for (const listener of listeners) listener();
}

export function subscribeCall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCallSnapshot(): CallSnapshot | null {
  return snapshot;
}

const RING_MS = 45_000;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const CALL_DOMAIN = "rita-call-v1";

type CallKind = "offer" | "answer" | "cand" | "end" | "decline" | "busy";
type CallBody = Omit<CallSignal, "rpub" | "sig">;

function kindOf(call: CallBody): CallKind | null {
  if (call.desc?.type === "offer") return "offer";
  if (call.desc?.type === "answer") return "answer";
  if (call.cand) return "cand";
  if (call.end) return "end";
  if (call.decline) return "decline";
  if (call.busy) return "busy";
  return null;
}

function bodyOf(call: CallBody, kind: CallKind): string {
  if (kind === "offer" || kind === "answer") {
    return `${call.desc?.type ?? ""}\n${call.desc?.sdp ?? ""}`;
  }
  if (kind === "cand") {
    return `${call.cand?.candidate ?? ""}\n${call.cand?.sdpMid ?? ""}\n${call.cand?.sdpMLineIndex ?? ""}\n${call.cand?.usernameFragment ?? ""}`;
  }
  return "";
}

function canonicalCall(id: string, to: string, rpub: string, video: boolean, kind: CallKind, body: string): string {
  return [CALL_DOMAIN, id, to, rpub, video ? "v" : "a", kind, body].join("\n");
}

/** Firma la señal con la `rsec`; sin sesión no se firma y no se envía. */
function sendSigned(to: string, partial: CallBody): void {
  const kind = kindOf(partial);
  const me = selfRpub();
  if (!kind || !me) return;
  const sig = signWithSelf(
    canonicalCall(partial.id, to, me, Boolean(partial.video), kind, bodyOf(partial, kind)),
  );
  if (!sig) return;
  sendCallSignal(to, { ...partial, rpub: me, sig });
}

/**
 * Solo se acepta una señal firmada por la identidad del par y atada a esta
 * conversación (`to` = nuestro `rpub` y el `id` de la llamada). Así el relé no
 * puede cambiar la huella DTLS del SDP ni inyectar candidatos ICE.
 */
function verifyIncoming(from: string, call: CallSignal): boolean {
  if (!call || typeof call.id !== "string" || typeof call.sig !== "string") return false;
  if (call.rpub !== from) return false;
  const kind = kindOf(call);
  const me = selfRpub();
  if (!kind || !me) return false;
  try {
    const message = utf8ToBytes(
      canonicalCall(call.id, me, from, Boolean(call.video), kind, bodyOf(call, kind)),
    );
    return verifyBytes(parseRpub(from), message, hexToBytes(call.sig));
  } catch {
    return false;
  }
}

/**
 * ¿La política general permite llamadas (de audio o vídeo) con `peer`? Con
 * `follows` exige seguimiento mutuo. Decide si se muestra el botón de llamar.
 */
export function canCallPeer(media: CallMedia, peer: string): boolean {
  const policy = loadCallPolicy(media);
  if (policy === "everyone") return true;
  if (policy === "nobody") return false;
  const me = selfRpub();
  if (!me) return false;
  if (!latestFollows(loadLog(me)).includes(peer)) return false;
  return latestFollows(loadLog(peer)).includes(me);
}

/**
 * ¿Puedo recibir llamadas (de audio o vídeo) de `peer`? El override por
 * contacto manda sobre la política general; sin override, aplica la general.
 */
export function canReceiveFrom(media: CallMedia, peer: string): boolean {
  const override = loadPeerCall(media, peer);
  if (override === "allow") return true;
  if (override === "deny") return false;
  return canCallPeer(media, peer);
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

async function getMedia(video: boolean): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("call_insecure");
  try {
    return await navigator.mediaDevices.getUserMedia(
      video ? { audio: true, video: true } : { audio: true },
    );
  } catch {
    throw new Error(video ? "video_denied" : "call_denied");
  }
}

function newPc(peer: string): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (event) => {
    if (event.candidate && current && current.pc === pc) {
      sendSigned(peer, { id: current.id, video: current.video, cand: iceJson(event.candidate) });
    }
  };
  pc.ontrack = (event) => {
    if (!current || current.pc !== pc) return;
    current.remote = event.streams[0] ?? new MediaStream([event.track]);
    emit();
  };
  pc.onconnectionstatechange = () => {
    if (!current || current.pc !== pc) return;
    if (pc.connectionState === "connected") {
      window.clearTimeout(current.timer);
      current.timer = 0;
      current.phase = "active";
      emit();
    } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      cleanup(true);
    }
  };
  return pc;
}

function flushIce(call: ActiveCall) {
  const queued = call.queuedIce.splice(0);
  for (const cand of queued) {
    void call.pc.addIceCandidate(cand).catch(() => undefined);
  }
}

/** Cierra la llamada. `notify` avisa al otro extremo de que se colgó. */
function cleanup(notify: boolean) {
  const call = current;
  current = null;
  if (call) {
    if (notify) sendSigned(call.peer, { id: call.id, video: call.video, end: true });
    window.clearTimeout(call.timer);
    try {
      call.pc.close();
    } catch {
      // ya cerrado
    }
    if (call.local) {
      for (const track of call.local.getTracks()) track.stop();
    }
  }
  emit();
}

export function isCallActive(): boolean {
  return current !== null;
}

/** El que llama: pide micro (y cámara), monta la oferta y la firma al otro extremo. */
export async function startCall(peer: string, video = false): Promise<void> {
  if (current) return;
  if (!isPeerLive(peer)) throw new Error("call_offline");
  const local = await getMedia(video);
  const id = newId();
  current = {
    peer,
    id,
    video,
    phase: "outgoing",
    muted: false,
    camOff: false,
    caller: true,
    pc: newPc(peer),
    local,
    remote: null,
    queuedIce: [],
    timer: 0,
  };
  try {
    for (const track of local.getTracks()) current.pc.addTrack(track, local);
    const offer = await current.pc.createOffer();
    await current.pc.setLocalDescription(offer);
    if (!current || current.id !== id) return;
    sendSigned(peer, { id, video, desc: current.pc.localDescription ?? offer });
    emit();
    current.timer = window.setTimeout(() => {
      if (current?.id === id && current.phase === "outgoing") cleanup(true);
    }, RING_MS);
  } catch (error) {
    cleanup(true);
    throw error;
  }
}

/** El que recibe: acepta, pide micro (y cámara), responde la oferta pendiente. */
export async function acceptCall(): Promise<void> {
  const call = current;
  if (!call || call.phase !== "incoming" || !call.pendingOffer) return;
  const local = await getMedia(call.video);
  if (current !== call) {
    for (const track of local.getTracks()) track.stop();
    return;
  }
  call.local = local;
  window.clearTimeout(call.timer);
  call.timer = 0;
  try {
    for (const track of local.getTracks()) call.pc.addTrack(track, local);
    await call.pc.setRemoteDescription(call.pendingOffer);
    call.pendingOffer = undefined;
    flushIce(call);
    const answer = await call.pc.createAnswer();
    await call.pc.setLocalDescription(answer);
    if (current !== call) return;
    sendSigned(call.peer, { id: call.id, video: call.video, desc: call.pc.localDescription ?? answer });
    call.phase = "active";
    emit();
  } catch (error) {
    cleanup(true);
    throw error;
  }
}

export function declineCall(): void {
  if (current?.phase !== "incoming") return;
  const call = current;
  current = null;
  sendSigned(call.peer, { id: call.id, video: call.video, decline: true });
  window.clearTimeout(call.timer);
  try {
    call.pc.close();
  } catch {
    // ignore
  }
  emit();
}

export function endCall(): void {
  cleanup(true);
}

export function toggleMute(): void {
  if (!current || !current.local) return;
  current.muted = !current.muted;
  for (const track of current.local.getAudioTracks()) track.enabled = !current.muted;
  emit();
}

export function toggleCam(): void {
  if (!current || !current.local || !current.video) return;
  current.camOff = !current.camOff;
  for (const track of current.local.getVideoTracks()) track.enabled = !current.camOff;
  emit();
}

function handleSignal(from: string, call: CallSignal) {
  if (!call || typeof call.id !== "string") return;
  // Firma del par obligatoria: sin esto el relé podría falsear la llamada.
  if (!verifyIncoming(from, call)) return;

  const video = Boolean(call.video);

  if (call.end || call.decline || call.busy) {
    if (current && current.id === call.id) cleanup(false);
    return;
  }

  if (call.desc?.type === "offer") {
    // Ya hay una llamada: se contesta ocupado salvo que sea de la misma.
    if (current) {
      if (current.id !== call.id) sendSigned(from, { id: call.id, video, busy: true });
      return;
    }
    // La política (con el override por contacto) decide si puede llamarme.
    if (!canReceiveFrom(video ? "video" : "audio", from)) {
      sendSigned(from, { id: call.id, video, busy: true });
      return;
    }
    const pc = newPc(from);
    current = {
      peer: from,
      id: call.id,
      video,
      phase: "incoming",
      muted: false,
      camOff: false,
      caller: false,
      pc,
      local: null,
      remote: null,
      pendingOffer: call.desc,
      queuedIce: [],
      timer: 0,
    };
    if (call.cand) current.queuedIce.push(call.cand);
    current.timer = window.setTimeout(() => declineCall(), RING_MS);
    emit();
    return;
  }

  if (call.desc?.type === "answer") {
    const call2 = current;
    if (!call2 || !call2.caller || call2.id !== call.id || call2.pc.signalingState === "closed") return;
    void (async () => {
      try {
        await call2.pc.setRemoteDescription(call.desc!);
        flushIce(call2);
        call2.phase = "active";
        emit();
      } catch {
        cleanup(true);
      }
    })();
    return;
  }

  if (call.cand) {
    const call3 = current;
    if (!call3 || call3.id !== call.id) return;
    if (!call3.pc.remoteDescription) call3.queuedIce.push(call.cand);
    else void call3.pc.addIceCandidate(call.cand).catch(() => undefined);
  }
}

onCallSignal(handleSignal);

// El mesh pide el permiso al abrir un canal; aquí se calcula con la política
// general más el override por contacto. `notifyCallPerms` lo reenvía tras un
// cambio para que el otro extremo oculte/muestre sus iconos.
setCallPermProvider((rpub) => ({
  audio: canReceiveFrom("audio", rpub),
  video: canReceiveFrom("video", rpub),
}));

export function notifyCallPerms(): void {
  publishCallPerms();
}

export { getPeerCallPerm, onPeerCallPerm, type CallPerm } from "./mesh";
