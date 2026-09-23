import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createIdentity,
  fromSecret,
  parseRpub,
  parseSecretInput,
  type Identity,
} from "@/lib/protocol/identity";
import {
  latestFollows,
  latestProfile,
  authorIsGone,
  listKnownRpubs,
  loadLog,
  appendEnvelope,
  onStorageTrim,
} from "@/lib/protocol/store";
import {
  signBlocks,
  signComment,
  signFollows,
  signLike,
  signDelete,
  signGone,
  signInvite,
  signChatConsent,
  signChatText,
  signPost,
  signProfile,
  signReport,
  MAX_CHAT_CHARS,
  type Envelope,
  type ProfileBody,
  type ReactionKind,
} from "@/lib/protocol/envelope";
import {
  canStripChatMedia as chatMediaStillEditable,
  chatLines,
  chatPeers,
  chatPhase,
  sealChat,
  type ChatLine,
  type ChatPhase,
} from "@/lib/protocol/chat";
import { dropMedia, MAX_PHOTOS, onMediaStored, type MediaRef } from "@/lib/protocol/media";
import { applyBundle, buildBundle, downloadBundle, parseBundle } from "@/lib/protocol/bundle";
import {
  loadVault,
  saveVault,
  unwrapVault,
  wrapSecret,
  type VaultRecord,
} from "@/lib/protocol/vault";
import { ProtocolError } from "@/lib/protocol/errors";
import { purgeForeignIdentities, wipeBrowserRita, wipeRitaPreservingInvite } from "@/lib/protocol/wipe";
import { fetchStaffBlocks, type StaffBlocks } from "@/lib/protocol/adminBlocks";
import {
  assertSingleSession,
  clearUnlockedRsec,
  claimSession,
  heartbeatSession,
  loadUnlockedRsec,
  notifySessionExists,
  releaseSession,
  saveUnlockedRsec,
} from "@/lib/protocol/session";
import { acceptRemoteEnvelope, broadcastEnvelope, listenEnvelopes } from "@/lib/protocol/bus";
import {
  ingestMeshPacket,
  listenMesh,
  onMeshStatus,
  onModeration,
  publishMesh,
  requestPeerData,
  type LivePeer,
} from "@/lib/protocol/mesh";
import { loadSaves, toggleSaved as toggleSavedStore } from "@/lib/protocol/saves";
import {
  allEnvelopes,
  canEditPost,
  canMutateComment,
  commentsOf,
  imageTarget,
  isHiddenByReports,
  isOnline,
  latestBlocks,
  MAX_AUTHOR_POSTS,
  reportedByMe,
  reportsOf,
  visiblePostsOf,
} from "@/lib/protocol/social";
import { likeStats, loadLikeIndex, mergeLikes, saveLikeIndex, setLike } from "@/lib/protocol/likeIndex";
import { countLinks, isQuarantined, MAX_TEXT_LINKS, vouchedBy } from "@/lib/protocol/spam";
import { noteCreateSuccess } from "@/lib/protocol/signupGuard";
import { assertBetaInvite } from "@/lib/protocol/betaInvite";
import { latestConsent } from "@/lib/protocol/chat";
import {
  dropNotice,
  dropNoticesFor,
  loadNotices,
  noticeFromEnvelope,
  pingDesktop,
  playNoticeBeep,
  pushNotice,
  type Notice,
  type NoticeKind,
} from "@/lib/protocol/notices";

export type SessionStatus = "anonymous" | "locked" | "ready";

export type Person = {
  rpub: string;
  profile: ProfileBody | null;
  online: boolean;
  avatarUrl?: string;
};

export type FeedItem = {
  event: Envelope;
  profile: ProfileBody | null;
  avatarUrl?: string;
};

