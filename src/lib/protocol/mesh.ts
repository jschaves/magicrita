import { base64ToBytes, bytesToBase64, bytesToHex, concatBytes, utf8ToBytes } from "./bytes";
import { isEnvelope, mediaRefsOf, verifyEnvelope, canonicalJson, type Envelope } from "./envelope";
import { signBytes } from "./identity";
import {
  loadMediaRecord,
  loadPreview,
  mqKey,
  notifyMedia,
  putMediaBytes,
  putMediaTier,
  storeClip,
  rememberPreview,
  type MediaRef,
} from "./media";
import { loadSignalUrl } from "./signalUrl";
import { clearBetaInvite } from "./betaInvite";
import { clearVaultInvite } from "./vault";
import { cachedPow } from "./pow";
import {
  clearAssemblyLog,
  installDiagHook,
  noteAssembly,
  tick,
  type AssemblyVia,
} from "./diagnostics";

import { recipientsOf } from "./store";

const OUTBOX_MAX = 250;
const OUTBOX_KEY = "magicrita.outbox";
/**
 * STUN revela tu IP publica al proveedor y a los pares (es inherente a WebRTC).
 * Se puede apuntar a un servidor propio con `VITE_STUN_URL`.
 */
const STUN_URL =
  (import.meta.env.VITE_STUN_URL as string | undefined)?.trim() || "stun:stun.cloudflare.com:3478";
const STUN = [{ urls: STUN_URL }];
/** Mismos servidores ICE para los canales de datos y para la llamada de voz. */
export const ICE_SERVERS = STUN;

export type MeshPacket = {
  envelope: Envelope;
  media?: Array<MediaRef & { data: string }>;
};

export type LivePeer = {
  rpub: string;
  name: string;
  interests: string[];
  avatar?: string;
};

/** Señalización de una llamada de voz o vídeo, viaja dentro del mismo `signal` del relé. */
export type CallSignal = {
  id: string;
  /** Identidad que firma la señal; el receptor exige que coincida con el `from` del relé. */
  rpub?: string;
  /** Ed25519 sobre `canonicalCall`; ata el SDP/ICE a la `rsec`, no al relé. */
  sig?: string;
  /** Llamada de vídeo (o de audio si es falso). Va firmado. */
  video?: boolean;
  desc?: RTCSessionDescriptionInit;
  cand?: RTCIceCandidateInit;
  end?: boolean;
  decline?: boolean;
  busy?: boolean;
};

/**
 * Señalización de un directo, efímera: viaja dentro del mismo `signal` del relé
 * y nunca se guarda. Un directo es un anuncio (id, título, inicio) y, por cada
 * espectador, una conexión P2P de una sola dirección.
 */
export type LiveSignal = {
  id: string;
  rpub?: string;
  sig?: string;
  kind: "announce" | "discover" | "end" | "join" | "leave" | "offer" | "answer" | "cand";
  title?: string;
  startedAt?: number;
  desc?: RTCSessionDescriptionInit;
  cand?: RTCIceCandidateInit;
};

type SignalIn =
  | { type: "peers"; peers: LivePeer[] }
  | { type: "join"; peer: LivePeer }
  | { type: "leave"; rpub: string }
  | {
      type: "signal";
      from: string;
      payload: {
        desc?: RTCSessionDescriptionInit;
        cand?: RTCIceCandidateInit;
        call?: CallSignal;
        live?: LiveSignal;
      };
    }
  | { type: "held"; envelopes: Envelope[] }
  | { type: "blob"; hash: string; mime?: string; tier?: string; i: number; n: number; size?: number; data: string }
  | { type: "need-blob"; hash: string; from?: string }
  | { type: "pic"; hash: string; mime?: string; data: string }
  | { type: "moderation-changed" }
  | { type: "challenge"; nonce: string }
  | { type: "hello-ok"; rpub?: string }
  | { type: "error"; error?: string };

/** El relay corta el nombre y los intereses; hay que firmar lo mismo que él guarda. */
const HELLO_NAME_MAX = 80;
const HELLO_INTERESTS_MAX = 12;

const channels = new Map<string, RTCDataChannel>();
const pcs = new Map<string, RTCPeerConnection>();
const pendingIce = new Map<string, RTCIceCandidateInit[]>();
const outbox: Envelope[] = [];
const assembling = new Map<
  string,
  { mime: string; name: string; n: number; parts: Array<Uint8Array | undefined>; t: number }
>();
/**
 * Tope de trozos por archivo. Sin esto, `Array(msg.n)` con un n enorme crea un
 * array disperso gigante y, como `some` se salta los huecos, el ensamblaje se
 * da por completo y `concatBytes(...parts)` intenta expandir miles de millones
 * de argumentos. 512 trozos de sobra para cualquier media.
 */
const MAX_CHUNKS = 512;

/**
 * Guardian unico de las cuatro rutas de ensamblaje. Un solo sitio decide y deja
 * constancia, asi no puede quedar una ruta sin cota por descuido.
 */
