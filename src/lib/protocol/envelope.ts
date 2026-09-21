import { bytesToHex, hexToBytes, utf8ToBytes } from "./bytes";
import {
  parseRpub,
  signBytes,
  verifyBytes,
  type Identity,
} from "./identity";
import { stripBlobText, type MediaRef } from "./media";

export type EnvelopeType =
  | "profile"
  | "post"
  | "follows"
  | "blocks"
  | "like"
  | "comment"
  | "report"
  | "presence"
  | "delete"
  | "gone"
  | "invite"
  | "chat_consent"
  | "chat_text";
export type ReactionKind = "post" | "image" | "comment";

export const MAX_POST_CHARS = 280;
export const MAX_COMMENT_CHARS = 280;
export const MAX_NAME_CHARS = 50;
export const MAX_BIO_CHARS = 160;
export const MAX_CHAT_CHARS = 280;

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
export type CommentBody = { target: string; text: string; parent?: string; replaces?: string };
export type ReportBody = { target: string; kind: ReactionKind; on?: boolean };
export type PresenceBody = { online: true };
export type DeleteBody = { target: string };
export type GoneBody = { gone: true };
export type InviteBody = { rpub: string; exp: number };
export type ChatConsentBody = { to: string; on: boolean };
export type ChatTextBody = { to: string; n: string; box: string };

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

function payloadBytes(envelope: Omit<Envelope, "sig">): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({
      v: envelope.v,
      type: envelope.type,
      author: envelope.author,
      ts: envelope.ts,
      body: envelope.body,
    }),
  );
}

function isMediaRef(value: unknown): value is MediaRef {
  if (!value || typeof value !== "object") return false;
  const item = value as MediaRef;
  if (typeof item.hash !== "string" || typeof item.mime !== "string" || typeof item.name !== "string") return false;
  if (item.preview !== undefined && typeof item.preview !== "string") return false;
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
    next.picture = {
      hash: body.picture.hash,
      mime: body.picture.mime,
      name: body.picture.name,
    };
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
  input: { target: string; text: string; parent?: string; replaces?: string },
  ts = Date.now(),
): Envelope {
  const body: CommentBody = { target: input.target, text: clip(input.text.trim(), MAX_COMMENT_CHARS) };
  if (input.parent) body.parent = input.parent;
  if (input.replaces) body.replaces = input.replaces;
  return signed(identity, "comment", body, ts);
}

export function signReport(
  identity: Identity,
  input: { target: string; kind: ReactionKind; on?: boolean },
  ts = Date.now(),
): Envelope {
  return signed(identity, "report", { ...input, on: input.on !== false }, ts);
}

export function signPresence(identity: Identity, ts = Date.now()): Envelope {
  return signed(identity, "presence", { online: true }, ts);
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
  input: { to: string; n: string; box: string },
  ts = Date.now(),
): Envelope {
  return signed(identity, "chat_text", { to: input.to.trim(), n: input.n, box: input.box }, ts);
}

export function verifyEnvelope(envelope: Envelope): boolean {
  try {
    if (envelope.v !== 1) return false;
    const publicKey = parseRpub(envelope.author);
    const { sig, ...unsigned } = envelope;
    return verifyBytes(publicKey, payloadBytes(unsigned), hexToBytes(sig));
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
  if (env.type === "profile") {
    if (typeof env.body?.name !== "string" || typeof env.body?.about !== "string") return false;
    if (env.body.picture !== undefined && !isMediaRef(env.body.picture)) return false;
    if (env.body.interests !== undefined && !Array.isArray(env.body.interests)) return false;
    return true;
  }
  if (env.type === "post") {
    if (typeof env.body?.text !== "string") return false;
    if (env.body.replaces !== undefined && typeof env.body.replaces !== "string") return false;
    return env.body.media === undefined || (Array.isArray(env.body.media) && env.body.media.every(isMediaRef));
  }
  if (env.type === "follows" || env.type === "blocks") {
    return Array.isArray(env.body?.rpubs) && env.body.rpubs.every((item) => typeof item === "string");
  }
  if (env.type === "like") {
    return (
      typeof env.body?.target === "string" &&
      typeof env.body?.on === "boolean" &&
      (env.body.kind === "post" || env.body.kind === "image" || env.body.kind === "comment")
    );
  }
  if (env.type === "comment") {
    if (typeof env.body?.target !== "string" || typeof env.body?.text !== "string") return false;
    if (env.body.parent !== undefined && typeof env.body.parent !== "string") return false;
    if (env.body.replaces !== undefined && typeof env.body.replaces !== "string") return false;
    return true;
  }
  if (env.type === "report") {
    if (env.body?.on !== undefined && typeof env.body.on !== "boolean") return false;
    return (
      typeof env.body?.target === "string" &&
      (env.body.kind === "post" || env.body.kind === "image" || env.body.kind === "comment")
    );
  }
  if (env.type === "presence") {
    return env.body?.online === true;
  }
  if (env.type === "delete") {
    return typeof env.body?.target === "string";
  }
  if (env.type === "gone") {
    return env.body?.gone === true;
  }
  if (env.type === "invite") {
    return typeof env.body?.rpub === "string" && typeof env.body?.exp === "number";
  }
  if (env.type === "chat_consent") {
    return typeof env.body?.to === "string" && typeof env.body?.on === "boolean";
  }
  if (env.type === "chat_text") {
    return (
      typeof env.body?.to === "string" && typeof env.body?.n === "string" && typeof env.body?.box === "string"
    );
  }
  return false;
}

export function mediaRefsOf(envelope: Envelope): MediaRef[] {
  if (envelope.type === "profile" && envelope.body.picture) return [envelope.body.picture];
  if (envelope.type === "post" && envelope.body.media) return envelope.body.media;
  return [];
}
