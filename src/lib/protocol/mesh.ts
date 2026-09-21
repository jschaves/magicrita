import { base64ToBytes, blobToBase64, bytesToBase64, concatBytes } from "./bytes";
import { isEnvelope, mediaRefsOf, verifyEnvelope, type Envelope } from "./envelope";
import {
  loadMediaRecord,
  loadPreview,
  mqKey,
  notifyMedia,
  putMediaBytes,
  putMediaTier,
  rememberPreview,
  type MediaRef,
} from "./media";
import { loadSignalUrl } from "./signalUrl";
import { cachedPow } from "./pow";
import { loadBetaInvite } from "./betaInvite";
import { recipientsOf } from "./store";

const OUTBOX_MAX = 250;
const OUTBOX_KEY = "magicrita.outbox";
const STUN = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

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

type SignalIn =
  | { type: "peers"; peers: LivePeer[] }
  | { type: "join"; peer: LivePeer }
  | { type: "leave"; rpub: string }
  | { type: "signal"; from: string; payload: { desc?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit } }
  | { type: "held"; envelopes: Envelope[] }
  | { type: "blob"; hash: string; mime?: string; tier?: string; i: number; n: number; data: string }
  | { type: "need-blob"; hash: string; from?: string }
  | { type: "pic"; hash: string; mime?: string; data: string }
  | { type: "moderation"; users: string[]; comments: string[] };

const channels = new Map<string, RTCDataChannel>();
const pcs = new Map<string, RTCPeerConnection>();
const pendingIce = new Map<string, RTCIceCandidateInit[]>();
const outbox: Envelope[] = [];
const assembling = new Map<
  string,
  { mime: string; name: string; n: number; parts: Array<Uint8Array | undefined>; t: number }
>();
const assemblingPreview = new Map<string, { n: number; parts: Array<string | undefined>; t: number }>();
const assemblingEnv = new Map<string, { n: number; parts: Array<string | undefined>; t: number }>();
const assemblingWs = new Map<
  string,
  { n: number; mime: string; tier: "mq" | "hq"; parts: Array<string | undefined>; t: number }
>();
const lastAsk = new Map<string, number>();
const sendChain = new WeakMap<RTCDataChannel, Promise<void>>();
let socket: WebSocket | null = null;
let self: { rpub: string; name: string; interests: string[] } | null = null;
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

export function getLivePeers(): LivePeer[] {
  return live;
}

export function onLivePeers(handler: (peers: LivePeer[]) => void): () => void {
  peersHandler = handler;
  handler(live);
  return () => {
    if (peersHandler === handler) peersHandler = null;
  };
}

let moderationHandler: ((blocks: { users: string[]; comments: string[] }) => void) | null = null;