function chunkGuard(via: AssemblyVia, n: number, i: number, origen: string): boolean {
  const elapsed = tick();
  if (!Number.isInteger(n) || !Number.isInteger(i)) {
    noteAssembly({
      via,
      origen,
      n: Number.isFinite(n) ? n : -1,
      i: Number.isFinite(i) ? i : -1,
      cap: MAX_CHUNKS,
      verdict: "rechazado",
      motivo: "n o i no son enteros",
      ms: elapsed(),
    });
    return false;
  }
  if (n > MAX_CHUNKS) {
    noteAssembly({
      via,
      origen,
      n,
      i,
      cap: MAX_CHUNKS,
      verdict: "rechazado",
      motivo: `n=${n} supera el tope de ${MAX_CHUNKS}`,
      ms: elapsed(),
    });
    return false;
  }
  if (n < 1 || i < 0 || i >= n) {
    noteAssembly({
      via,
      origen,
      n,
      i,
      cap: MAX_CHUNKS,
      verdict: "rechazado",
      motivo: "i fuera de rango",
      ms: elapsed(),
    });
    return false;
  }
  noteAssembly({ via, origen, n, i, cap: MAX_CHUNKS, verdict: "aceptado", motivo: `slot n=${n}`, ms: elapsed() });
  return true;
}

const assemblingPreview = new Map<string, { n: number; parts: Array<string | undefined>; t: number }>();
const assemblingEnv = new Map<string, { n: number; parts: Array<string | undefined>; t: number }>();
const assemblingWs = new Map<
  string,
  { n: number; mime: string; tier: "mq" | "hq"; parts: Array<Uint8Array | undefined>; t: number }
>();
const lastAsk = new Map<string, number>();
const sendChain = new WeakMap<RTCDataChannel, Promise<void>>();
let socket: WebSocket | null = null;
let self: { rpub: string; name: string; interests: string[]; secret: Uint8Array; invite?: string } | null = null;
let challenge = "";
let packetHandler: ((packet: MeshPacket) => void) | null = null;
let peersHandler: ((peers: LivePeer[]) => void) | null = null;
let statusHandler: ((on: boolean) => void) | null = null;
let live: LivePeer[] = [];
let linked = false;
const thumbs = new Map<string, string>();

function rememberThumb(rpub: string, data?: string) {
  if (rpub && data && data.startsWith("data:image/")) thumbs.set(rpub, data);
}

function withThumbs(list: LivePeer[]): LivePeer[] {
  return list.map((peer) => ({
    ...peer,
    avatar: peer.avatar && peer.avatar.startsWith("data:image/") ? peer.avatar : thumbs.get(peer.rpub),
  }));
}

function setLive(next: LivePeer[]) {
  for (const peer of next) rememberThumb(peer.rpub, peer.avatar);
  live = withThumbs(next);
  peersHandler?.(live);
}

let moderationHandler: (() => void) | null = null;

/**
 * El relay avisa de que la moderacion cambio, pero no manda las listas: el
 * cliente vuelve a preguntar por los items que ya tiene.
 */
export function onModeration(handler: () => void): () => void {
  moderationHandler = handler;
  return () => {
    if (moderationHandler === handler) moderationHandler = null;
  };
}

export function onMeshStatus(handler: (on: boolean) => void): () => void {
  statusHandler = handler;
  handler(linked);
  return () => {
    if (statusHandler === handler) statusHandler = null;
  };
}

let callSignalHandler: ((from: string, call: CallSignal) => void) | null = null;

/** Encamina la señalización de llamada que llega por el canal `signal` del relé. */
export function onCallSignal(handler: (from: string, call: CallSignal) => void): () => void {
  callSignalHandler = handler;
  return () => {
    if (callSignalHandler === handler) callSignalHandler = null;
  };
}

export function sendCallSignal(to: string, call: CallSignal): void {
  sendSignal({ type: "signal", to, payload: { call } });
}

let liveSignalHandler: ((from: string, signal: LiveSignal) => void) | null = null;

/** Encamina la señalización de directos que llega por el canal `signal`. */
export function onLiveSignal(handler: (from: string, signal: LiveSignal) => void): () => void {
  liveSignalHandler = handler;
  return () => {
    if (liveSignalHandler === handler) liveSignalHandler = null;
  };
}

export function sendLiveSignal(to: string, signal: LiveSignal): void {
  sendSignal({ type: "signal", to, payload: { live: signal } });
}

/** `rpub` de los pares conectados ahora mismo (para difundir un directo). */
export function liveRpubs(): string[] {
  const me = self?.rpub;
  return live.map((peer) => peer.rpub).filter((rpub) => rpub && rpub !== me);
}

/** El relé solo reenvía señales a quien está en el roster ahora mismo. */
export function isPeerLive(rpub: string): boolean {
  return live.some((peer) => peer.rpub === rpub);
}

/** `rpub` de la sesión actual, o `null` si aún no hay `hello` aceptado. */
export function selfRpub(): string | null {
  return self?.rpub ?? null;
}

/** Firma con la `rsec` de la sesión: ata la señalización de llamada a la identidad. */
export function signWithSelf(message: string): string | null {
  if (!self) return null;
  return bytesToHex(signBytes(self.secret, utf8ToBytes(message)));
}

function setLinked(on: boolean) {
  linked = on;
  statusHandler?.(on);
}

function sendSignal(msg: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

async function pushMediaViaSignal(to: string, hash: string): Promise<void> {
  if (!to || !hash || to === self?.rpub) return;
  const rec = (await loadMediaRecord(hash)) ?? (await loadMediaRecord(mqKey(hash)));
  if (!rec) return;
  const bytes = clipBytes(rec.bytes);
  if (bytes.length < 16) return;
  const mime = rec.mime || "image/jpeg";
  sendSignal({
    type: "pic",
    to,
    hash,
    mime,
    data: bytesToBase64(bytes),
  });
}

async function pushOwnMediaTo(to: string): Promise<void> {
  if (!self) return;
  const { latestProfile, loadLog, postsOf } = await import("./store");
  const log = loadLog(self.rpub);
  const profile = latestProfile(log);
  if (profile) {
    for (const ref of mediaRefsOf(profile)) await pushMediaViaSignal(to, ref.hash);
  }
  for (const post of postsOf(log).slice(0, 20)) {
    for (const ref of mediaRefsOf(post)) await pushMediaViaSignal(to, ref.hash);
  }
}

function persistOutbox() {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch {
    // quota
  }
}

function restoreOutbox() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    outbox.length = 0;
    for (const item of parsed) {
      if (item && typeof item === "object" && isEnvelope(item) && verifyEnvelope(item)) {
        outbox.push(item);
      }
    }
  } catch {
    // ignore
  }
}

