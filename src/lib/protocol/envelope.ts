import { bytesToHex, hexToBytes, utf8ToBytes } from "./bytes";
import {
  parseRpub,
  signBytes,
  verifyBytes,
  type Identity,
} from "./identity";
import { stripBlobText, type MediaRef } from "./media";

export type ReactionKind = "post" | "image" | "comment";

export const MAX_POST_CHARS = 280;
export const MAX_COMMENT_CHARS = 280;
export const MAX_NAME_CHARS = 50;
export const MAX_BIO_CHARS = 160;
export const MAX_CHAT_CHARS = 280;

/**
 * Topes de recepcion. Los de arriba solo se aplican al firmar: al recibir, un par
 * hostil elige cada tamano y `isEnvelope` solo miraba tipos. Una sola firma con
 * `text` de 50 MB pasaba el filtro, se guardaba en localStorage y, al no haber
 * forma de limpiarlo, dejaba el log inservible.
 */
const MAX_ENVELOPE_CHARS = 512_000;
const MAX_ENVELOPE_DEPTH = 6;
const MAX_ENVELOPE_KEYS = 64;
const MAX_ENVELOPE_ITEMS = 4_096;
const MAX_RECEIVED_TEXT = 20_000;
const MAX_RECEIVED_LABEL = 512;
const MAX_RECEIVED_HASH = 256;
const MAX_RECEIVED_MIME = 128;
const MAX_RECEIVED_MEDIA = 8;
const MAX_RECEIVED_LIST = 2_000;
const MAX_RECEIVED_BOX = 8_192;
const MAX_RECEIVED_NONCE = 64;
const MAX_RECEIVED_PREVIEW = 48_000;

/**
 * `ts` va dentro de la firma, asi que no se puede recortar sin invalidarla: hay
 * que rechazar. Sin este tope, un `ts` en el futuro fija cualquier regla de
 * "gana el mas nuevo": el consentimiento de un chat no se podia revocar, una
 * invitacion no caducaba nunca y un post quedaba clavado en la cima del feed.
 */
const MAX_TS_SKEW_MS = 10 * 60 * 1000;

/** Suma el tamano de un envelope y rechaza PROFUNDIDAD o tamano abuse. */
function withinReceiveLimits(value: unknown, depth = 0, left = { n: MAX_ENVELOPE_CHARS }): boolean {
  if (depth > MAX_ENVELOPE_DEPTH) return false;
  if (value === null || value === undefined) return true;
  const kind = typeof value;
  if (kind === "string") {
    left.n -= (value as string).length;
    return left.n >= 0;
  }
  if (kind === "number") return Number.isSafeInteger(value as number);
  if (kind === "boolean") return true;
  if (kind !== "object") return false;
  if (Array.isArray(value)) {
    if (value.length > MAX_ENVELOPE_ITEMS) return false;
    left.n -= 2;
    return value.every((item) => withinReceiveLimits(item, depth + 1, left));
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_ENVELOPE_KEYS) return false;
  left.n -= 2;
  return entries.every(([, item]) => withinReceiveLimits(item, depth + 1, left));
}

function clip(text: string, max: number): string {
  return text.slice(0, max);
}

export type ProfileBody = {
  name: string;
  about: string;
  picture?: MediaRef;
  interests?: string[];
};

export type PostBody = {
  text: string;
  media?: MediaRef[];
  replaces?: string;
};

export type FollowsBody = { rpubs: string[] };
export type BlocksBody = { rpubs: string[] };
export type LikeBody = { target: string; kind: ReactionKind; on: boolean };
export type CommentBody = {
  target: string;
  text: string;
  parent?: string;
  replaces?: string;
  media?: MediaRef[];
};
export type ReportBody = { target: string; kind: ReactionKind; on?: boolean };
export type PresenceBody = { online: true };
export type DeleteBody = { target: string };
export type GoneBody = { gone: true };
export type InviteBody = { rpub: string; exp: number };
export type ChatConsentBody = { to: string; on: boolean };
export type ChatTextBody = {
  to: string;
  n: string;
  box: string;
  media?: MediaRef[];
  replaces?: string;
  replies?: string;
};