export function onModeration(handler: (blocks: { users: string[]; comments: string[] }) => void): () => void {
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

function setLinked(on: boolean) {
  linked = on;
  statusHandler?.(on);
}

function sendSignal(msg: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

async function pushMediaViaSignal(to: string, hash: string): Promise<void> {
  if (!to || !hash || to === self?.rpub) return;
  const mid = await loadMediaRecord(mqKey(hash));
  const rec = mid ?? (await loadMediaRecord(hash));
  if (!rec) return;
  const bytes = new Uint8Array(rec.bytes);
  if (bytes.length < 32) return;
  const b64 = await blobToBase64(new Blob([bytes], { type: rec.mime || "image/jpeg" }));
  sendSignal({
    type: "pic",
    to,
    hash,
    mime: rec.mime || "image/jpeg",
    data: b64,
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

function takeHeld(envelopes: Envelope[]) {
  for (const envelope of envelopes) {
    if (!isEnvelope(envelope) || !verifyEnvelope(envelope)) continue;
    packetHandler?.({ envelope });
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

function messageToText(data: unknown): Promise<string> {
  if (typeof data === "string") return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(data));
  if (ArrayBuffer.isView(data)) return Promise.resolve(new TextDecoder().decode(data));
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  return Promise.resolve(String(data));
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

function binChunkSize(channel: RTCDataChannel): number {
  const room = Math.floor((dcLimit(channel) - 240) * 3 / 4);
  const aligned = room - (room % 3);
  return Math.max(768, aligned);
}

async function sendBlobFromBytes(
  channel: RTCDataChannel,
  ref: MediaRef,
  bytes: Uint8Array,
  tier: "mq" | "hq" = "hq",
): Promise<boolean> {
  const chunk = binChunkSize(channel);
  const n = Math.max(1, Math.ceil(bytes.length / chunk));
  for (let i = 0; i < n; i++) {
    if (!(await waitDrain(channel))) return false;
    const slice = bytes.subarray(i * chunk, (i + 1) * chunk);
    const ok = sendRaw(
      channel,
      JSON.stringify({
        type: "media",
        hash: ref.hash,
        mime: ref.mime,
        name: (ref.name ?? "").slice(0, 80),
        tier,
        i,
        n,
        data: bytesToBase64(slice),
      }),
    );
    if (!ok) return false;
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

async function sendBlobByHash(channel: RTCDataChannel, ref: MediaRef): Promise<void> {
  const preview = loadPreview(ref.hash);
  if (preview) await sendPreview(channel, ref.hash, preview);
  const mid = await loadMediaRecord(mqKey(ref.hash));
  if (mid && channel.readyState === "open") {
    await sendBlobFromBytes(
      channel,
      { hash: ref.hash, mime: mid.mime, name: ref.name || ref.hash },
      new Uint8Array(mid.bytes),
      "mq",
    );
  }
  const record = await loadMediaRecord(ref.hash);
  if (!record || channel.readyState !== "open") return;
  await sendBlobFromBytes(
    channel,
    { hash: ref.hash, mime: record.mime || ref.mime, name: ref.name || record.hash },
    new Uint8Array(record.bytes),
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

async function sendEnvelope(channel: RTCDataChannel, envelope: Envelope): Promise<boolean> {
  try {
    await queueChannel(channel, async () => {
      if (!(await sendEnvelopeJson(channel, envelope))) return;
      for (const ref of mediaRefsOf(envelope)) {
        if (channel.readyState !== "open") return;
        const preview = loadPreview(ref.hash);
        if (preview) await sendPreview(channel, ref.hash, preview);
        const mid = await loadMediaRecord(mqKey(ref.hash));
        if (mid) {
          await sendBlobFromBytes(
            channel,
            { hash: ref.hash, mime: mid.mime, name: ref.name },
            new Uint8Array(mid.bytes),
            "mq",
          );
        }
        const record = await loadMediaRecord(ref.hash);
        if (!record) continue;
        await sendBlobFromBytes(
          channel,
          { hash: ref.hash, mime: record.mime || ref.mime, name: ref.name },
          new Uint8Array(record.bytes),
          "hq",
        );
      }
    });
    return true;
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
}): Promise<void> {
  if (
    typeof msg.hash !== "string" ||
    typeof msg.i !== "number" ||
    typeof msg.n !== "number" ||
    typeof msg.data !== "string" ||
    msg.n < 1 ||
    msg.i < 0 ||
    msg.i >= msg.n
  ) {
    return;
  }
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
  try {
    slot.parts[msg.i] = base64ToBytes(msg.data);
  } catch {
    return;
  }
  slot.t = now;
  if (slot.parts.some((part) => !part)) return;
  assembling.delete(key);
  const bytes = concatBytes(...(slot.parts as Uint8Array[]));
  try {
    if (tier === "mq") await putMediaTier(msg.hash, "mq", slot.mime, bytes);
    else await putMediaBytes({ hash: msg.hash, mime: slot.mime, name: slot.name }, bytes);
  } catch {
    try {
      await putMediaTier(msg.hash, "mq", slot.mime, bytes);
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
  if (
    typeof msg.hash !== "string" ||
    typeof msg.i !== "number" ||
    typeof msg.n !== "number" ||
    typeof msg.data !== "string" ||
    msg.n < 1 ||
    msg.i < 0 ||
    msg.i >= msg.n
  ) {
    return;
  }
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
  slot.parts[msg.i] = msg.data;
  slot.t = now;
  if (slot.parts.some((part) => typeof part !== "string")) return;
  assemblingWs.delete(key);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(slot.parts.join(""));
  } catch {
    return;
  }
  if (typeof msg.size === "number" && msg.size > 0 && bytes.length !== msg.size) return;
  if (bytes.length < 256) return;
  try {
    if (slot.tier === "hq") {
      try {
        await putMediaBytes({ hash: msg.hash, mime: slot.mime, name: msg.hash }, bytes);
      } catch {
        await putMediaTier(msg.hash, "mq", slot.mime, bytes);
      }
    } else {
      await putMediaTier(msg.hash, "mq", slot.mime, bytes);
    }
  } catch {
    // ignore
  }
}

function takeEnv(msg: { id?: string; data?: string; i?: number; n?: number }): void {
  if (typeof msg.data !== "string" || typeof msg.i !== "number" || typeof msg.n !== "number") return;
  if (msg.n < 1 || msg.i < 0 || msg.i >= msg.n) return;
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
  if (slot.parts.some((part) => typeof part !== "string")) return;
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
  if (typeof msg.i !== "number" || typeof msg.n !== "number" || msg.n < 1 || msg.i < 0 || msg.i >= msg.n) {
    return;
  }
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
  if (slot.parts.some((part) => typeof part !== "string")) return;
  assemblingPreview.delete(msg.hash);
  rememberPreview(msg.hash, slot.parts.join(""));
  notifyMedia(msg.hash);
}

export function requestMedia(hash: string): void {
  if (!hash) return;
  const now = Date.now();
  if ((lastAsk.get(hash) ?? 0) + 2500 > now) return;
  lastAsk.set(hash, now);
  sendSignal({ type: "need-blob", hash });
  const msg = JSON.stringify({ type: "need-blob", hash });
  for (const channel of channels.values()) sendRaw(channel, msg);
}

async function ownThumb(): Promise<string> {
  if (!self) return "";
  try {
    const { latestProfile, loadLog } = await import("./store");
    const { avatarThumb } = await import("./media");
    const envelope = latestProfile(loadLog(self.rpub));
    const hash = envelope?.type === "profile" ? envelope.body.picture?.hash : undefined;
    if (!hash) return "";
    return (await avatarThumb(hash)) ?? "";
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
    await sendEnvelope(channel, envelope);
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
    void (async () => {
      try {
        const parsed = JSON.parse(await messageToText(event.data)) as {
          type?: string;
          id?: string;
          data?: string;
          hash?: string;
          mime?: string;
          name?: string;
          i?: number;
          n?: number;
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
    })();
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
    for (const to of tos) void pushMediaViaSignal(to, ref.hash);
  }
}

export async function ingestMeshPacket(packet: MeshPacket): Promise<boolean> {
  if (packet.media) {
    for (const item of packet.media) {
      try {
        await putMediaBytes(item, base64ToBytes(item.data));
      } catch {
        // ignore
      }
    }
  }
  const { acceptRemoteEnvelope } = await import("./bus");
  for (const ref of mediaRefsOf(packet.envelope)) rememberPreview(ref.hash, ref.preview);
  return acceptRemoteEnvelope(packet.envelope);
}

export function meshConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
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
  hello: { rpub: string; name: string; interests: string[] },
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

  const applyPeers = (list: LivePeer[]) => {
    const prev = new Map(live.map((peer) => [peer.rpub, peer]));
    const uniq: LivePeer[] = [];
    const seen = new Set<string>();
    for (const peer of list) {
      if (!peer?.rpub || peer.rpub === hello.rpub || seen.has(peer.rpub)) continue;
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
    ws.onopen = () => {
      if (stopped || socket !== ws) return;
      setLinked(true);
      void (async () => {
        try {
          const [avatar, pow] = await Promise.all([ownThumb(), cachedPow(hello.rpub)]);
          if (stopped || socket !== ws) return;
          sendSignal({
            type: "hello",
            rpub: hello.rpub,
            name: hello.name,
            interests: hello.interests,
            avatar,
            pow,
            invite: loadBetaInvite(),
          });
          sendSignal({ type: "scan" });
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
      if (msg.type === "peers") applyPeers(msg.peers);
      if (msg.type === "join" && msg.peer?.rpub) {
        applyPeers([...live.filter((peer) => peer.rpub !== msg.peer.rpub), msg.peer]);
      }
      if (msg.type === "leave") {
        closeLink(msg.rpub);
        setLive(live.filter((peer) => peer.rpub !== msg.rpub));
      }
      if (msg.type === "signal" && msg.from) void onSignal(msg.from, msg.payload);
      if (msg.type === "held" && Array.isArray(msg.envelopes)) takeHeld(msg.envelopes);
      if (msg.type === "blob") void takeWsBlob(msg);
      if (msg.type === "pic" && msg.hash && msg.data) {
        void (async () => {
          try {
            await putMediaTier(msg.hash, "mq", msg.mime || "image/jpeg", base64ToBytes(msg.data));
          } catch {
            // ignore
          }
        })();
      }
      if (msg.type === "need-blob" && msg.hash && msg.from) void pushMediaViaSignal(msg.from, msg.hash);
      if (msg.type === "moderation") {
        moderationHandler?.({
          users: Array.isArray(msg.users) ? msg.users : [],
          comments: Array.isArray(msg.comments) ? msg.comments : [],
        });
      }
    };
    ws.onerror = () => {
      if (socket !== ws) return;
      setLinked(false);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
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
    sendSignal({ type: "scan" });
    repairPeers();
  }, 25_000);

  return () => {
    stopped = true;
    window.clearInterval(scan);
    window.clearTimeout(retry);
    const current = socket;
    socket = null;
    packetHandler = null;
    self = null;
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
  persistOutbox();
  pendingIce.clear();
  setLinked(false);
  setLive([]);
  current?.close();
}