function enqueueOutbox(envelope: Envelope) {
  if (envelope.type === "presence") return;
  const index = outbox.findIndex((item) => item.sig === envelope.sig);
  if (index >= 0) outbox.splice(index, 1);
  outbox.push(envelope);
  while (outbox.length > OUTBOX_MAX) outbox.shift();
  persistOutbox();
}

function holdForOffline(envelope: Envelope) {
  if (envelope.type === "presence") return;
  const liveSet = new Set(live.map((peer) => peer.rpub));
  const tos = new Set(recipientsOf(envelope));
  for (const peer of live) tos.add(peer.rpub);
  tos.delete(envelope.author);
  for (const to of tos) {
    if (liveSet.has(to) && channels.get(to)?.readyState === "open") continue;
    sendSignal({ type: "hold", to, envelope });
  }
}

function requestClips(envelope: Envelope): void {
  for (const ref of mediaRefsOf(envelope)) {
    if (ref.mime.startsWith("audio/") || ref.mime.startsWith("video/")) requestMedia(ref.hash);
  }
}

function takeHeld(envelopes: Envelope[]) {
  for (const envelope of envelopes) {
    if (!isEnvelope(envelope) || !verifyEnvelope(envelope)) continue;
    packetHandler?.({ envelope });
    requestClips(envelope);
  }
}

function dcLimit(channel: RTCDataChannel): number {
  const reported = Number((channel as RTCDataChannel & { maxMessageSize?: number }).maxMessageSize);
  const cap = Number.isFinite(reported) && reported > 2048 ? reported : 16_384;
  return Math.max(4_000, Math.min(12_000, cap - 512));
}

