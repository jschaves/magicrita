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
  mergeEnvelopes,
  pruneDistinctChats,
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
  signAttest,
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
import { dropMedia, ingestPhoto, MAX_PHOTOS, onMediaStored, type MediaRef } from "@/lib/protocol/media";
import {
  applyBundle,
  buildBundle,
  downloadBundle,
  MAX_BUNDLE_BYTES,
  parseBundle,
} from "@/lib/protocol/bundle";
import {
  assertVaultOwnership,
  loadVault,
  saveVault,
  unwrapVault,
  wrapSecret,
  type VaultRecord,
} from "@/lib/protocol/vault";
import { createRecoveryShares } from "@/lib/protocol/recovery";
import { resetLive } from "@/lib/protocol/live";
import { ProtocolError } from "@/lib/protocol/errors";
import { purgeForeignIdentities, wipeBrowserRita, wipeRitaPreservingInvite } from "@/lib/protocol/wipe";
import { checkStaffBlocks, MOD_CHECK_CHUNK, type StaffBlocks } from "@/lib/protocol/adminBlocks";
import {
  assertSingleSession,
  clearUnlockedRsec,
  claimSession,
  heartbeatSession,
  loadUnlockedRsec,
  notifySessionExists,
  releaseSession,
  saveUnlockedRsec,
  watchSessionLock,
} from "@/lib/protocol/session";
import { forgetSession, rememberSession } from "@/lib/protocol/sessionPersist";
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
import { assertBetaInvite, loadBetaInvite } from "@/lib/protocol/betaInvite";
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
    picture?: File;
    invite?: string;
  }) => Promise<Identity>;
  importSecret: (
    secret: string,
    password: string,
    currentPassword?: string,
    invite?: string,
  ) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>;
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
  importBundleFile: (
    file: File,
    currentPassword?: string,
    invite?: string,
  ) => Promise<{ authors: number; vaultRestored: boolean }>;
  attest: (target: string) => void;
  setupRecovery: (password: string, guardians: string[], threshold: number) => Promise<number>;
  importEnvelopes: (envelopes: Envelope[]) => number;
};

const RitaContext = createContext<RitaContextValue | null>(null);

function tryRestoreIdentity(vault: VaultRecord | null): Identity | null {
  if (!vault) {
    clearUnlockedRsec();
    return null;
  }
  const rsec = loadUnlockedRsec();
  if (!rsec) return null;
  try {
    const identity = fromSecret(parseSecretInput(rsec));
    if (identity.rpub !== vault.rpub) {
      clearUnlockedRsec();
      return null;
    }
    // Otra pestaña ya tiene la rsec en claro: esta se queda en "locked" en vez
    // de abrir una segunda sesión con la misma clave.
    if (!claimSession(identity.rpub)) {
      notifySessionExists();
      clearUnlockedRsec();
      return null;
    }
    return identity;
  } catch {
    clearUnlockedRsec();
    return null;
  }
}

