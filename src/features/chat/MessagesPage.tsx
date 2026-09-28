import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ImagePlus, Phone, Video, X } from "lucide-react";
import { Avatar } from "@/components/note/Avatar";
import { Photo } from "@/components/note/Photo";
import { Button } from "@/components/ui/Button";
import { CharCount, TextField } from "@/components/ui/Field";
import { EmojiInsert } from "@/components/ui/EmojiInsert";
import { VoiceMic } from "@/components/ui/VoiceMic";
import { VoiceNote } from "@/components/note/VoiceNote";
import { VideoNote } from "@/components/note/VideoNote";
import { VideoClip } from "@/components/ui/VideoClip";
import { ResponsiveDock } from "@/components/ui/MobileDock";
import { InfoButton } from "@/components/ui/InfoButton";
import { ingestPhoto, ingestVideo, ingestVoice, type MediaRef } from "@/lib/protocol/media";
import { startCall } from "@/lib/protocol/call";
import { useRita } from "@/context/RitaProvider";
import { useI18n, type MessageKey } from "@/i18n/I18nProvider";
import { timeAgo } from "@/lib/format";
import { MAX_CHAT_CHARS } from "@/lib/protocol/envelope";
import { shortenId } from "@/lib/protocol/identity";
import type { ChatPhase } from "@/lib/protocol/chat";
import { useVisualViewport } from "@/lib/useVisualViewport";

const PAGE_SIZE = 5;