function sendRaw(channel: RTCDataChannel, data: string, max = dcLimit(channel)): boolean {
  if (channel.readyState !== "open") return false;
  if (data.length > max) return false;
  try {
    channel.send(data);
    return true;
  } catch {
    return false;
  }
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

function queueChannel(channel: RTCDataChannel, job: () => Promise<void>): Promise<void> {
  const run = (sendChain.get(channel) ?? Promise.resolve()).then(job, job);
  sendChain.set(
    channel,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function waitDrain(channel: RTCDataChannel): Promise<boolean> {
  while (channel.readyState === "open" && channel.bufferedAmount > 256_000) {
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  }
  return channel.readyState === "open";
}

async function sendBlobFromBytes(
  channel: RTCDataChannel,
  ref: MediaRef,
  bytes: Uint8Array,
  tier: "mq" | "hq" = "hq",
): Promise<boolean> {
  const max = dcLimit(channel);
  const chunk = 1998;
  const body = bytes.slice();
  const n = Math.max(1, Math.ceil(body.length / chunk));
  for (let i = 0; i < n; i++) {
    if (!(await waitDrain(channel))) return false;
    const slice = body.subarray(i * chunk, (i + 1) * chunk);
    const payload = JSON.stringify({
      type: "media",
      hash: ref.hash,
      mime: ref.mime,
      name: (ref.name ?? "").slice(0, 80),
      tier,
      i,
      n,
      data: bytesToBase64(slice),
    });
    if (payload.length > max || !sendRaw(channel, payload, max)) return false;
  }
  return true;
}

async function sendPreview(channel: RTCDataChannel, hash: string, preview: string): Promise<boolean> {
  if (!preview.startsWith("data:image/")) return false;
  const piece = Math.max(2000, dcLimit(channel) - 120);
  const n = Math.max(1, Math.ceil(preview.length / piece));
  for (let i = 0; i < n; i++) {
    if (!(await waitDrain(channel))) return false;
    const ok = sendRaw(
      channel,
      JSON.stringify({
        type: "preview",
        hash,
        i,
        n,
        data: preview.slice(i * piece, (i + 1) * piece),
      }),
    );
    if (!ok) return false;
  }
  return true;
}

function clipBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  return view.slice();
}

async function sendBlobByHash(channel: RTCDataChannel, ref: MediaRef): Promise<void> {
  const preview = loadPreview(ref.hash);
  if (preview) await sendPreview(channel, ref.hash, preview);
  const record = await loadMediaRecord(ref.hash);
  if (!record || channel.readyState !== "open") return;
  await sendBlobFromBytes(
    channel,
    { hash: ref.hash, mime: record.mime || ref.mime, name: ref.name || record.hash },
    clipBytes(record.bytes),
    "hq",
  );
}

async function sendEnvelopeJson(channel: RTCDataChannel, envelope: Envelope): Promise<boolean> {
  const wrapped = JSON.stringify({ envelope });
  const limit = dcLimit(channel);
  if (wrapped.length <= limit) return sendRaw(channel, wrapped, limit);
  const payload = JSON.stringify(envelope);
  const piece = Math.max(2000, limit - 120);
  const n = Math.max(1, Math.ceil(payload.length / piece));
  const id = envelope.sig || `${envelope.author}-${envelope.ts}`;
  for (let i = 0; i < n; i++) {
    if (!(await waitDrain(channel))) return false;
    const ok = sendRaw(
      channel,
      JSON.stringify({ type: "env", id, i, n, data: payload.slice(i * piece, (i + 1) * piece) }),
      limit,
    );
    if (!ok) return false;
  }
  return true;
}

async function sendEnvelope(channel: RTCDataChannel, envelope: Envelope, attachMedia = true): Promise<boolean> {
  try {
    let ok = true;
    await queueChannel(channel, async () => {
      if (!(await sendEnvelopeJson(channel, envelope))) {
        ok = false;
        return;
      }
      for (const ref of mediaRefsOf(envelope)) {
        if (channel.readyState !== "open") {
          ok = false;
          return;
        }
        const preview = loadPreview(ref.hash);
        if (preview) await sendPreview(channel, ref.hash, preview);
        if (!attachMedia) continue;
        const record = await loadMediaRecord(ref.hash);
        if (!record) continue;
        const mime = record.mime || ref.mime || "";
        if (mime.startsWith("audio/") || mime.startsWith("video/")) continue;
        const sent = await sendBlobFromBytes(
          channel,
          { hash: ref.hash, mime, name: ref.name },
          clipBytes(record.bytes),
          "hq",
        );
        if (!sent) ok = false;
      }
    });
    return ok;
  } catch {
    return false;
  }
}

async function takeMediaPart(msg: {
  hash?: string;
  mime?: string;
  name?: string;
  tier?: string;
  i?: number;
  n?: number;
  data?: string;
  raw?: Uint8Array;
}): Promise<void> {
  if (typeof msg.hash !== "string" || typeof msg.i !== "number" || typeof msg.n !== "number") return;
  if (!chunkGuard("dc-media", msg.n, msg.i, "data-channel")) return;
  let piece: Uint8Array | null = msg.raw ?? null;
  if (!piece && typeof msg.data === "string") {
    try {
      piece = base64ToBytes(msg.data);
    } catch {
      return;
    }
  }
  if (!piece) return;
  const tier = msg.tier === "mq" ? "mq" : "hq";
  const key = `${msg.hash}:${tier}`;
  const now = Date.now();
  for (const [id, slot] of assembling) {
    if (now - slot.t > 120_000) assembling.delete(id);
  }
  let slot = assembling.get(key);
  if (!slot || slot.n !== msg.n) {
    slot = {
      mime: typeof msg.mime === "string" && msg.mime ? msg.mime : "image/jpeg",
      name: typeof msg.name === "string" ? msg.name : msg.hash,
      n: msg.n,
      parts: Array(msg.n),
      t: now,
    };
    assembling.set(key, slot);
  } else if (typeof msg.mime === "string" && msg.mime) {
    slot.mime = msg.mime;
  }
  slot.parts[msg.i] = piece;
  slot.t = now;
  if (!assemblyComplete(slot.parts, slot.n)) return;
  assembling.delete(key);
  const bytes = concatBytes(...(slot.parts as Uint8Array[]));
  try {
    if (tier === "mq") await putMediaTier(msg.hash, "mq", slot.mime, bytes, false);
    else await putMediaBytes({ hash: msg.hash, mime: slot.mime, name: slot.name }, bytes, false);
  } catch {
    if (slot.mime.startsWith("audio/") || slot.mime.startsWith("video/")) return;
    try {
      await putMediaTier(msg.hash, "mq", slot.mime, bytes, false);
    } catch {
      // ignore
    }
  }
}

async function takeWsBlob(msg: {
  hash?: string;
  mime?: string;
  tier?: string;
  i?: number;
  n?: number;
  size?: number;
  data?: string;
}): Promise<void> {
  if (typeof msg.hash !== "string" || typeof msg.i !== "number" || typeof msg.n !== "number" || typeof msg.data !== "string") return;
  if (!chunkGuard("ws-blob", msg.n, msg.i, "relay-ws")) return;
  const tier = msg.tier === "hq" ? "hq" : "mq";
  const key = `${msg.hash}:${tier}`;
  const now = Date.now();
  for (const [id, slot] of assemblingWs) {
    if (now - slot.t > 120_000) assemblingWs.delete(id);
  }
  let slot = assemblingWs.get(key);
  if (!slot || slot.n !== msg.n) {
    slot = {
      n: msg.n,
      mime: typeof msg.mime === "string" && msg.mime ? msg.mime : "image/jpeg",
      tier,
      parts: Array(msg.n),
      t: now,
    };
    assemblingWs.set(key, slot);
  }
  try {
    slot.parts[msg.i] = base64ToBytes(msg.data);
  } catch {
    return;
  }
  slot.t = now;
  if (!assemblyComplete(slot.parts, slot.n)) return;
  assemblingWs.delete(key);
  const bytes = concatBytes(...(slot.parts as Uint8Array[]));
  if (typeof msg.size === "number" && msg.size > 0 && bytes.length !== msg.size) return;
  if (bytes.length < 32) return;
  try {
    if (slot.tier === "hq") {
      try {
        await putMediaBytes({ hash: msg.hash, mime: slot.mime, name: msg.hash }, bytes, false);
      } catch {
        await putMediaTier(msg.hash, "mq", slot.mime, bytes, false);
      }
    } else {
      await putMediaTier(msg.hash, "mq", slot.mime, bytes, false);
    }
  } catch {
    // ignore
  }
}

/**
 * Un `Array(n)` con indice(s) sin rellenar es *holey*, y `some` se salta los
 * huecos: con `n: 2` y solo el trozo 0 llegado, `parts.some((p) => !p)` daba
 * false, el ensamblado se daba por bueno y `concatBytes(...parts)` reventaba con
 * un TypeError. `Object.keys` si cuenta los indices presentes de verdad.
 */
function assemblyComplete(parts: Array<unknown>, n: number): boolean {
  return Object.keys(parts).length === n;
}

function takeEnv(msg: { id?: string; data?: string; i?: number; n?: number }): void {
  if (typeof msg.data !== "string" || typeof msg.i !== "number" || typeof msg.n !== "number") return;
  if (!chunkGuard("dc-env", msg.n, msg.i, "data-channel")) return;
  const id = typeof msg.id === "string" && msg.id ? msg.id : "env";
  const now = Date.now();
  for (const [key, slot] of assemblingEnv) {
    if (now - slot.t > 60_000) assemblingEnv.delete(key);
  }
  let slot = assemblingEnv.get(id);
  if (!slot || slot.n !== msg.n) {
    slot = { n: msg.n, parts: Array(msg.n), t: now };
    assemblingEnv.set(id, slot);
  }
  slot.parts[msg.i] = msg.data;
  slot.t = now;
  if (!assemblyComplete(slot.parts, slot.n)) return;
  assemblingEnv.delete(id);
  try {
    const envelope = JSON.parse(slot.parts.join("")) as Envelope;
    if (!isEnvelope(envelope) || !verifyEnvelope(envelope)) return;
    packetHandler?.({ envelope });
  } catch {
    // ignore
  }
}

function takePreview(msg: { hash?: string; data?: string; i?: number; n?: number }): void {
  if (typeof msg.hash !== "string" || typeof msg.data !== "string") return;
  if (msg.data.startsWith("data:image/") && (msg.n === undefined || msg.n === 1)) {
    rememberPreview(msg.hash, msg.data);
    notifyMedia(msg.hash);
    return;
  }
  if (typeof msg.hash !== "string" || typeof msg.i !== "number" || typeof msg.n !== "number") return;
  if (!chunkGuard("dc-preview", msg.n, msg.i, "data-channel")) return;
  const now = Date.now();
  for (const [hash, slot] of assemblingPreview) {
    if (now - slot.t > 60_000) assemblingPreview.delete(hash);
  }
  let slot = assemblingPreview.get(msg.hash);
  if (!slot || slot.n !== msg.n) {
    slot = { n: msg.n, parts: Array(msg.n), t: now };
    assemblingPreview.set(msg.hash, slot);
  }
  slot.parts[msg.i] = msg.data;
  slot.t = now;
  if (!assemblyComplete(slot.parts, slot.n)) return;
  assemblingPreview.delete(msg.hash);
  rememberPreview(msg.hash, slot.parts.join(""));
  notifyMedia(msg.hash);
}

export function requestMedia(hash: string): void {
  if (!hash) return;
  const now = Date.now();
  if ((lastAsk.get(hash) ?? 0) + 3000 > now) return;
  lastAsk.set(hash, now);
  sendSignal({ type: "need-blob", hash });
  const msg = JSON.stringify({ type: "need-blob", hash });
  for (const channel of channels.values()) sendRaw(channel, msg);
}

let thumbMemo = { at: 0, data: "" };

async function ownThumb(): Promise<string> {
  if (!self) return "";
  if (Date.now() - thumbMemo.at < 60_000) return thumbMemo.data;
  try {
    const { latestProfile, loadLog } = await import("./store");
    const { avatarThumb } = await import("./media");
    const envelope = latestProfile(loadLog(self.rpub));
    const hash = envelope?.type === "profile" ? envelope.body.picture?.hash : undefined;
    if (!hash) {
      thumbMemo = { at: Date.now(), data: "" };
      return "";
    }
    const data = (await avatarThumb(hash)) ?? "";
    thumbMemo = { at: Date.now(), data };
    return data;
  } catch {
    return "";
  }
}

async function sendProfile(channel: RTCDataChannel) {
  if (!self || channel.readyState !== "open") return;
  const thumb = await ownThumb();
  if (thumb && channel.readyState === "open") {
    sendRaw(channel, JSON.stringify({ type: "avatar", data: thumb }));
  }
  const { envelopesToSync } = await import("./store");
  for (const envelope of envelopesToSync(self.rpub)) {
    if (channel.readyState !== "open") break;
    await sendEnvelope(channel, envelope, false);
  }
}

async function flushTo(channel: RTCDataChannel) {
  if (channel.readyState !== "open") return;
  await sendProfile(channel);
  for (const envelope of outbox) {
    if (channel.readyState !== "open") return;
    await sendEnvelope(channel, envelope);
  }
}

function setupChannel(rpub: string, channel: RTCDataChannel) {
  channels.set(rpub, channel);
  try {
    channel.binaryType = "arraybuffer";
  } catch {
    // ignore
  }
  let started = false;
  const boot = () => {
    if (started) return;
    started = true;
    void flushTo(channel);
  };
  channel.onopen = boot;
  if (channel.readyState === "open") boot();
  channel.onmessage = (event) => {
    try {
      const text = typeof event.data === "string" ? event.data : "";
      if (!text) return;
      const parsed = JSON.parse(text) as {
        type?: string;
        id?: string;
        data?: string;
        hash?: string;
        mime?: string;
        name?: string;
        i?: number;
        n?: number;
        bytes?: number;
        tier?: string;
        envelope?: MeshPacket["envelope"];
        media?: MeshPacket["media"];
      };
      if (parsed?.type === "need-data") {
        void flushTo(channel);
        return;
      }
      if (parsed?.type === "need-blob" && typeof parsed.hash === "string") {
        const hash = parsed.hash;
        void queueChannel(channel, () =>
          sendBlobByHash(channel, { hash, mime: "application/octet-stream", name: hash }),
        );
        return;
      }
      if (parsed?.type === "preview") {
        takePreview(parsed);
        return;
      }
      if (parsed?.type === "media") {
        void takeMediaPart(parsed);
        return;
      }
      if (parsed?.type === "env") {
        takeEnv(parsed);
        return;
      }
      if (parsed?.type === "avatar" && typeof parsed.data === "string") {
        rememberThumb(rpub, parsed.data);
        setLive(withThumbs(live));
        return;
      }
      if (!parsed?.envelope || !isEnvelope(parsed.envelope) || !verifyEnvelope(parsed.envelope)) return;
      packetHandler?.({ envelope: parsed.envelope, media: parsed.media });
    } catch {
      // ignore
    }
  };
  channel.onclose = () => {
    if (channels.get(rpub) === channel) channels.delete(rpub);
  };
}

async function ensurePeer(them: string) {
  if (!self || them === self.rpub) return;
  const existing = pcs.get(them);
  if (existing) {
    if (existing.connectionState === "failed" || existing.connectionState === "closed") {
      closeLink(them);
    } else {
      return;
    }
  }
  const pc = new RTCPeerConnection({ iceServers: STUN, iceCandidatePoolSize: 2 });
  pcs.set(them, pc);
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({ type: "signal", to: them, payload: { cand: iceJson(event.candidate) } });
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== "failed") return;
    closeLink(them);
    window.setTimeout(() => {
      if (self && live.some((peer) => peer.rpub === them)) void ensurePeer(them);
    }, 800);
  };
  pc.ondatachannel = (event) => setupChannel(them, event.channel);
  if (self.rpub < them) {
    const channel = pc.createDataChannel("rita", { ordered: true, negotiated: false });
    setupChannel(them, channel);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ type: "signal", to: them, payload: { desc: pc.localDescription } });
  }
}