export type Envelope =
  | { v: 1; type: "profile"; author: string; ts: number; body: ProfileBody; sig: string }
  | { v: 1; type: "post"; author: string; ts: number; body: PostBody; sig: string }
  | { v: 1; type: "follows"; author: string; ts: number; body: FollowsBody; sig: string }
  | { v: 1; type: "blocks"; author: string; ts: number; body: BlocksBody; sig: string }
  | { v: 1; type: "like"; author: string; ts: number; body: LikeBody; sig: string }
  | { v: 1; type: "comment"; author: string; ts: number; body: CommentBody; sig: string }
  | { v: 1; type: "report"; author: string; ts: number; body: ReportBody; sig: string }
  | { v: 1; type: "presence"; author: string; ts: number; body: PresenceBody; sig: string }
  | { v: 1; type: "delete"; author: string; ts: number; body: DeleteBody; sig: string }
  | { v: 1; type: "gone"; author: string; ts: number; body: GoneBody; sig: string }
  | { v: 1; type: "invite"; author: string; ts: number; body: InviteBody; sig: string }
  | { v: 1; type: "chat_consent"; author: string; ts: number; body: ChatConsentBody; sig: string }
  | { v: 1; type: "chat_text"; author: string; ts: number; body: ChatTextBody; sig: string };

/**
 * JSON canónico: claves de objeto ordenadas, arrays en su orden. Dos
 * implementaciones que tengan el mismo sobre producen los mismos bytes, así que
 * la firma no depende del orden de inserción de claves de JavaScript.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(source).sort()) {
      const encoded = canonicalJson(source[key]);
      if (encoded === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${encoded}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) as string;
}

function signedFields(envelope: Omit<Envelope, "sig">) {
  return {
    v: envelope.v,
    type: envelope.type,
    author: envelope.author,
    ts: envelope.ts,
    body: envelope.body,
  };
}

function payloadBytes(envelope: Omit<Envelope, "sig">): Uint8Array {
  return utf8ToBytes(canonicalJson(signedFields(envelope)));
}

/** Firmas v1 creadas antes del orden canónico, en orden de inserción. */
function legacyPayloadBytes(envelope: Omit<Envelope, "sig">): Uint8Array {
  return utf8ToBytes(JSON.stringify(signedFields(envelope)));
}

function short(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length <= max;
}

function isMediaRef(value: unknown): value is MediaRef {
  if (!value || typeof value !== "object") return false;
  const item = value as MediaRef;
  if (typeof item.hash !== "string" || item.hash.length > MAX_RECEIVED_HASH) return false;
  if (typeof item.mime !== "string" || item.mime.length > MAX_RECEIVED_MIME) return false;
  if (typeof item.name !== "string" || item.name.length > MAX_RECEIVED_LABEL) return false;
  // Un preview tiene que ser un data: URI. Aceptar una URL hacia que cada
  // renderizado del post fuera un GET al servidor del autor, con IP, user agent
  // y patron de lectura. Al firmar ya se exigia data:image/; aqui se exige al
  // recibir, que es donde importa.
  if (item.preview !== undefined) {
    if (typeof item.preview !== "string" || item.preview.length > MAX_RECEIVED_PREVIEW) return false;
    if (!item.preview.startsWith("data:image/")) return false;
  }
  return true;
}

function signed<T extends Envelope["type"]>(
  identity: Identity,
  type: T,
  body: Extract<Envelope, { type: T }>["body"],
  ts = Date.now(),
): Envelope {
  const unsigned = {
    v: 1 as const,
    type,
    author: identity.rpub,
    ts,
    body,
  };
  return {
    ...unsigned,
    sig: bytesToHex(signBytes(identity.secret, payloadBytes(unsigned as Omit<Envelope, "sig">))),
  } as Envelope;
}

export function signProfile(identity: Identity, body: ProfileBody, ts = Date.now()): Envelope {
  const next: ProfileBody = {
    name: clip(body.name.trim(), MAX_NAME_CHARS),
    about: clip(body.about.trim(), MAX_BIO_CHARS),
  };
  if (body.picture) {
    const picture: MediaRef = {
      hash: body.picture.hash,
      mime: body.picture.mime,
      name: body.picture.name,
    };
    // El avatar lleva su propio thumbnail en el sobre: así se ve al instante en
    // el feed y los chats, sin esperar a que llegue la imagen completa P2P.
    if (body.picture.preview && body.picture.preview.startsWith("data:image/") && body.picture.preview.length <= 8_000) {
      picture.preview = body.picture.preview;
    }
    next.picture = picture;
  }
  if (body.interests && body.interests.length > 0) {
    next.interests = body.interests.map((item) => item.trim()).filter(Boolean);
  }
  return signed(identity, "profile", next, ts);
}

export function signFollows(identity: Identity, rpubs: string[], ts = Date.now()): Envelope {
  return signed(identity, "follows", { rpubs: [...new Set(rpubs)].sort() }, ts);
}