function personFrom(rpub: string, events: readonly Envelope[]): Person {
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
  /** lo que ya se pregunto al relay, para no repetir la consulta en cada render */
  const staffAsked = useRef<Set<string>>(new Set());
  const [staffRev, setStaffRev] = useState(0);
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

  const attest = useCallback(
    (target: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      emit(signAttest(identity, target));
    },
    [emit, identity],
  );

  const setupRecovery = useCallback(
    async (password: string, guardians: string[], threshold: number) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      const envelopes = await createRecoveryShares(identity, { password, guardians, threshold });
      for (const envelope of envelopes) emit(envelope);
      return envelopes.length;
    },
    [emit, identity],
  );

  const importEnvelopes = useCallback(
    (envelopes: Envelope[]) => {
      const authors = mergeEnvelopes(envelopes);
      bump();
      return authors.length;
    },
    [bump],
  );

  const hydrate = useCallback((next: Identity) => {
    assertSingleSession(next.rpub);
    saveUnlockedRsec(next.rsec);
    // Recuerda la sesion en el dispositivo: reabrir la app no vuelve a pedir la
    // contraseña hasta que se cierre sesion o se borre la identidad.
    void rememberSession(next.rsec, next.rpub);
    pruneDistinctChats();
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
      picture: pictureFile,
      invite,
    }: {
      password: string;
      name: string;
      about: string;
      picture?: File;
      invite?: string;
    }) => {
      if (loadVault()) throw new ProtocolError("account_exists");
      await wipeRitaPreservingInvite();
      await assertBetaInvite(invite);
      const next = createIdentity();
      // La foto se ingiere DESPUÉS del borrado: al crear cuenta se limpia el
      // almacén de media, así que si se guardara antes se perdería el avatar.
      const picture = pictureFile ? await ingestPhoto(pictureFile) : undefined;
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
      setNotices(loadNotices(identity.rpub));
      bump();
    });
  }, [emit, identity]);

  const importSecret = useCallback(
    async (secret: string, password: string, currentPassword?: string, invite?: string) => {
      await assertBetaInvite(invite);
      const next = fromSecret(parseSecretInput(secret));
      if (identity?.rpub === next.rpub && status === "ready") {
        notifySessionExists();
        throw new ProtocolError("session_exists");
      }
      const existing = loadVault();
      if (existing && existing.rpub !== next.rpub) {
        await assertVaultOwnership(currentPassword);
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

  /**
   * Cierra la sesion en memoria. `forget` borra ademas la sesion recordada, de
   * modo que la proxima vez se pida la contraseña. Al perder el lock frente a
   * otra pestaña se conserva, porque eso no es un cierre de sesion del usuario.
   */
  const endSession = useCallback(
    (forget: boolean) => {
      if (identity) releaseSession(identity.rpub);
      resetLive();
      clearUnlockedRsec();
      if (forget) void forgetSession();
      setIdentity(null);
      setLog([]);
      setStatus(loadVault() ? "locked" : "anonymous");
      bump();
    },
    [bump, identity],
  );

  const logout = useCallback(() => endSession(true), [endSession]);

  /**
   * Cambia la contraseña local probando la actual y re-cifrando la misma rsec
   * con la nueva. La bóveda queda con la nueva; el usuario se saca para que
   * vuelva a entrar con ella.
   */
  const changePassword = useCallback(
    async (currentPassword: string, nextPassword: string) => {
      if (!identity) throw new ProtocolError("not_unlocked");
      await assertVaultOwnership(currentPassword);
      const record = await wrapSecret(identity, nextPassword);
      setVault(record);
    },
    [identity],
  );

  const wipeIdentity = useCallback(async () => {
    if (identity) {
      try {
        const gone = signGone(identity);
        broadcastEnvelope(gone);
        await publishMesh(gone).catch(() => undefined);
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        releaseSession(identity.rpub);
      } catch {
        // el aviso a los pares no puede impedir borrar la identidad
      }
    }
    resetLive();
    clearUnlockedRsec();
    void forgetSession();
    // El borrado nunca debe rechazar: aunque falle media o IndexedDB, se sale
    // igual a /welcome en vez de quedarse en una pantalla ya vacia.
    try {
      await wipeBrowserRita();
    } catch {
      // ignore
    }
    setIdentity(null);
    setVault(null);
    setLog([]);
    setStatus(loadVault() ? "locked" : "anonymous");
    bump();
    window.location.assign("/welcome");
  }, [bump, identity]);

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
    await downloadBundle(bundle, `magicrita-${identity.rpub.slice(0, 12)}.json`);
  }, [identity]);

  const exportBackup = useCallback(async () => {
    if (!identity) throw new ProtocolError("not_unlocked");
    const rpubs = [...new Set([identity.rpub, ...listKnownRpubs()])];
    // El codigo viaja dentro del backup para que al restaurarlo en otro
    // navegador no haga falta volver a escribirlo. Las cuentas creadas antes de
    // guardarlo en la boveda se completan aqui con el que haya en el dispositivo.
    const invite = vault?.invite || loadBetaInvite() || undefined;
    const bundle = await buildBundle({
      kind: "backup",
      rpubs,
      vault: vault ? { ...vault, invite } : vault ?? undefined,
    });
    await downloadBundle(bundle, `magicrita-backup-${Date.now()}.json`);
  }, [identity, vault]);

  const importBundleFile = useCallback(
    async (file: File, currentPassword?: string, invite?: string) => {
      if (file.size > MAX_BUNDLE_BYTES) throw new ProtocolError("invalid_bundle");
      const text = await file.text();
      const bundle = parseBundle(text);
      if (bundle.kind === "backup" && bundle.vault) {
        // Restaurar una identidad es entrar en la beta otra vez. Si ya hay una
        // sesion con esa misma cuenta no hace falta el codigo; solo cuando la
        // identidad entra de cero o se sustituye por otra.
        const switching = !identity || identity.rpub !== bundle.vault.rpub;
        // El codigo guardado en el propio backup vale; si ya no existe, el
        // usuario puede escribir uno nuevo y ese manda.
        if (switching) await assertBetaInvite(invite?.trim() || bundle.vault.invite);
        if (identity && identity.rpub !== bundle.vault.rpub) {
          throw new ProtocolError("backup_conflict");
        }
        // Con la sesion cerrada `identity` es null y el guard anterior no cubria
        // nada: un bundle ajeno sustituia la boveda guardada sin contraseña.
        const stored = loadVault();
        if (stored && stored.rpub !== bundle.vault.rpub) {
          await assertVaultOwnership(currentPassword);
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
    // Si otra pestaña tomó el lock, esta suelta la sesión en vez de seguir
    // con la rsec en claro.
    const beat = () => {
      if (heartbeatSession(identity.rpub)) return;
      notifySessionExists();
      endSession(false);
    };
    beat();
    const timer = window.setInterval(beat, 4000);
    return () => window.clearInterval(timer);
  }, [identity, status, endSession]);

  useEffect(() => {
    if (status !== "ready") return;
    return watchSessionLock(() => {
      notifySessionExists();
      endSession(false);
    });
  }, [status, endSession]);

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
        secret: identity.secret,
        invite: loadBetaInvite(),
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
    // El relay ya no difunde la lista: solo avisa. Al avisar se cae la memoria
    // de lo preguntado para que un bloqueo nuevo se vea en lo ya conocido.
    const stopMod = onModeration(() => {
      staffAsked.current.clear();
      setStaffRev((n) => n + 1);
    });
    return () => {
      stopMesh();
      stopStatus();
      stopMod();
    };
  }, [bump, captureNotice, identity?.rpub, status]);

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

  // El relay solo avisa de que la moderacion cambio, asi que aqui se consulta
  // por los items que ya tenemos. Solo se pregunta por los nuevos: lo ya
  // preguntado se recuerda, y un aviso del relay borra esa memoria para que un
  // bloqueo nuevo tambien aplique a lo que ya estaba en pantalla.
  useEffect(() => {
    let alive = true;
    const rpubs = [...new Set(allEvents.map((event) => event.author))].filter((rpub) => {
      if (staffAsked.current.has(rpub)) return false;
      staffAsked.current.add(rpub);
      return true;
    });
    const sigs = [...new Set(allEvents.map((event) => event.sig))].filter((sig) => {
      if (staffAsked.current.has(sig)) return false;
      staffAsked.current.add(sig);
      return true;
    });
    if (!rpubs.length && !sigs.length) return;
    void (async () => {
      const users: string[] = [];
      const comments: string[] = [];
      for (let i = 0; i < Math.max(rpubs.length, sigs.length); i += MOD_CHECK_CHUNK) {
        const part = await checkStaffBlocks(rpubs.slice(i, i + MOD_CHECK_CHUNK), sigs.slice(i, i + MOD_CHECK_CHUNK));
        users.push(...part.users);
        comments.push(...part.comments);
        if (!alive) return;
      }
      if (!alive || (!users.length && !comments.length)) return;
      setStaffBlocks((prev) => ({
        users: [...new Set([...prev.users, ...users])],
        comments: [...new Set([...prev.comments, ...comments])],
      }));
    })();
    return () => {
      alive = false;
    };
  }, [allEvents, staffRev]);

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
      if (line.photo && line.photo.hash !== hash) remaining.push(line.photo);
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
      // Si esta conectado ahora, se muestra: un `gone` viejo no debe esconder a
      // quien esta en linea.
      if (
        seen.has(peer.rpub) ||
        blocks.includes(peer.rpub) ||
        staffBlocks.users.includes(peer.rpub)
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
    const gone = new Set<string>();
    for (const event of allEvents) {
      if (event.author === identity?.rpub || gone.has(event.author)) continue;
      if (authorIsGone(event.author)) gone.add(event.author);
    }
    for (const event of visiblePostsOf(allEvents)) {
      if (blocks.includes(event.author) || staffBlocks.users.includes(event.author)) continue;
      // Un autor con `gone` vigente se oculta, pero sin borrar sus datos.
      if (event.author !== identity?.rpub && gone.has(event.author)) continue;
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
      changePassword,
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
      attest,
      setupRecovery,
      importEnvelopes,
    }),
    [
      attest,
      setupRecovery,
      importEnvelopes,
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
      changePassword,
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