function closeLink(rpub: string) {
  channels.get(rpub)?.close();
  channels.delete(rpub);
  pcs.get(rpub)?.close();
  pcs.delete(rpub);
  pendingIce.delete(rpub);
}

async function flushQueuedIce(from: string, pc: RTCPeerConnection) {
  const queued = pendingIce.get(from) ?? [];
  pendingIce.delete(from);
  for (const cand of queued) {
    try {
      await pc.addIceCandidate(cand);
    } catch {
      // ignore
    }
  }
}

async function onSignal(from: string, payload: { desc?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }) {
  if (!self) return;
  try {
    await ensurePeer(from);
    const pc = pcs.get(from);
    if (!pc) return;
    if (payload.desc) {
      if (pc.signalingState === "closed") return;
      await pc.setRemoteDescription(payload.desc);
      await flushQueuedIce(from, pc);
      if (payload.desc.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: "signal", to: from, payload: { desc: pc.localDescription } });
      }
    }
    if (payload.cand) {
      if (!pc.remoteDescription) {
        const queued = pendingIce.get(from) ?? [];
        queued.push(payload.cand);
        pendingIce.set(from, queued);
        return;
      }
      try {
        await pc.addIceCandidate(payload.cand);
      } catch {
        // ignore
      }
    }
  } catch {
    // glare or stale signal from a previous peer connection
  }
}