export function signBlocks(identity: Identity, rpubs: string[], ts = Date.now()): Envelope {
  return signed(identity, "blocks", { rpubs: [...new Set(rpubs)].sort() }, ts);
}

export function signPost(
  identity: Identity,
  input: { text: string; media?: MediaRef[]; replaces?: string },
  ts = Date.now(),
): Envelope {
  const media =
    input.media && input.media.length > 0
      ? input.media.map((item) => {
          const ref: MediaRef = { hash: item.hash, mime: item.mime, name: item.name };
          if (item.preview && item.preview.startsWith("data:image/") && item.preview.length <= 8_000) {
            ref.preview = item.preview;
          }
          return ref;
        })
      : undefined;
  const body: PostBody = { text: clip(stripBlobText(input.text), MAX_POST_CHARS) };
  if (media) body.media = media;
  if (input.replaces) body.replaces = input.replaces;
  return signed(identity, "post", body, ts);
}

export function signDelete(identity: Identity, target: string, ts = Date.now()): Envelope {
  return signed(identity, "delete", { target }, ts);
}

export function signLike(
  identity: Identity,
  input: { target: string; kind: ReactionKind; on: boolean },
  ts = Date.now(),
): Envelope {
  return signed(identity, "like", input, ts);
}

export function signComment(
  identity: Identity,
  input: { target: string; text: string; parent?: string; replaces?: string; media?: MediaRef[] },
  ts = Date.now(),
): Envelope {
  const body: CommentBody = { target: input.target, text: clip(input.text.trim(), MAX_COMMENT_CHARS) };
  if (input.parent) body.parent = input.parent;
  if (input.replaces) body.replaces = input.replaces;
  if (input.media && input.media.length > 0) {
    body.media = input.media.map((item) => ({ hash: item.hash, mime: item.mime, name: item.name }));
  }
  return signed(identity, "comment", body, ts);
}

export function signReport(
  identity: Identity,
  input: { target: string; kind: ReactionKind; on?: boolean },
  ts = Date.now(),
): Envelope {
  return signed(identity, "report", { ...input, on: input.on !== false }, ts);
}