export function MessagesPage() {
  const { rpub: raw } = useParams();
  const them = raw ? decodeURIComponent(raw) : undefined;
  const navigate = useNavigate();
  const {
    identity,
    profile,
    personByRpub,
    profileOf,
    blocks,
    block,
    unblock,
    requestChat,
    acceptChat,
    revokeChat,
    sendChat,
    stripChatMedia,
    canStripChat,
    chatPhaseOf,
    chatLinesOf,
    chatPeerList,
    dismissNoticesFor,
  } = useRita();
  const { t, locale, errorMessage } = useI18n();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [chatsPage, setChatsPage] = useState(0);
  const [chatQuery, setChatQuery] = useState("");
  const [photo, setPhoto] = useState<MediaRef | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [replyTo, setReplyTo] = useState<{ sig: string; text: string | null; author: string } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const tailRef = useRef("");
  const pinningRef = useRef(false);
  const view = useVisualViewport();
  const keyboardGap =
    view.mobile && view.keyboard
      ? Math.max(0, Math.round(window.innerHeight - view.offsetTop - view.height))
      : 0;

  useEffect(() => {
    if (them) dismissNoticesFor({ kind: ["chat", "request"], from: them });
  }, [dismissNoticesFor, them]);

  const phase = them ? chatPhaseOf(them) : "none";
  const lines = them ? chatLinesOf(them) : [];
  const tail = them ? `${them}:${lines.length}:${lines[lines.length - 1]?.sig ?? ""}` : "";

  useLayoutEffect(() => {
    if (!them) return;
    if (tailRef.current !== tail) {
      tailRef.current = tail;
      stickRef.current = true;
    }
    if (!stickRef.current) return;
    const node = scrollerRef.current;
    if (!node) return;
    pinningRef.current = true;
    node.scrollTop = node.scrollHeight;
    requestAnimationFrame(() => {
      pinningRef.current = false;
    });
  }, [them, tail, keyboardGap]);

  useEffect(() => {
    const content = contentRef.current;
    const node = scrollerRef.current;
    if (!them || !content || !node) return;
    const ro = new ResizeObserver(() => {
      if (!stickRef.current) return;
      pinningRef.current = true;
      node.scrollTop = node.scrollHeight;
      requestAnimationFrame(() => {
        pinningRef.current = false;
      });
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [them]);

  function onThreadScroll(event: UIEvent<HTMLDivElement>) {
    if (pinningRef.current) return;
    const node = event.currentTarget;
    const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickRef.current = gap < 64;
  }
  const person = them ? personByRpub(them) : undefined;
  const name = them
    ? profileOf(them)?.name || person?.profile?.name || t("common.unnamed")
    : "";

  const incoming = useMemo(
    () => chatPeerList.filter((rpub) => chatPhaseOf(rpub) === "incoming"),
    [chatPeerList, chatPhaseOf],
  );
  const others = useMemo(
    () =>
      chatPeerList.filter(
        (rpub) => chatPhaseOf(rpub) !== "incoming" && chatLinesOf(rpub).length > 0,
      ),
    [chatPeerList, chatLinesOf, chatPhaseOf],
  );
  const chatQueryNorm = chatQuery.trim().toLowerCase();
  const filteredChats = useMemo(() => {
    if (!chatQueryNorm) return others;
    return others.filter((rpub) => {
      const label = profileOf(rpub)?.name || personByRpub(rpub)?.profile?.name || "";
      return label.toLowerCase().includes(chatQueryNorm);
    });
  }, [others, chatQueryNorm, profileOf, personByRpub]);
  const chatPages = Math.max(1, Math.ceil(filteredChats.length / PAGE_SIZE));
  const chatsSafe = Math.min(chatsPage, chatPages - 1);
  const visibleChats = filteredChats.slice(chatsSafe * PAGE_SIZE, chatsSafe * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setChatsPage(0);
  }, [chatQuery]);

  function go(rpub: string) {
    navigate(`/messages/${encodeURIComponent(rpub)}`);
  }

  function run(fn: () => void) {
    setError(null);
    try {
      fn();
    } catch (err) {
      setError(errorMessage(err, "messages.failed"));
    }
  }

  async function callPeer(video: boolean) {
    if (!them) return;
    setError(null);
    try {
      await startCall(them, video);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "call_offline") setError(t("messages.call.offline"));
      else if (code === "video_denied") setError(t("live.videoDenied"));
      else if (code === "call_denied") setError(t("live.voiceDenied"));
      else if (code === "call_insecure") setError(t("live.voiceInsecure"));
      else setError(t("messages.failed"));
    }
  }

  function onSend(event: FormEvent) {
    event.preventDefault();
    if (!them) return;
    run(() => {
      sendChat(them, draft, photo ?? undefined, replyTo?.sig);
      setDraft("");
      setPhoto(null);
      setReplyTo(null);
    });
  }

  const actions = them ? (
    <div className="flex flex-wrap gap-2">
      {phase === "incoming" ? (
        <Button type="button" onClick={() => run(() => acceptChat(them))}>
          {t("messages.accept")}
        </Button>
      ) : null}
      {phase === "none" || phase === "closed" ? (
        <Button type="button" onClick={() => run(() => requestChat(them))}>
          {t("messages.request")}
        </Button>
      ) : null}
      {phase === "outgoing" || phase === "open" || phase === "incoming" ? (
        <Button type="button" variant="danger" onClick={() => run(() => revokeChat(them))}>
          {phase === "incoming" ? t("messages.decline") : t("messages.revoke")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="danger"
        onClick={() => run(() => (blocks.includes(them) ? unblock(them) : block(them)))}
      >
        {blocks.includes(them) ? t("live.unblock") : t("live.block")}
      </Button>
    </div>
  ) : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-line bg-paper px-4 py-3 md:py-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl">{t("messages.title")}</h1>
          <InfoButton title={t("messages.title")} body={t("info.messages")} />
          {them && phase === "open" ? (
            <button
              type="button"
              onClick={() => void callPeer(false)}
              aria-label={t("messages.call.button")}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent hover:text-white"
            >
              <Phone size={16} />
              <span className="hidden md:inline">{t("messages.call.button")}</span>
            </button>
          ) : null}
          {them && phase === "open" ? (
            <button
              type="button"
              onClick={() => void callPeer(true)}
              aria-label={t("messages.videoCall.button")}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent hover:text-white"
            >
              <Video size={16} />
              <span className="hidden md:inline">{t("messages.videoCall.button")}</span>
            </button>
          ) : null}
        </div>
      </header>

      {!them ? (
        <>
        <div className="shrink-0 border-b border-line bg-paper px-4 py-3">
          <TextField
            label={t("messages.search")}
            value={chatQuery}
            onChange={(event) => setChatQuery(event.target.value)}
            placeholder={t("messages.searchHint")}
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          {incoming.length ? (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">{t("messages.inbox")}</p>
              <ul className="divide-y divide-line rounded-3xl border border-line bg-paper">
                {incoming.map((rpub) => (
                  <PeerRow key={rpub} rpub={rpub} phase="incoming" onOpen={() => go(rpub)} />
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{t("messages.chats")}</p>
            {filteredChats.length === 0 ? (
              chatQueryNorm ? (
                <p className="text-sm text-muted">{t("messages.searchEmpty")}</p>
              ) : others.length === 0 && incoming.length === 0 ? (
                <p className="text-sm text-muted">{t("messages.empty")}</p>
              ) : (
                <ul className="divide-y divide-line rounded-3xl border border-line bg-paper" />
              )
            ) : (
              <>
                <ul className="divide-y divide-line rounded-3xl border border-line bg-paper">
                  {visibleChats.map((rpub) => (
                    <PeerRow key={rpub} rpub={rpub} phase={chatPhaseOf(rpub)} onOpen={() => go(rpub)} />
                  ))}
                </ul>
                {chatPages > 1 ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={chatsSafe <= 0}
                      onClick={() => setChatsPage(chatsSafe - 1)}
                    >
                      {t("messages.pagePrev")}
                    </Button>
                    <p className="text-xs text-muted">
                      {t("messages.pageStatus", { page: chatsSafe + 1, pages: chatPages })}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={chatsSafe >= chatPages - 1}
                      onClick={() => setChatsPage(chatsSafe + 1)}
                    >
                      {t("messages.pageNext")}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-line bg-paper px-4 py-2 md:py-3">
            <Link to="/messages" className="text-xs text-muted hover:text-ink md:text-sm">
              {t("common.back")}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 md:gap-3">
              <Avatar name={name} picture={profileOf(them)?.picture} src={person?.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{name}</p>
                <p className="truncate text-xs text-muted">
                  {t(`messages.phase.${phase}` as MessageKey)} · {shortenId(them)}
                </p>
              </div>
            </div>
            <div className="mt-2 md:mt-3">{actions}</div>
            {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
          </div>
          <div
            ref={scrollerRef}
            onScroll={onThreadScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
            style={keyboardGap ? { paddingBottom: keyboardGap } : undefined}
          >
            <div ref={contentRef} className="space-y-3 px-4 py-4">
            {phase !== "open" ? (
              <p className="text-sm text-muted">{t(`messages.wait.${phase}` as MessageKey)}</p>
            ) : null}
            {lines.map((line) => {
              const mine = line.author === identity?.rpub;
              const author = mine ? profile : profileOf(line.author);
              return (
                <div
                  key={line.sig}
                  className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}
                >
                  <Avatar
                    name={mine ? profile?.name : name}
                    picture={author?.picture}
                    src={mine ? undefined : person?.avatarUrl}
                    size="sm"
                  />
                  <div
                    className={`rita-bubble ${mine ? "rita-bubble-right" : "rita-bubble-left"} rounded-2xl px-3 py-2 text-sm leading-5 ${
                      line.audio || line.photo
                        ? "w-[min(22rem,calc(100%-3rem))] min-w-0"
                        : "max-w-[78%] min-w-0"
                    } ${mine ? "border border-line bg-[var(--color-bubble-mine)] text-ink" : "border border-line bg-paper"}`}
                  >
                    {line.audio ? (
                      <VoiceNote
                        media={line.audio}
                        onRemove={
                          them && canStripChat(line)
                            ? () => run(() => stripChatMedia(them, line, line.audio!.hash))
                            : undefined
                        }
                        removeLabel={t("compose.removeVoice")}
                      />
                    ) : null}
                    {line.video ? (
                      <VideoNote
                        media={line.video}
                        onRemove={
                          them && canStripChat(line)
                            ? () => run(() => stripChatMedia(them, line, line.video!.hash))
                            : undefined
                        }
                        removeLabel={t("compose.removeVideo")}
                      />
                    ) : null}
                    {line.photo ? (
                      <div>
                        <Photo hash={line.photo.hash} alt={line.photo.name} preview={line.photo.preview} />
                        {them && canStripChat(line) ? (
                          <button
                            type="button"
                            className={`mt-1 text-[11px] font-semibold ${mine ? "text-ink/70" : "text-accent"}`}
                            onClick={() => run(() => stripChatMedia(them, line, line.photo!.hash))}
                          >
                            {t("compose.removePhoto")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {line.quote ? (
                      <p
                        className={`mb-1 truncate border-l-2 pl-2 text-[11px] ${
                          mine ? "border-ink/30 text-ink/70" : "border-plum/40 text-muted"
                        }`}
                      >
                        {line.quote.text?.trim() ||
                          (line.quote.photo ? t("messages.photo") : t("live.voice"))}
                      </p>
                    ) : null}
                    {line.text ? (
                      <p className="whitespace-pre-wrap">{line.text}</p>
                    ) : !line.audio && !line.video && !line.photo ? (
                      <p className="whitespace-pre-wrap">{t("messages.decryptFail")}</p>
                    ) : null}
                    {phase === "open" ? (
                      <button
                        type="button"
                        className="mt-1 text-[11px] font-semibold text-plum"
                        onClick={() => setReplyTo({ sig: line.sig, text: line.text, author: line.author })}
                      >
                        {t("live.reply")}
                      </button>
                    ) : null}
                    <p className={`mt-1 text-[10px] ${mine ? "text-ink/60" : "text-muted"}`}>
                      {timeAgo(line.ts, t, locale)}
                    </p>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
          {phase === "open" ? (
            <ResponsiveDock className="shrink-0 border-t border-line bg-paper p-4" mobileClassName="border-t border-line bg-white p-2">
            <form onSubmit={onSend}>
              {replyTo ? (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-cream px-3 py-1.5 text-xs">
                  <p className="min-w-0 truncate font-semibold text-plum">
                    {t("messages.replying", {
                      name: profileOf(replyTo.author)?.name || shortenId(replyTo.author),
                    })}
                    {replyTo.text ? ` · ${replyTo.text}` : ""}
                  </p>
                  <button type="button" className="shrink-0 text-muted" onClick={() => setReplyTo(null)}>
                    {t("live.cancelReply")}
                  </button>
                </div>
              ) : null}
              {photo ? (
                <div className="mb-2 flex items-center gap-2">
                  {photo.preview ? (
                    <img src={photo.preview} alt="" className="h-16 w-16 rounded-xl object-cover" />
                  ) : (
                    <Photo hash={photo.hash} alt={photo.name} />
                  )}
                  <button
                    type="button"
                    className="rounded-full p-1 text-muted hover:text-accent"
                    aria-label={t("compose.removePhoto")}
                    onClick={() => setPhoto(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHAT_CHARS))}
                maxLength={MAX_CHAT_CHARS}
                rows={view.mobile ? 1 : 2}
                enterKeyHint="send"
                autoComplete="off"
                placeholder={t("messages.write")}
                className="w-full rounded-2xl border border-line bg-paper px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 md:py-2"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2 md:mt-2">
                <span className="flex items-center gap-1">
                  <EmojiInsert value={draft} max={MAX_CHAT_CHARS} onChange={setDraft} />
                  <button
                    type="button"
                    className="rounded-full p-1.5 text-muted hover:bg-cream hover:text-plum"
                    aria-label={t("compose.addPhotos")}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <ImagePlus size={16} />
                  </button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      void (async () => {
                        try {
                          setPhoto(await ingestPhoto(file));
                          setError(null);
                        } catch (err) {
                          setError(errorMessage(err, "messages.failed"));
                        }
                      })();
                    }}
                  />
                  <VoiceMic
                    onError={setError}
                    onBlob={(blob) => {
                      void (async () => {
                        try {
                          const media = await ingestVoice(blob);
                          sendChat(them, "", media, replyTo?.sig);
                          setReplyTo(null);
                        } catch (err) {
                          setError(errorMessage(err, "messages.failed"));
                        }
                      })();
                    }}
                  />
                  <VideoClip
                    onError={setError}
                    onFile={(file) => {
                      void (async () => {
                        try {
                          const media = await ingestVideo(file);
                          sendChat(them, "", media, replyTo?.sig);
                          setReplyTo(null);
                        } catch (err) {
                          setError(errorMessage(err, "messages.failed"));
                        }
                      })();
                    }}
                  />
                </span>
                <div className="flex items-center gap-3">
                  <CharCount value={draft} max={MAX_CHAT_CHARS} />
                  <Button type="submit">{t("messages.send")}</Button>
                </div>
              </div>
            </form>
            </ResponsiveDock>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PeerRow({ rpub, phase, onOpen }: { rpub: string; phase: ChatPhase; onOpen: () => void }) {
  const { profileOf, personByRpub } = useRita();
  const { t } = useI18n();
  const person = personByRpub(rpub);
  const name = profileOf(rpub)?.name || person?.profile?.name || t("common.unnamed");
  return (
    <li>
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={onOpen}>
        <Avatar name={name} picture={profileOf(rpub)?.picture} src={person?.avatarUrl} />
        <div className="min-w-0">
          <p className="font-semibold">{name}</p>
          <p className="truncate text-xs text-muted">{t(`messages.phase.${phase}` as MessageKey)}</p>
        </div>
      </button>
    </li>
  );
}