function repairPeers() {
  for (const peer of live) {
    const pc = pcs.get(peer.rpub);
    if (!pc || pc.connectionState === "failed" || pc.connectionState === "closed") {
      if (pc) closeLink(peer.rpub);
      void ensurePeer(peer.rpub);
    }
  }
}

export async function publishMesh(envelope: Envelope): Promise<void> {
  if (envelope.type === "presence") return;
  enqueueOutbox(envelope);
  let sent = 0;
  for (const channel of channels.values()) {
    if (await sendEnvelope(channel, envelope)) sent += 1;
  }
  if (sent === 0) repairPeers();
  holdForOffline(envelope);
  const tos = new Set(recipientsOf(envelope));
  for (const peer of live) tos.add(peer.rpub);
  tos.delete(envelope.author);
  for (const ref of mediaRefsOf(envelope)) {
    for (const to of tos) await pushMediaViaSignal(to, ref.hash);
  }
}

export async function ingestMeshPacket(packet: MeshPacket): Promise<boolean> {
  if (packet.media) {
    for (const item of packet.media) {
      try {
        await putMediaBytes(item, base64ToBytes(item.data), false);
      } catch {
        // ignore
      }
    }
  }
  const { acceptRemoteEnvelope } = await import("./bus");
  for (const ref of mediaRefsOf(packet.envelope)) rememberPreview(ref.hash, ref.preview);
  const ok = acceptRemoteEnvelope(packet.envelope);
  if (ok) requestClips(packet.envelope);
  return ok;
}

export function requestPeerData(rpub: string): void {
  const channel = channels.get(rpub);
  if (channel?.readyState === "open") {
    channel.send(JSON.stringify({ type: "need-data" }));
    return;
  }
  void ensurePeer(rpub);
}

