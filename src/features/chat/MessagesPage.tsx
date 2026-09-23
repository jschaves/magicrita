import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Avatar } from "@/components/note/Avatar";
import { Button } from "@/components/ui/Button";
import { CharCount } from "@/components/ui/Field";
import { EmojiInsert } from "@/components/ui/EmojiInsert";
import { VoiceMic } from "@/components/ui/VoiceMic";
import { VoiceNote } from "@/components/note/VoiceNote";
import { VideoNote } from "@/components/note/VideoNote";
import { VideoClip } from "@/components/ui/VideoClip";
import { ingestVideo, ingestVoice } from "@/lib/protocol/media";
import { useRita } from "@/context/RitaProvider";
import { useI18n, type MessageKey } from "@/i18n/I18nProvider";
import { timeAgo } from "@/lib/format";
import { MAX_CHAT_CHARS } from "@/lib/protocol/envelope";
import { shortenId } from "@/lib/protocol/identity";
import type { ChatPhase } from "@/lib/protocol/chat";

export function MessagesPage() {
  const { rpub: raw } = useParams();
  const them = raw ? decodeURIComponent(raw) : undefined;
  const navigate = useNavigate();
  const {
    identity,
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
  const [replyTo, setReplyTo] = useState<{ sig: string; text: string | null; author: string } | null>(null);

  useEffect(() => {
    if (them) dismissNoticesFor({ kind: ["chat", "request"], from: them });
  }, [dismissNoticesFor, them]);

  const phase = them ? chatPhaseOf(them) : "none";
  const lines = them ? chatLinesOf(them) : [];
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

  function onSend(event: FormEvent) {
    event.preventDefault();
    if (!them) return;
    run(() => {
      sendChat(them, draft, undefined, replyTo?.sig);
      setDraft("");
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
        <Button type="button" variant="secondary" onClick={() => run(() => revokeChat(them))}>
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
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <h1 className="font-display text-2xl">{t("messages.title")}</h1>
        <p className="text-sm text-muted">{t("messages.hint")}</p>
      </header>

      {!them ? (
        <div className="space-y-6 p-4">
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
            {others.length === 0 && incoming.length === 0 ? (
              <p className="text-sm text-muted">{t("messages.empty")}</p>
            ) : (
              <ul className="divide-y divide-line rounded-3xl border border-line bg-paper">
                {others.map((rpub) => (
                  <PeerRow key={rpub} rpub={rpub} phase={chatPhaseOf(rpub)} onOpen={() => go(rpub)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-line px-4 py-3">
            <Link to="/messages" className="text-sm text-muted hover:text-ink">
              {t("common.back")}
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Avatar name={name} picture={profileOf(them)?.picture} src={person?.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{name}</p>
                <p className="truncate text-xs text-muted">
                  {t(`messages.phase.${phase}` as MessageKey)} · {shortenId(them)}
                </p>
              </div>
            </div>
            <div className="mt-3">{actions}</div>
            {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {phase !== "open" ? (
              <p className="text-sm text-muted">{t(`messages.wait.${phase}` as MessageKey)}</p>
            ) : null}
            {lines.map((line) => {
              const mine = line.author === identity?.rpub;
              return (
                <div key={line.sig} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm leading-5 ${
                      line.audio ? "w-[min(22rem,calc(100%-1.5rem))] min-w-0" : "max-w-[80%] min-w-0"
                    } ${mine ? "bg-plum text-cream" : "border border-line bg-paper"}`}
                  >
                    {line.audio ? (
                      <VoiceNote
                        media={line.audio}
                        light={mine}
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
                    {line.quote ? (
                      <p
                        className={`mb-1 truncate border-l-2 pl-2 text-[11px] ${
                          mine ? "border-cream/50 text-cream/80" : "border-plum/40 text-muted"
                        }`}
                      >
                        {line.quote.text?.trim() || t("live.voice")}
                      </p>
                    ) : null}
                    {line.text ? (
                      <p className="whitespace-pre-wrap">{line.text}</p>
                    ) : !line.audio && !line.video ? (
                      <p className="whitespace-pre-wrap">{t("messages.decryptFail")}</p>
                    ) : null}
                    {phase === "open" ? (
                      <button
                        type="button"
                        className={`mt-1 text-[11px] font-semibold ${mine ? "text-cream/80" : "text-plum"}`}
                        onClick={() => setReplyTo({ sig: line.sig, text: line.text, author: line.author })}
                      >
                        {t("live.reply")}
                      </button>
                    ) : null}
                    <p className={`mt-1 text-[10px] ${mine ? "text-cream/70" : "text-muted"}`}>
                      {timeAgo(line.ts, t, locale)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {phase === "open" ? (
            <form className="border-t border-line p-4" onSubmit={onSend}>
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
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHAT_CHARS))}
                maxLength={MAX_CHAT_CHARS}
                rows={2}
                placeholder={t("messages.write")}
                className="w-full rounded-2xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/30"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  <EmojiInsert value={draft} max={MAX_CHAT_CHARS} onChange={setDraft} />
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