export function signGone(identity: Identity, ts = Date.now()): Envelope {
  return signed(identity, "gone", { gone: true }, ts);
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signInvite(identity: Identity, rpub: string, ts = Date.now()): Envelope {
  return signed(identity, "invite", { rpub: rpub.trim(), exp: ts + INVITE_TTL_MS }, ts);
}

export function signChatConsent(identity: Identity, to: string, on: boolean, ts = Date.now()): Envelope {
  return signed(identity, "chat_consent", { to: to.trim(), on }, ts);
}

export function signChatText(
  identity: Identity,
  input: { to: string; n: string; box: string; media?: MediaRef[]; replaces?: string; replies?: string },
  ts = Date.now(),
): Envelope {
  const body: ChatTextBody = { to: input.to.trim(), n: input.n, box: input.box };
  if (input.media && input.media.length > 0) {
    body.media = input.media.map((item) => ({ hash: item.hash, mime: item.mime, name: item.name }));
  }
  if (input.replaces) body.replaces = input.replaces;
  if (input.replies) body.replies = input.replies;
  return signed(identity, "chat_text", body, ts);
}

export function verifyEnvelope(envelope: Envelope): boolean {
  try {
    if (envelope.v !== 1) return false;
    const publicKey = parseRpub(envelope.author);
    const { sig, ...unsigned } = envelope;
    const signature = hexToBytes(sig);
    if (verifyBytes(publicKey, payloadBytes(unsigned), signature)) return true;
    return verifyBytes(publicKey, legacyPayloadBytes(unsigned), signature);
  } catch {
    return false;
  }
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== "object") return false;
  const env = value as Envelope;
  if (env.v !== 1 || typeof env.author !== "string" || typeof env.ts !== "number" || typeof env.sig !== "string") {
    return false;
  }
  if (!withinReceiveLimits(env)) return false;
  if (env.author.length > MAX_RECEIVED_HASH || !short(env.sig, MAX_RECEIVED_LABEL)) return false;
  // Un ts en el futuro rompe todas las reglas de "gana el mas nuevo". Como va
  // firmado no se puede normalizar, asi que se descarta.
  if (!Number.isSafeInteger(env.ts) || env.ts < 0 || env.ts > Date.now() + MAX_TS_SKEW_MS) return false;
  if (env.type === "profile") {
    if (!short(env.body?.name, MAX_RECEIVED_LABEL) || !short(env.body?.about, MAX_RECEIVED_TEXT)) return false;
    if (env.body.picture !== undefined && !isMediaRef(env.body.picture)) return false;
    if (env.body.interests !== undefined) {
      if (!Array.isArray(env.body.interests) || env.body.interests.length > MAX_RECEIVED_LIST) return false;
      if (!env.body.interests.every((item) => short(item, MAX_RECEIVED_LABEL))) return false;
    }
    return true;
  }
  if (env.type === "post") {
    if (!short(env.body?.text, MAX_RECEIVED_TEXT)) return false;
    if (env.body.replaces !== undefined && !short(env.body.replaces, MAX_RECEIVED_LABEL)) return false;
    return (
      env.body.media === undefined ||
      (Array.isArray(env.body.media) &&
        env.body.media.length <= MAX_RECEIVED_MEDIA &&
        env.body.media.every(isMediaRef))
    );
  }
  if (env.type === "follows" || env.type === "blocks") {
    if (!Array.isArray(env.body?.rpubs) || env.body.rpubs.length > MAX_RECEIVED_LIST) return false;
    return env.body.rpubs.every((item) => short(item, MAX_RECEIVED_HASH));
  }
  if (env.type === "like") {
    return (
      short(env.body?.target, MAX_RECEIVED_LABEL) &&
      typeof env.body?.on === "boolean" &&
      (env.body.kind === "post" || env.body.kind === "image" || env.body.kind === "comment")
    );
  }
  if (env.type === "comment") {
    if (!short(env.body?.target, MAX_RECEIVED_LABEL) || !short(env.body?.text, MAX_RECEIVED_TEXT)) return false;
    if (env.body.parent !== undefined && !short(env.body.parent, MAX_RECEIVED_LABEL)) return false;
    if (env.body.replaces !== undefined && !short(env.body.replaces, MAX_RECEIVED_LABEL)) return false;
    return (
      env.body.media === undefined ||
      (Array.isArray(env.body.media) &&
        env.body.media.length <= MAX_RECEIVED_MEDIA &&
        env.body.media.every(isMediaRef))
    );
  }
  if (env.type === "report") {
    if (env.body?.on !== undefined && typeof env.body.on !== "boolean") return false;
    return (
      short(env.body?.target, MAX_RECEIVED_LABEL) &&
      (env.body.kind === "post" || env.body.kind === "image" || env.body.kind === "comment")
    );
  }
  if (env.type === "presence") {
    return env.body?.online === true;
  }
  if (env.type === "delete") {
    return short(env.body?.target, MAX_RECEIVED_LABEL);
  }
  if (env.type === "gone") {
    return env.body?.gone === true;
  }
  if (env.type === "invite") {
    // `exp` lo elige el firmante, asi que sin este tope una invitacion con
    // exp = MAX_SAFE_INTEGER no caduca nunca y avala para siempre.
    if (!short(env.body?.rpub, MAX_RECEIVED_HASH)) return false;
    if (!Number.isSafeInteger(env.body?.exp)) return false;
    return env.body.exp > env.ts && env.body.exp - env.ts <= INVITE_TTL_MS + MAX_TS_SKEW_MS;
  }
  if (env.type === "chat_consent") {
    return short(env.body?.to, MAX_RECEIVED_HASH) && typeof env.body?.on === "boolean";
  }
  if (env.type === "chat_text") {
    if (!short(env.body?.to, MAX_RECEIVED_HASH) || !short(env.body?.box, MAX_RECEIVED_BOX)) return false;
    if (!short(env.body?.n, MAX_RECEIVED_NONCE)) return false;
    if (env.body.replaces !== undefined && !short(env.body.replaces, MAX_RECEIVED_LABEL)) return false;
    if (env.body.replies !== undefined && !short(env.body.replies, MAX_RECEIVED_LABEL)) return false;
    return (
      env.body.media === undefined ||
      (Array.isArray(env.body.media) &&
        env.body.media.length <= MAX_RECEIVED_MEDIA &&
        env.body.media.every(isMediaRef))
    );
  }
  return false;
}

export function mediaRefsOf(envelope: Envelope): MediaRef[] {
  if (envelope.type === "profile" && envelope.body.picture) return [envelope.body.picture];
  if (envelope.type === "post" && envelope.body.media) return envelope.body.media;
  if (envelope.type === "comment" && envelope.body.media) return envelope.body.media;
  if (envelope.type === "chat_text" && envelope.body.media) return envelope.body.media;
  return [];
}