export function listenMesh(
  hello: { rpub: string; name: string; interests: string[]; secret: Uint8Array; invite?: string },
  onPacket: (packet: MeshPacket) => void,
  onPeers?: (peers: LivePeer[]) => void,
): () => void {
  let stopped = false;
  let retry: number | undefined;
  let scan: number | undefined;
  self = hello;
  packetHandler = onPacket;
  if (onPeers) peersHandler = onPeers;
  restoreOutbox();

  const url = loadSignalUrl();
  if (!url) {
    setLinked(false);
    setLive([]);
    return () => undefined;
  }

  const recentJoin = new Map<string, number>();
  const applyPeers = (list: LivePeer[]) => {
    const now = Date.now();
    const prev = new Map(live.map((peer) => [peer.rpub, peer]));
    const uniq: LivePeer[] = [];
    const seen = new Set<string>();
    const add = (peer: LivePeer) => {
      if (!peer?.rpub || peer.rpub === hello.rpub || seen.has(peer.rpub)) return;
      seen.add(peer.rpub);
      const older = prev.get(peer.rpub);
      uniq.push({
        ...peer,
        avatar:
          (peer.avatar && peer.avatar.startsWith("data:image/") ? peer.avatar : "") ||
          older?.avatar ||
          thumbs.get(peer.rpub) ||
          "",
      });
    };
    for (const peer of list) add(peer);
    for (const peer of live) {
      if (seen.has(peer.rpub)) continue;
      const joined = recentJoin.get(peer.rpub) ?? 0;
      if (now - joined < 10_000) add(peer);
    }
    for (const rpub of [...pcs.keys()]) {
      if (!seen.has(rpub)) closeLink(rpub);
    }
    setLive(uniq);
    for (const peer of uniq) {
      const isNew = !prev.has(peer.rpub);
      void ensurePeer(peer.rpub);
      if (isNew) void pushOwnMediaTo(peer.rpub);
    }
  };

  const attach = (ws: WebSocket) => {
    // `bound` evita reenviar el hello con cada `challenge`: el relé pide nonce
    // al conectar y al reintentar, pero una vez aceptado el hello no hay que
    // volver a firmarse (eso encadenaba hello→challenge→hello sin fin).
    let bound = false;
    // El relé manda unnonce de un solo uso y el hello va firmado con la rsec:
    // sin eso cualquiera podría.listarse como el rpub de otra persona.
    const sendHello = () => {
      void (async () => {
        try {
          const [avatar, pow] = await Promise.all([ownThumb(), cachedPow(hello.rpub)]);
          if (bound || stopped || socket !== ws || !challenge) return;
          const name = hello.name.slice(0, HELLO_NAME_MAX);
          const interests = hello.interests.slice(0, HELLO_INTERESTS_MAX);
          const sig = bytesToHex(
            signBytes(
              hello.secret,
              utf8ToBytes(canonicalJson({ interests, n: challenge, name, rpub: hello.rpub })),
            ),
          );
          sendSignal({
            type: "hello",
            rpub: hello.rpub,
            name,
            interests,
            avatar,
            pow,
            invite: hello.invite ?? "",
            auth: { n: challenge, sig },
          });
        } catch {
          // sin hello válido el relé no nos lista
        }
      })();
    };
    ws.onmessage = (event) => {
      if (stopped || socket !== ws) return;
      let msg: SignalIn;
      try {
        msg = JSON.parse(String(event.data)) as SignalIn;
      } catch {
        return;
      }
      if (msg.type === "challenge" && typeof msg.nonce === "string") {
        challenge = msg.nonce;
        if (!bound) sendHello();
        return;
      }
      if (msg.type === "hello-ok") {
        bound = true;
        setLinked(true);
      }
      if (msg.type === "error" && (msg.error === "hello_rate" || msg.error === "pow" || msg.error === "auth")) {
        // El relé no reencadena errores: el reintento va con el `scan`, que
        // pide un nonce nuevo si el socket sigue sin vincular.
        bound = false;
        setLinked(false);
      }
      if (msg.type === "error" && msg.error === "invite") {
        // Beta cerrada y el codigo no vale: se descarta para no reenviarlo (ni
        // que `loadVault` lo reinyecte) y se avisa para pedir uno nuevo.
        bound = false;
        setLinked(false);
        clearVaultInvite();
        clearBetaInvite();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("magicrita-invite-required"));
        }
      }
      if (msg.type === "error" && msg.error === "rpub_switch") {
        // El relé ata una conexión a una identidad. Reconectar en limpio.
        bound = false;
        setLinked(false);
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      if (msg.type === "peers") applyPeers(msg.peers);
      if (msg.type === "join" && msg.peer?.rpub) {
        recentJoin.set(msg.peer.rpub, Date.now());
        applyPeers([...live.filter((peer) => peer.rpub !== msg.peer.rpub), msg.peer]);
      }
      if (msg.type === "leave") {
        recentJoin.delete(msg.rpub);
        closeLink(msg.rpub);
        setLive(live.filter((peer) => peer.rpub !== msg.rpub));
      }
      if (msg.type === "signal" && msg.from) {
        // Llamadas y directos reutilizan el mismo `signal`; se distinguen por `call`/`live`.
        if (msg.payload.live) liveSignalHandler?.(msg.from, msg.payload.live);
        else if (msg.payload.call) callSignalHandler?.(msg.from, msg.payload.call);
        else void onSignal(msg.from, msg.payload);
      }
      if (msg.type === "held" && Array.isArray(msg.envelopes)) takeHeld(msg.envelopes);
      if (msg.type === "blob") void takeWsBlob(msg);
      if (msg.type === "pic" && msg.hash && msg.data) {
        void (async () => {
          try {
            const bytes = base64ToBytes(msg.data);
            const mime = msg.mime || "image/jpeg";
            if (mime.startsWith("audio/") || mime.startsWith("video/")) {
              await storeClip(msg.hash, mime, bytes, false);
            } else {
              await putMediaTier(msg.hash, "mq", mime, bytes, false);
            }
          } catch {
            // ignore
          }
        })();
      }
      if (msg.type === "need-blob" && msg.hash && msg.from) void pushMediaViaSignal(msg.from, msg.hash);
      if (msg.type === "moderation-changed") moderationHandler?.();
    };
    ws.onerror = () => {
      if (socket !== ws) return;
      setLinked(false);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      bound = false;
      socket = null;
      setLinked(false);
      if (stopped) {
        setLive([]);
        return;
      }
      retry = window.setTimeout(connect, 1500);
    };
  };

  const connect = () => {
    if (stopped) return;
    const ws = new WebSocket(url);
    socket = ws;
    attach(ws);
  };

  connect();
  scan = window.setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    // El relé responde con el roster; si el socket quedó sin vincular pide un
    // nonce nuevo, y ahí sí se reenvía el hello.
    sendSignal({ type: "scan" });
    repairPeers();
  }, 8_000);

  return () => {
    stopped = true;
    window.clearInterval(scan);
    window.clearTimeout(retry);
    const current = socket;
    socket = null;
    packetHandler = null;
    self = null;
    challenge = "";
    persistOutbox();
    pendingIce.clear();
    setLinked(false);
    setLive([]);
    for (const rpub of [...pcs.keys()]) closeLink(rpub);
    current?.close();
  };
}