type RitaContextValue = {
  status: SessionStatus;
  vault: VaultRecord | null;
  identity: Identity | null;
  log: Envelope[];
  posts: Envelope[];
  feed: FeedItem[];
  profile: ProfileBody | null;
  follows: string[];
  people: Person[];
  signalOn: boolean;
  error: string | null;
  createAccount: (opts: {
    password: string;
    name: string;
    about: string;
    picture?: MediaRef;
  }) => Promise<Identity>;
  importSecret: (secret: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  logout: () => void;
  wipeIdentity: () => Promise<void>;
  publishPost: (text: string, media?: MediaRef[]) => void;
  editPost: (post: Envelope, text: string, media?: MediaRef[]) => void;
  deletePost: (post: Envelope) => void;
  canEdit: (post: Envelope) => boolean;
  publishProfile: (profile: ProfileBody) => void;
  follow: (rpub: string) => void;
  invitePeer: (rpub: string) => void;
  invited: string[];
  unfollow: (rpub: string) => void;
  block: (rpub: string) => void;
  unblock: (rpub: string) => void;
  blocks: string[];
  requestChat: (rpub: string) => void;
  acceptChat: (rpub: string) => void;
  revokeChat: (rpub: string) => void;
  sendChat: (rpub: string, text: string, media?: MediaRef, replies?: string) => void;
  stripChatMedia: (rpub: string, line: ChatLine, hash: string) => void;
  canStripChat: (line: ChatLine) => boolean;
  chatPhaseOf: (rpub: string) => ChatPhase;
  chatLinesOf: (rpub: string) => ChatLine[];
  chatPeerList: string[];
  notices: Notice[];
  dismissNotice: (id: string) => void;
  dismissNoticesFor: (match: { kind?: NoticeKind | NoticeKind[]; from?: string }) => void;
  toggleLike: (target: string, kind: ReactionKind) => void;
  addComment: (postSig: string, text: string, parent?: string, media?: MediaRef) => void;
  editComment: (comment: Envelope, text: string, media?: MediaRef[]) => void;
  deleteComment: (comment: Envelope) => void;
  canMutateComment: (comment: Envelope) => boolean;
  report: (target: string, kind: ReactionKind) => void;
  toggleSave: (postSig: string) => void;
  saves: string[];
  allEvents: Envelope[];
  likes: (target: string) => { count: number; mine: boolean };
  comments: (postSig: string) => Envelope[];
  reports: (target: string) => { count: number; mine: boolean; hidden: boolean };
  imageTarget: (postSig: string, hash: string) => string;
  profileOf: (rpub: string) => ProfileBody | null;
  postsOfRpub: (rpub: string) => Envelope[];
  personByRpub: (rpub: string) => Person | undefined;
  askPeerData: (rpub: string) => void;
  exportPublic: () => Promise<void>;
  exportBackup: () => Promise<void>;
  importBundleFile: (file: File) => Promise<{ authors: number; vaultRestored: boolean }>;
};

const RitaContext = createContext<RitaContextValue | null>(null);

function tryRestoreIdentity(vault: VaultRecord | null): Identity | null {
  if (!vault) return null;
  const rsec = loadUnlockedRsec();
  if (!rsec) return null;
  try {
    const identity = fromSecret(parseSecretInput(rsec));
    if (identity.rpub !== vault.rpub) {
      clearUnlockedRsec();
      return null;
    }
    claimSession(identity.rpub);
    return identity;
  } catch {
    clearUnlockedRsec();
    return null;
  }
}

function personFrom(rpub: string, events: Envelope[]): Person {
  const profileEnv = latestProfile(loadLog(rpub));
  return {
    rpub,
    profile: profileEnv?.type === "profile" ? profileEnv.body : null,
    online: isOnline(events, rpub),
  };
}

export function RitaProvider({ children }: { children: ReactNode }) {
  const [vault, setVault] = useState<VaultRecord | null>(() => loadVault());
  const [identity, setIdentity] = useState<Identity | null>(() => tryRestoreIdentity(loadVault()));
  const [log, setLog] = useState<Envelope[]>(() => {
    const restored = tryRestoreIdentity(loadVault());
    return restored ? loadLog(restored.rpub) : [];
  });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>(() => {
    const currentVault = loadVault();
    if (tryRestoreIdentity(currentVault)) return "ready";
    return currentVault ? "locked" : "anonymous";
  });
  const [catalog, setCatalog] = useState(0);
  const [livePeers, setLivePeers] = useState<LivePeer[]>([]);
  const [signalOn, setSignalOn] = useState(false);
  const [staffBlocks, setStaffBlocks] = useState<StaffBlocks>({ users: [], comments: [] });
  const [likeIndex, setLikeIndex] = useState(loadLikeIndex);
  const [notices, setNotices] = useState<Notice[]>([]);

  const bump = useCallback(() => setCatalog((n) => n + 1), []);

  const emit = useCallback(
    (envelope: Envelope) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      const next = appendEnvelope(identity.rpub, envelope);
      setLog(next);
      bump();
      broadcastEnvelope(envelope);
      void publishMesh(envelope).catch(() => undefined);
    },
    [bump, identity],
  );

  const hydrate = useCallback((next: Identity) => {
    assertSingleSession(next.rpub);
    saveUnlockedRsec(next.rsec);
    const stored = loadLog(next.rpub);
    setIdentity(next);
    setLog(stored);
    setError(null);
    setStatus("ready");
    bump();
  }, [bump]);

  const createAccount = useCallback(
    async ({
      password,
      name,
      about,
      picture,
    }: {
      password: string;
      name: string;
      about: string;
      picture?: MediaRef;
    }) => {
      if (loadVault()) throw new ProtocolError("account_exists");
      await wipeRitaPreservingInvite();
      await assertBetaInvite();
      const next = createIdentity();
      const record = await wrapSecret(next, password);
      setVault(record);
      const profile = signProfile(next, { name: name.trim() || "Rita", about, picture });
      appendEnvelope(next.rpub, profile);
      noteCreateSuccess();
      purgeForeignIdentities(next.rpub);
      hydrate(next);
      return next;
    },
    [hydrate],
  );

  useEffect(() => {
    if (!identity) return;
    return onStorageTrim((dropped) => {
      for (const event of dropped) {
        if (event.author !== identity.rpub || !event.sig) continue;
        if (event.type !== "post" && event.type !== "chat_text" && event.type !== "comment") continue;
        emit(signDelete(identity, event.sig));
      }
      setSaves(loadSaves(identity.rpub));
      bump();
    });
  }, [emit, identity]);

  const importSecret = useCallback(
    async (secret: string, password: string) => {
      await assertBetaInvite();
      const next = fromSecret(parseSecretInput(secret));
      if (identity?.rpub === next.rpub && status === "ready") {
        notifySessionExists();
        throw new ProtocolError("session_exists");
      }
      const existing = loadVault();
      if (existing && existing.rpub !== next.rpub) {
        await wipeRitaPreservingInvite();
      } else {
        purgeForeignIdentities(next.rpub);
      }
      const record = await wrapSecret(next, password);
      setVault(record);
      hydrate(next);
    },
    [hydrate, identity, status],
  );

  const unlock = useCallback(
    async (password: string) => {
      const record = loadVault();
      if (!record) {
        throw new ProtocolError("no_vault");
      }
      const next = await unwrapVault(record, password);
      setVault(record);
      hydrate(next);
    },
    [hydrate],
  );

  const logout = useCallback(() => {
    if (identity) releaseSession(identity.rpub);
    clearUnlockedRsec();
    setIdentity(null);
    setLog([]);
    setStatus(loadVault() ? "locked" : "anonymous");
    bump();
  }, [bump, identity]);

  const wipeIdentity = useCallback(async () => {
    if (identity) {
      const gone = signGone(identity);
      broadcastEnvelope(gone);
      await publishMesh(gone).catch(() => undefined);
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      releaseSession(identity.rpub);
    }
    clearUnlockedRsec();
    await wipeBrowserRita();
    window.location.assign("/welcome");
  }, [identity]);

  const publishPost = useCallback(
    (text: string, media?: MediaRef[]) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      if (!text.trim() && (!media || media.length === 0)) {
        throw new ProtocolError("empty_post");
      }
      if (countLinks(text) > MAX_TEXT_LINKS) {
        throw new ProtocolError("too_many_links");
      }
      if (media && media.filter((item) => item.mime.startsWith("image/")).length > MAX_PHOTOS) {
        throw new ProtocolError("media_too_many");
      }
      emit(signPost(identity, { text, media }));
      const extras = visiblePostsOf(loadLog(identity.rpub), identity.rpub).slice(MAX_AUTHOR_POSTS);
      for (const extra of extras) {
        if (extra.sig) emit(signDelete(identity, extra.sig));
      }
    },
    [emit, identity],
  );

  const deletePost = useCallback(
    (post: Envelope) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      if (post.type !== "post" || !post.sig) throw new ProtocolError("invalid_envelope");
      if (post.author !== identity.rpub) throw new ProtocolError("cannot_delete_other");
      emit(signDelete(identity, post.sig));
    },
    [emit, identity],
  );

  const editPost = useCallback(
    (post: Envelope, text: string, media?: MediaRef[]) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      if (post.type !== "post" || !post.sig) throw new ProtocolError("invalid_envelope");
      if (post.author !== identity.rpub) throw new ProtocolError("cannot_edit_other");
      if (!canEditPost(allEnvelopes(), post) && !canEditPost(log, post)) {
        throw new ProtocolError("edit_too_late");
      }
      const nextMedia = media !== undefined ? media : post.body.media;
      if (!text.trim() && !(nextMedia && nextMedia.length > 0)) {
        throw new ProtocolError("empty_post");
      }
      if (countLinks(text) > MAX_TEXT_LINKS) {
        throw new ProtocolError("too_many_links");
      }
      emit(
        signPost(identity, {
          text,
          media: nextMedia && nextMedia.length > 0 ? nextMedia : undefined,
          replaces: post.sig,
        }),
      );
    },
    [emit, identity, log],
  );

  const canEdit = useCallback(
    (post: Envelope) => {
      if (!identity || post.author !== identity.rpub) return false;
      return canEditPost(allEnvelopes(), post) || canEditPost(log, post);
    },
    [identity, log],
  );

  const publishProfile = useCallback(
    (profile: ProfileBody) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      emit(signProfile(identity, profile));
    },
    [emit, identity],
  );

  const follows = latestFollows(log);
  const invited = identity ? [...vouchedBy(log, [identity.rpub])] : [];

  const follow = useCallback(
    (raw: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      parseRpub(raw);
      const rpub = raw.trim();
      if (rpub === identity.rpub) throw new ProtocolError("cannot_follow_self");
      const next = [...new Set([...follows, rpub])];
      emit(signFollows(identity, next));
    },
    [emit, follows, identity],
  );

  const invitePeer = useCallback(
    (raw: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      parseRpub(raw);
      const rpub = raw.trim();
      if (rpub === identity.rpub) throw new ProtocolError("invite_self");
      emit(signInvite(identity, rpub));
    },
    [emit, identity],
  );

  const unfollow = useCallback(
    (rpub: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      emit(signFollows(identity, follows.filter((item) => item !== rpub)));
    },
    [emit, follows, identity],
  );

  const blocks = latestBlocks(log);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const block = useCallback(
    (raw: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      parseRpub(raw);
      const rpub = raw.trim();
      if (rpub === identity.rpub) throw new ProtocolError("cannot_block_self");
      emit(signBlocks(identity, [...blocks, rpub]));
      emit(signChatConsent(identity, rpub, false));
      if (follows.includes(rpub)) emit(signFollows(identity, follows.filter((item) => item !== rpub)));
    },
    [blocks, emit, follows, identity],
  );

  const unblock = useCallback(
    (rpub: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      emit(signBlocks(identity, blocks.filter((item) => item !== rpub)));
    },
    [blocks, emit, identity],
  );

  const setChatOn = useCallback(
    (raw: string, on: boolean) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      parseRpub(raw);
      const rpub = raw.trim();
      if (rpub === identity.rpub) throw new ProtocolError("chat_self");
      if (on && blocks.includes(rpub)) throw new ProtocolError("chat_blocked");
      emit(signChatConsent(identity, rpub, on));
    },
    [blocks, emit, identity],
  );

  const requestChat = useCallback(
    (rpub: string) => {
      setChatOn(rpub, true);
    },
    [setChatOn],
  );

  const acceptChat = useCallback(
    (rpub: string) => {
      setChatOn(rpub, true);
    },
    [setChatOn],
  );

  const revokeChat = useCallback(
    (rpub: string) => {
      setChatOn(rpub, false);
    },
    [setChatOn],
  );

  const toggleLike = useCallback(
    (target: string, kind: ReactionKind) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      const mine = likeStats(likeIndex, target, identity.rpub).mine;
      const next = setLike(likeIndex, target, identity.rpub, !mine);
      saveLikeIndex(next);
      setLikeIndex(next);
      emit(signLike(identity, { target, kind, on: !mine }));
    },
    [emit, identity, likeIndex],
  );

  const addComment = useCallback(
    (postSig: string, text: string, parent?: string, media?: MediaRef) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      if (!text.trim() && !media) throw new ProtocolError("empty_comment");
      if (countLinks(text) > MAX_TEXT_LINKS) throw new ProtocolError("too_many_links");
      emit(signComment(identity, { target: postSig, text, parent, media: media ? [media] : undefined }));
    },
    [emit, identity],
  );

  const editComment = useCallback(
    (comment: Envelope, text: string, media?: MediaRef[]) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      if (comment.type !== "comment" || !comment.sig) throw new ProtocolError("invalid_envelope");
      if (comment.author !== identity.rpub) throw new ProtocolError("cannot_edit_other");
      if (!canMutateComment(allEnvelopes(), comment) && !canMutateComment(log, comment)) {
        throw new ProtocolError("comment_too_late");
      }
      const nextMedia = media !== undefined ? media : comment.body.media;
      if (!text.trim() && !(nextMedia && nextMedia.length > 0)) throw new ProtocolError("empty_comment");
      if (countLinks(text) > MAX_TEXT_LINKS) throw new ProtocolError("too_many_links");
      emit(
        signComment(identity, {
          target: comment.body.target,
          text,
          parent: comment.body.parent,
          replaces: comment.sig,
          media: nextMedia && nextMedia.length > 0 ? nextMedia : undefined,
        }),
      );
    },
    [emit, identity, log],
  );

  const deleteComment = useCallback(
    (comment: Envelope) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      if (comment.type !== "comment" || !comment.sig) throw new ProtocolError("invalid_envelope");
      if (comment.author !== identity.rpub) throw new ProtocolError("cannot_delete_other");
      if (!canMutateComment(allEnvelopes(), comment) && !canMutateComment(log, comment)) {
        throw new ProtocolError("comment_too_late");
      }
      emit(signDelete(identity, comment.sig));
    },
    [emit, identity, log],
  );

  const canChangeComment = useCallback(
    (comment: Envelope) => {
      if (!identity || comment.author !== identity.rpub) return false;
      return canMutateComment(allEnvelopes(), comment) || canMutateComment(log, comment);
    },
    [identity, log],
  );

  const report = useCallback(
    (target: string, kind: ReactionKind) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      const mine = reportedByMe(allEnvelopes(), target, identity.rpub);
      emit(signReport(identity, { target, kind, on: !mine }));
    },
    [emit, identity],
  );

  const [saves, setSaves] = useState<string[]>(() => []);
  useEffect(() => {
    setSaves(identity ? loadSaves(identity.rpub) : []);
  }, [identity]);

  const toggleSave = useCallback(
    (postSig: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      setSaves(toggleSavedStore(identity.rpub, postSig));
    },
    [identity],
  );

  const profileOf = useCallback(
    (rpub: string) => {
      const local = personFrom(rpub, allEnvelopes()).profile;
      const peer = livePeers.find((item) => item.rpub === rpub);
      if (!local && !peer) return null;
      return {
        name: local?.name || peer?.name || "",
        about: local?.about ?? "",
        picture: local?.picture,
        interests: local?.interests?.length ? local.interests : peer?.interests,
      };
    },
    [catalog, livePeers],
  );

  const postsOfRpub = useCallback((rpub: string) => visiblePostsOf(loadLog(rpub), rpub), [catalog]);

  const exportPublic = useCallback(async () => {
    if (!identity) throw new ProtocolError("not_unlocked");
    const bundle = await buildBundle({ kind: "public", rpubs: [identity.rpub] });
    downloadBundle(bundle, `magicrita-${identity.rpub.slice(0, 12)}.json`);
  }, [identity]);

  const exportBackup = useCallback(async () => {
    if (!identity) throw new ProtocolError("not_unlocked");
    const rpubs = [...new Set([identity.rpub, ...listKnownRpubs()])];
    const bundle = await buildBundle({
      kind: "backup",
      rpubs,
      vault: vault ?? undefined,
    });
    downloadBundle(bundle, `magicrita-backup-${Date.now()}.json`);
  }, [identity, vault]);

  const importBundleFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const bundle = parseBundle(text);
      if (bundle.kind === "backup" && bundle.vault) {
        if (identity && identity.rpub !== bundle.vault.rpub) {
          throw new ProtocolError("backup_conflict");
        }
        saveVault(bundle.vault);
        setVault(bundle.vault);
        if (!identity) setStatus("locked");
      }
      const authors = await applyBundle(bundle);
      if (identity) {
        setLog(loadLog(identity.rpub));
      }
      bump();
      return {
        authors: authors.length,
        vaultRestored: Boolean(bundle.kind === "backup" && bundle.vault),
      };
    },
    [bump, identity],
  );

  useEffect(() => {
    if (identity) setNotices(loadNotices(identity.rpub));
    else setNotices([]);
  }, [identity?.rpub]);

  const captureNotice = useCallback(
    (envelope: Envelope) => {
      if (!identity) return;
      if (blocksRef.current.includes(envelope.author)) return;
      const notice = noticeFromEnvelope(envelope, identity.rpub);
      if (!notice) return;
      if (
        notice.kind === "request" &&
        latestConsent(loadLog(identity.rpub), identity.rpub, notice.from) === true
      ) {
        return;
      }
      setNotices(pushNotice(identity.rpub, notice));
      if (notice.kind === "chat") playNoticeBeep();
      pingDesktop(
        "MagicRita",
        notice.kind === "chat"
          ? "Nuevo mensaje"
          : notice.kind === "request"
            ? "Petición de chat"
            : "Te han invitado",
        notice.id,
      );
    },
    [identity],
  );

  const dismissNotice = useCallback(
    (id: string) => {
      if (!identity) return;
      setNotices(dropNotice(identity.rpub, id));
    },
    [identity],
  );

  const dismissNoticesMatching = useCallback(
    (match: { kind?: NoticeKind | NoticeKind[]; from?: string }) => {
      if (!identity) return;
      setNotices(dropNoticesFor(identity.rpub, match));
    },
    [identity],
  );

  useEffect(() => {
    return listenEnvelopes((envelope) => {
      if (acceptRemoteEnvelope(envelope)) {
        captureNotice(envelope);
        bump();
      }
    });
  }, [bump, captureNotice]);

  useEffect(() => {
    if (status !== "ready" || !identity) return;
    heartbeatSession(identity.rpub);
    const timer = window.setInterval(() => heartbeatSession(identity.rpub), 4000);
    return () => window.clearInterval(timer);
  }, [identity, status]);

  const profileEnvelope = latestProfile(log);
  const profile = profileEnvelope?.type === "profile" ? profileEnvelope.body : null;
  const posts = visiblePostsOf(log, identity?.rpub);

  useEffect(() => {
    if (status !== "ready" || !identity) return;
    const meta = latestProfile(loadLog(identity.rpub));
    const stopMesh = listenMesh(
      {
        rpub: identity.rpub,
        name: (meta?.type === "profile" ? meta.body.name : "") || "",
        interests: meta?.type === "profile" ? (meta.body.interests ?? []) : [],
      },
      (packet) => {
        void ingestMeshPacket(packet).then((changed) => {
          if (!changed) return;
          if (packet.envelope.type === "gone") {
            setLikeIndex(loadLikeIndex());
            setSaves(loadSaves(identity.rpub));
          }
          captureNotice(packet.envelope);
          bump();
        });
      },
      setLivePeers,
    );
    const stopStatus = onMeshStatus(setSignalOn);
    const stopMod = onModeration(setStaffBlocks);
    return () => {
      stopMesh();
      stopStatus();
      stopMod();
    };
  }, [bump, captureNotice, identity?.rpub, status]);

  useEffect(() => {
    void fetchStaffBlocks().then(setStaffBlocks);
  }, []);

  useEffect(() => onMediaStored(() => bump()), [bump]);
  const allEvents = useMemo(() => {
    const map = new Map<string, Envelope>();
    for (const event of allEnvelopes()) {
      if (event.sig) map.set(event.sig, event);
    }
    for (const event of log) {
      if (event.sig) map.set(event.sig, event);
    }
    return [...map.values()];
  }, [catalog, log]);

  const sendChat = useCallback(
    (raw: string, text: string, media?: MediaRef, replies?: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      parseRpub(raw);
      const rpub = raw.trim();
      if (rpub === identity.rpub) throw new ProtocolError("chat_self");
      const clipped = text.trim().slice(0, MAX_CHAT_CHARS);
      if (!clipped && !media) throw new ProtocolError("empty_chat");
      if (chatPhase(allEvents, identity.rpub, rpub, blocks) !== "open") {
        throw new ProtocolError("chat_closed");
      }
      const sealed = sealChat(identity, rpub, clipped || " ");
      emit(
        signChatText(identity, {
          to: rpub,
          ...sealed,
          media: media ? [media] : undefined,
          replies,
        }),
      );
    },
    [allEvents, blocks, emit, identity],
  );

  const canStripChat = useCallback(
    (line: ChatLine) => {
      if (!identity) return false;
      return chatMediaStillEditable(allEvents, identity.rpub, line);
    },
    [allEvents, identity],
  );

  const stripChatMedia = useCallback(
    (raw: string, line: ChatLine, hash: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      if (!chatMediaStillEditable(allEvents, identity.rpub, line)) {
        throw new ProtocolError("edit_too_late");
      }
      const rpub = raw.trim();
      const remaining: MediaRef[] = [];
      if (line.audio && line.audio.hash !== hash) remaining.push(line.audio);
      if (line.video && line.video.hash !== hash) remaining.push(line.video);
      const text = line.text?.trim() ?? "";
      if (!text && remaining.length === 0) {
        emit(signDelete(identity, line.sig));
      } else {
        const sealed = sealChat(identity, rpub, text || " ");
        emit(
          signChatText(identity, {
            to: rpub,
            ...sealed,
            media: remaining.length > 0 ? remaining : undefined,
            replaces: line.sig,
          }),
        );
      }
      void dropMedia(hash);
    },
    [allEvents, emit, identity],
  );

  const chatPhaseOf = useCallback(
    (rpub: string): ChatPhase => {
      if (!identity) return "none";
      return chatPhase(allEvents, identity.rpub, rpub, blocks);
    },
    [allEvents, blocks, identity],
  );

  const chatLinesOf = useCallback(
    (rpub: string): ChatLine[] => {
      if (!identity) return [];
      return chatLines(allEvents, identity, rpub);
    },
    [allEvents, identity],
  );

  const chatPeerList = identity ? chatPeers(allEvents, identity.rpub) : [];

  const likes = useCallback(
    (target: string) => likeStats(likeIndex, target, identity?.rpub ?? null),
    [identity, likeIndex],
  );

  useEffect(() => {
    setLikeIndex((prev) => {
      const merged = mergeLikes(prev, allEvents);
      if (JSON.stringify(merged) === JSON.stringify(prev)) return prev;
      saveLikeIndex(merged);
      return merged;
    });
  }, [allEvents]);

  const comments = useCallback(
    (postSig: string) =>
      commentsOf(allEvents, postSig).filter((item) => {
        if (staffBlocks.users.includes(item.author) || staffBlocks.comments.includes(item.sig)) return false;
        return !isQuarantined(
          allEvents,
          item.author,
          identity?.rpub ?? null,
          follows,
          Date.now(),
          new Set(livePeers.map((peer) => peer.rpub)),
        );
      }),
    [allEvents, follows, identity, livePeers, staffBlocks],
  );

  const reports = useCallback(
    (target: string) => {
      const author = allEvents.find((item) => item.sig === target)?.author;
      return {
        count: reportsOf(allEvents, target).size,
        mine: reportedByMe(allEvents, target, identity?.rpub ?? null),
        hidden: isHiddenByReports(allEvents, target, {
          author,
          me: identity?.rpub ?? null,
          follows,
        }),
      };
    },
    [allEvents, follows, identity],
  );

  const people = useMemo(() => {
    const list: Person[] = [];
    const seen = new Set<string>();
    if (identity) {
      seen.add(identity.rpub);
      list.push({
        rpub: identity.rpub,
        online: signalOn,
        profile: profile ?? personFrom(identity.rpub, allEvents).profile,
        avatarUrl: undefined,
      });
    }
    for (const peer of livePeers) {
      if (
        seen.has(peer.rpub) ||
        blocks.includes(peer.rpub) ||
        staffBlocks.users.includes(peer.rpub) ||
        authorIsGone(peer.rpub)
      )
        continue;
      seen.add(peer.rpub);
      const base = personFrom(peer.rpub, allEvents);
      list.push({
        rpub: peer.rpub,
        online: true,
        avatarUrl: peer.avatar,
        profile: {
          name: peer.name || base.profile?.name || "",
          about: base.profile?.about ?? "",
          picture: base.profile?.picture,
          interests: peer.interests.length ? peer.interests : base.profile?.interests,
        },
      });
    }
    for (const rpub of follows) {
      if (seen.has(rpub) || blocks.includes(rpub) || staffBlocks.users.includes(rpub) || authorIsGone(rpub)) continue;
      seen.add(rpub);
      list.push({ ...personFrom(rpub, allEvents), online: false });
    }
    return list;
  }, [allEvents, blocks, follows, identity, livePeers, profile, signalOn, staffBlocks]);

  const personByRpub = useCallback(
    (rpub: string) => people.find((person) => person.rpub === rpub),
    [people],
  );

  const askPeerData = useCallback((rpub: string) => {
    requestPeerData(rpub);
  }, []);

  const feed = useMemo(() => {
    const items: FeedItem[] = [];
    for (const event of visiblePostsOf(allEvents)) {
      if (blocks.includes(event.author) || staffBlocks.users.includes(event.author)) continue;
      if (staffBlocks.comments.includes(event.sig)) continue;
      if (
        isQuarantined(
          allEvents,
          event.author,
          identity?.rpub ?? null,
          follows,
          Date.now(),
          new Set(livePeers.map((peer) => peer.rpub)),
        )
      )
        continue;
      const peer = livePeers.find((item) => item.rpub === event.author);
      items.push({
        event,
        profile: personFrom(event.author, allEvents).profile,
        avatarUrl: peer?.avatar,
      });
    }
    return items;
  }, [allEvents, blocks, follows, identity, livePeers, staffBlocks]);

  const value = useMemo<RitaContextValue>(
    () => ({
      status,
      vault,
      identity,
      log,
      posts,
      feed,
      profile,
      follows,
      people,
      signalOn,
      error,
      createAccount,
      importSecret,
      unlock,
      logout,
      wipeIdentity,
      publishPost,
      editPost,
      deletePost,
      canEdit,
      publishProfile,
      follow,
      invitePeer,
      invited,
      unfollow,
      block,
      unblock,
      blocks,
      requestChat,
      acceptChat,
      revokeChat,
      sendChat,
      stripChatMedia,
      canStripChat,
      chatPhaseOf,
      chatLinesOf,
      chatPeerList,
      notices,
      dismissNotice,
      dismissNoticesFor: dismissNoticesMatching,
      toggleLike,
      addComment,
      editComment,
      deleteComment,
      canMutateComment: canChangeComment,
      report,
      toggleSave,
      saves,
      allEvents,
      likes,
      comments,
      reports,
      imageTarget,
      profileOf,
      postsOfRpub,
      personByRpub,
      askPeerData,
      exportPublic,
      exportBackup,
      importBundleFile,
    }),
    [
      createAccount,
      error,
      exportBackup,
      exportPublic,
      feed,
      addComment,
      canChangeComment,
      deleteComment,
      editComment,
      allEvents,
      block,
      blocks,
      requestChat,
      acceptChat,
      revokeChat,
      sendChat,
      stripChatMedia,
      canStripChat,
      chatPhaseOf,
      chatLinesOf,
      chatPeerList,
      notices,
      dismissNotice,
      dismissNoticesMatching,
      comments,
      follow,
      invitePeer,
      invited,
      follows,
      identity,
      likes,
      importBundleFile,
      importSecret,
      log,
      logout,
      wipeIdentity,
      people,
      signalOn,
      posts,
      postsOfRpub,
      profile,
      profileOf,
      personByRpub,
      askPeerData,
      canEdit,
      deletePost,
      editPost,
      publishPost,
      publishProfile,
      report,
      reports,
      saves,
      status,
      toggleLike,
      toggleSave,
      unblock,
      unfollow,
      likeIndex,
      unlock,
      vault,
    ],
  );

  return <RitaContext.Provider value={value}>{children}</RitaContext.Provider>;
}

export function useRita(): RitaContextValue {
  const ctx = useContext(RitaContext);
  if (!ctx) {
    throw new Error("useRita debe usarse dentro de RitaProvider");
  }
  return ctx;
}