export function stopMesh(): void {
  for (const rpub of [...pcs.keys()]) closeLink(rpub);
  const current = socket;
  socket = null;
  self = null;
  packetHandler = null;
  challenge = "";
  persistOutbox();
  pendingIce.clear();
  setLinked(false);
  setLive([]);
  current?.close();
}

export function resetMeshState(): void {
  stopMesh();
  outbox.length = 0;
  lastAsk.clear();
  assembling.clear();
  assemblingPreview.clear();
  assemblingEnv.clear();
  assemblingWs.clear();
  clearAssemblyLog();
  try {
    localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // ignore
  }
}

export type GuardCase = {
  via: AssemblyVia;
  hostileN: number;
  ms: number;
  slotAbierto: boolean;
  correcto: boolean;
};

export type GuardReport = {
  cap: number;
  /** Por encima de esto la pagina se considera congelada. */
  umbralMs: number;
  msPeor: number;
  correcto: boolean;
  casosHostiles: GuardCase[];
  casosLegales: GuardCase[];
};

/** Numero de slots de ensamblado abiertos ahora mismo. */
function slotCount(): number {
  return assembling.size + assemblingWs.size + assemblingEnv.size + assemblingPreview.size;
}

/**
 * Prueba de la guarda de trozos contra las cuatro rutas reales, no contra una
 * reimplementacion. Un paquete hostil declara `n: 2e9` con `i` en la ultima
 * posicion: si el tope no estuviera, `Array(n)` crearia un array disperso de
 * miles de millones y el ensamblado reventaria al expandirlo. Con el tope debe
 * decidir en milisegundos y no abrir nada.
 *
 * Los casos legales mandan `n: 2` con un solo trozo, asi que el ensamblado se
 * queda a medias y no escribe nada en IndexedDB: prueban que la ruta sigue
 * admitiendo paquetes legitimos sin dejar rastro.
 */
export async function runAssemblyGuardSelfTest(): Promise<GuardReport> {
  const UMBRAL_MS = 50;
  const HOSTIL_N = 2_000_000_000;
  const hostiles: GuardCase[] = [];
  const legales: GuardCase[] = [];

  async function probe(via: AssemblyVia, n: number, i: number, data: string, label: string) {
    const antes = slotCount();
    const elapsed = tick();
    const payload = { hash: `probe-${label}-${n}`, i, n, data, mime: "image/png", id: `probe-${label}` };
    if (via === "ws-blob") await takeWsBlob(payload);
    else if (via === "dc-media") await takeMediaPart(payload);
    else if (via === "dc-env") takeEnv(payload);
    else takePreview({ hash: payload.hash, data, i, n });
    const ms = elapsed();
    const slotAbierto = slotCount() > antes;
    return { via, hostileN: n, ms, slotAbierto, correcto: false };
  }

  for (const via of ["ws-blob", "dc-media", "dc-env", "dc-preview"] as AssemblyVia[]) {
    const r = await probe(via, HOSTIL_N, HOSTIL_N - 1, "AAAA", "hostil");
    r.correcto = r.ms < UMBRAL_MS && !r.slotAbierto;
    hostiles.push(r);
  }
  for (const via of ["ws-blob", "dc-media", "dc-env", "dc-preview"] as AssemblyVia[]) {
    const r = await probe(via, 2, 0, "QUFBQQ==", "legal");
    r.correcto = r.ms < UMBRAL_MS && r.slotAbierto;
    legales.push(r);
  }
  // Los probes no deben quedar abierto ni completando nada.
  assembling.clear();
  assemblingWs.clear();
  assemblingEnv.clear();
  assemblingPreview.clear();

  const msPeor = Math.max(...hostiles.map((item) => item.ms), ...legales.map((item) => item.ms));
  return {
    cap: MAX_CHUNKS,
    umbralMs: UMBRAL_MS,
    msPeor,
    correcto: hostiles.every((item) => item.correcto) && legales.every((item) => item.correcto),
    casosHostiles: hostiles,
    casosLegales: legales,
  };
}

installDiagHook(runAssemblyGuardSelfTest);
