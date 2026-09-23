import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ImagePlus, Pencil, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useRita } from "@/context/RitaProvider";
import { timeAgo } from "@/lib/format";
import { shortenId } from "@/lib/protocol/identity";
import { MAX_COMMENT_CHARS, MAX_POST_CHARS, type Envelope } from "@/lib/protocol/envelope";
import { CharCount } from "@/components/ui/Field";
import { EmojiInsert } from "@/components/ui/EmojiInsert";
import { VoiceMic } from "@/components/ui/VoiceMic";
import { VideoClip } from "@/components/ui/VideoClip";
import { VoiceNote } from "./VoiceNote";
import { VideoNote } from "./VideoNote";
import { ingestPhoto, ingestVideo, ingestVoice, isAcceptedPhoto, type MediaRef } from "@/lib/protocol/media";
import { commentLineageSigs, postLineageSigs } from "@/lib/protocol/social";
import { Avatar } from "./Avatar";
import { Photo } from "./Photo";
import { FilteredText } from "./FilteredText";
import { CommentButton, HeartButton, ReportButton, SaveButton } from "./ActionBar";

export function NoteCard({
  event,
  name,
  picture,
  src,
}: {
  event: Envelope;
  name?: string;
  picture?: MediaRef;
  src?: string;
}) {
  const { t, locale, errorMessage } = useI18n();
  const {
    identity,
    likes,
    comments,
    reports,
    toggleLike,
    addComment,
    report,
    toggleSave,
    saves,
    canEdit,
    editPost,
    deletePost,
    allEvents,
  } = useRita();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editKeep, setEditKeep] = useState<MediaRef[]>([]);
  const [editFile, setEditFile] = useState<{ file: File; url: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editPhotoRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLInputElement>(null);

  function openPostReply() {
    setReplyTo(null);
    window.setTimeout(() => commentRef.current?.focus(), 0);
  }

  if (event.type !== "post" || !event.sig) return null;

  const author = event.author;
  const photos = event.body.media ?? [];
  const lineage = postLineageSigs(allEvents, event);
  const postLikes = lineage.reduce(
    (acc, sig) => {
      const row = likes(sig);
      return { count: acc.count + row.count, mine: acc.mine || row.mine };
    },
    { count: 0, mine: false },
  );
  const postReports = reports(event.sig);
  const thread = lineage.flatMap((sig) => comments(sig));
  const saved = lineage.some((sig) => saves.includes(sig));
  const roots = thread.filter((item) => item.type === "comment" && !item.body.parent);
  const repliesOf = (sig: string) => {
    const node = thread.find((item) => item.sig === sig);
    const lineage = node ? commentLineageSigs(allEvents, node) : [sig];
    return thread.filter(
      (item) => item.type === "comment" && item.body.parent && lineage.includes(item.body.parent),
    );
  };

  function submitComment(text: string, parent?: string, media?: MediaRef) {
    try {
      addComment(event.sig, text, parent, media);
      setDraft("");
      setReplyTo(null);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "live.commentFailed"));
    }
  }

  async function submitVoice(blob: Blob, parent?: string) {
    try {
      const media = await ingestVoice(blob);
      submitComment("", parent, media);
    } catch (err) {
      setError(errorMessage(err, "live.commentFailed"));
    }
  }

  async function submitVideo(file: File, parent?: string) {
    try {
      const media = await ingestVideo(file);
      submitComment("", parent, media);
    } catch (err) {
      setError(errorMessage(err, "live.commentFailed"));
    }
  }

  if (postReports.hidden && !showHidden) {
    return (
      <article className="border-b border-line px-4 py-4 text-sm text-muted">
        <p>{t("live.hiddenReported")}</p>
        <button type="button" className="mt-2 font-semibold text-accent" onClick={() => setShowHidden(true)}>
          {t("live.showReported")}
        </button>
      </article>
    );
  }

  return (
    <article className="border-b border-line px-4 py-4 last:border-b-0">
      {postReports.hidden ? (
        <p className="mb-2 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent">{t("live.hiddenReported")}</p>
      ) : null}
      <div className="flex gap-3">
        <Link to={`/p/${author}`} className="shrink-0">
          <Avatar name={name} picture={picture} src={src} size="sm" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <Link to={`/p/${author}`} className="font-bold hover:underline">
              {name || shortenId(author)}
            </Link>
            <span className="text-muted">{shortenId(author)}</span>
            <span className="text-muted">· {timeAgo(event.ts, t, locale)}</span>
            {event.body.replaces ? <span className="text-xs text-plum">{t("live.edited")}</span> : null}
            {identity?.rpub === author ? (
              <span className="ms-auto flex gap-2">
                {canEdit(event) ? (
                  <button
                    type="button"
                    className="text-muted hover:text-ink"
                    aria-label={t("live.edit")}
                    onClick={() => {
                      setEditing(true);
                      setEditText(event.body.text.slice(0, MAX_POST_CHARS));
                      setEditKeep(event.body.media ?? []);
                      if (editFile) URL.revokeObjectURL(editFile.url);
                      setEditFile(null);
                      setConfirmDelete(false);
                      setError(null);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-muted hover:text-accent"
                  aria-label={t("live.delete")}
                  onClick={() => {
                    setConfirmDelete(true);
                    setEditing(false);
                    setError(null);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            ) : null}
          </div>
          {confirmDelete ? (
            <div className="mt-2 rounded-2xl border border-line bg-cream px-3 py-2 text-sm">
              <p>{t("live.confirmDelete")}</p>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  className="font-semibold text-accent"
                  onClick={() => {
                    try {
                      deletePost(event);
                      setConfirmDelete(false);
                    } catch (err) {
                      setError(errorMessage(err, "live.deleteFailed"));
                    }
                  }}
                >
                  {t("live.confirmDeleteYes")}
                </button>
                <button type="button" className="text-muted" onClick={() => setConfirmDelete(false)}>
                  {t("live.cancelEdit")}
                </button>
              </div>
            </div>
          ) : null}
          {editing ? (
            <form
              className="mt-2 space-y-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                void (async () => {
                  setEditBusy(true);
                  setError(null);
                  try {
                    let media = editKeep;
                    if (editFile) media = [await ingestPhoto(editFile.file)];
                    editPost(event, editText, media);
                    if (editFile) URL.revokeObjectURL(editFile.url);
                    setEditFile(null);
                    setEditing(false);
                  } catch (err) {
                    setError(errorMessage(err, "live.editFailed"));
                  } finally {
                    setEditBusy(false);
                  }
                })();
              }}
            >
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value.slice(0, MAX_POST_CHARS))}
                maxLength={MAX_POST_CHARS}
                rows={4}
                className="w-full rounded-2xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/30"
              />
              <div className="flex justify-end">
                <CharCount value={editText} max={MAX_POST_CHARS} />
              </div>
              <input
                ref={editPhotoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={(change) => {
                  const file = change.target.files?.[0];
                  change.target.value = "";
                  if (!file) return;
                  if (!isAcceptedPhoto(file)) {
                    setError(t("errors.media_type"));
                    return;
                  }
                  setEditKeep([]);
                  setEditFile((current) => {
                    if (current) URL.revokeObjectURL(current.url);
                    return { file, url: URL.createObjectURL(file) };
                  });
                  setError(null);
                }}
              />
              {editFile ? (
                <div className="relative">
                  <img src={editFile.url} alt="" className="max-h-64 w-full rounded-2xl object-cover" />
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-full bg-paper/90 p-1 text-ink"
                    aria-label={t("compose.removePhoto")}
                    onClick={() => {
                      URL.revokeObjectURL(editFile.url);
                      setEditFile(null);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : editKeep[0] ? (
                <div className="relative">
                  <Photo hash={editKeep[0].hash} alt={editKeep[0].name} preview={editKeep[0].preview} />
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-full bg-paper/90 p-1 text-ink"
                    aria-label={t("compose.removePhoto")}
                    onClick={() => setEditKeep([])}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-plum"
                  onClick={() => editPhotoRef.current?.click()}
                >
                  <ImagePlus size={16} />
                  {t("compose.addPhotos")}
                </button>
              )}
              {editFile || editKeep[0] ? (
                <button
                  type="button"
                  className="text-sm font-semibold text-plum"
                  onClick={() => editPhotoRef.current?.click()}
                >
                  {t("live.changePhoto")}
                </button>
              ) : null}
              <div className="flex gap-3 text-sm">
                <button type="submit" className="font-semibold text-accent" disabled={editBusy}>
                  {editBusy ? t("compose.saving") : t("live.saveEdit")}
                </button>
                <button
                  type="button"
                  className="text-muted"
                  onClick={() => {
                    if (editFile) URL.revokeObjectURL(editFile.url);
                    setEditFile(null);
                    setEditing(false);
                  }}
                >
                  {t("live.cancelEdit")}
                </button>
              </div>
            </form>
          ) : (
            <>
              {event.body.text ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6">
                  <FilteredText text={event.body.text} />
                </p>
              ) : null}
              {identity?.rpub === author && canEdit(event) && !photos.some((item) => item.mime.startsWith("video/")) ? (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold text-ink">{t("compose.video")}</p>
                  <VideoClip
                    onError={setError}
                    onFile={(file) => {
                      void (async () => {
                        try {
                          const clip = await ingestVideo(file);
                          editPost(event, event.body.text, [...photos, clip]);
                          setError(null);
                        } catch (err) {
                          setError(errorMessage(err, "live.editFailed"));
                        }
                      })();
                    }}
                  />
                  <p className="mt-1 text-[11px] text-muted">{t("compose.videoHint")}</p>
                </div>
              ) : null}
              {photos.map((item) => {
                const stripClip = canEdit(event)
                  ? () => {
                      try {
                        const next = photos.filter((media) => media.hash !== item.hash);
                        if (!event.body.text.trim() && next.length === 0) deletePost(event);
                        else editPost(event, event.body.text, next);
                      } catch (err) {
                        setError(errorMessage(err, "live.editFailed"));
                      }
                    }
                  : undefined;
                return (
                  <div key={item.hash} className="mt-3">
                    {item.mime.startsWith("audio/") ? (
                      <VoiceNote
                        media={item}
                        onRemove={stripClip}
                        removeLabel={t("compose.removeVoice")}
                      />
                    ) : item.mime.startsWith("video/") ? (
                      <VideoNote
                        media={item}
                        onRemove={stripClip}
                        removeLabel={t("compose.removeVideo")}
                      />
                    ) : (
                      <Photo hash={item.hash} alt={item.name} preview={item.preview} />
                    )}
                  </div>
                );
              })}
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-4">
            <HeartButton
              count={postLikes.count}
              mine={postLikes.mine}
              onClick={() => toggleLike(event.sig, "post")}
            />
            <CommentButton count={thread.length} onClick={openPostReply} />
            {identity ? (
              <button
                type="button"
                className="text-sm font-semibold text-plum"
                onClick={openPostReply}
              >
                {t("live.reply")}
              </button>
            ) : null}
            <SaveButton
              saved={saved}
              label={saved ? t("live.unsave") : t("live.save")}
              onClick={() => toggleSave(event.sig)}
            />
            <ReportButton
              done={postReports.mine}
              label={t("live.report")}
              reviewing={t("live.reviewing")}
              onClick={() => {
                try {
                  report(event.sig, "post");
                  setError(null);
                } catch (err) {
                  setError(errorMessage(err, "live.reportFailed"));
                }
              }}
            />
          </div>
          {error ? <p className="mt-2 text-xs text-accent">{error}</p> : null}
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            {roots.map((item) => (
              <CommentBlock
                key={item.sig}
                item={item}
                replies={repliesOf(item.sig)}
                depth={0}
                replyTo={replyTo}
                setReplyTo={setReplyTo}
                showHidden={showHidden}
                onSubmit={submitComment}
              />
            ))}
            {identity && !replyTo ? (
              <>
                <CommentForm
                  inputRef={commentRef}
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => submitComment(draft)}
                  onVoice={(blob) => void submitVoice(blob)}
                  onVideo={(file) => void submitVideo(file)}
                  onVoiceError={setError}
                  placeholder={t("live.writeComment")}
                  sendLabel={t("live.send")}
                />
                <p className="text-[11px] text-muted">{t("live.commentWindow")}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function CommentBlock({
  item,
  replies,
  depth,
  replyTo,
  setReplyTo,
  showHidden,
  onSubmit,
}: {
  item: Envelope;
  replies: Envelope[];
  depth: number;
  replyTo: string | null;
  setReplyTo: (id: string | null) => void;
  showHidden: boolean;
  onSubmit: (text: string, parent?: string, media?: MediaRef) => void;
}) {
  const { t, errorMessage } = useI18n();
  const {
    likes,
    reports,
    toggleLike,
    report,
    profileOf,
    comments,
    identity,
    canMutateComment,
    editComment,
    deleteComment,
    allEvents,
  } = useRita();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (item.type !== "comment" || !item.sig) return null;
  const authorProfile = profileOf(item.author);
  const cLikes = likes(item.sig);
  const cReports = reports(item.sig);
  const mine = identity?.rpub === item.author;
  const canChange = mine && canMutateComment(item);
  const lineage = commentLineageSigs(allEvents, item);
  const nested = comments(item.body.target).filter(
    (entry) => entry.type === "comment" && entry.body.parent && lineage.includes(entry.body.parent),
  );

  if (cReports.hidden && !showHidden) {
    return <p className="text-xs text-muted">{t("live.hiddenComment")}</p>;
  }

  return (
    <div className={depth > 0 ? "ml-5 border-l border-line pl-3" : ""}>
      <div className="rounded-2xl bg-cream px-3 py-2 text-sm">
        {cReports.hidden ? <p className="mb-1 text-xs text-accent">{t("live.hiddenReported")}</p> : null}
        <div className="flex items-start gap-2">
          <p className="font-semibold" title={item.sig}>
          {authorProfile?.name || shortenId(item.author)}
        </p>
          {item.body.replaces ? <span className="text-xs text-plum">{t("live.edited")}</span> : null}
          {canChange ? (
            <span className="ms-auto flex gap-2">
              <button
                type="button"
                className="text-muted hover:text-ink"
                aria-label={t("live.edit")}
                onClick={() => {
                  setEditing(true);
                  setEditText(item.body.text.slice(0, MAX_COMMENT_CHARS));
                  setConfirmDelete(false);
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="text-muted hover:text-accent"
                aria-label={t("live.delete")}
                onClick={() => {
                  setConfirmDelete(true);
                  setEditing(false);
                }}
              >
                <Trash2 size={14} />
              </button>
            </span>
          ) : null}
        </div>
        {confirmDelete ? (
          <div className="mt-2 text-xs">
            <p>{t("live.confirmDelete")}</p>
            <div className="mt-1 flex gap-3">
              <button
                type="button"
                className="font-semibold text-accent"
                onClick={() => {
                  try {
                    deleteComment(item);
                    setConfirmDelete(false);
                  } catch (err) {
                    console.warn(errorMessage(err, "live.deleteFailed"));
                  }
                }}
              >
                {t("live.confirmDeleteYes")}
              </button>
              <button type="button" className="text-muted" onClick={() => setConfirmDelete(false)}>
                {t("live.cancelEdit")}
              </button>
            </div>
          </div>
        ) : null}
        {editing ? (
          <form
            className="mt-2 space-y-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              try {
                editComment(item, editText);
                setEditing(false);
              } catch (err) {
                console.warn(errorMessage(err, "live.editFailed"));
              }
            }}
          >
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value.slice(0, MAX_COMMENT_CHARS))}
              rows={3}
              maxLength={MAX_COMMENT_CHARS}
              className="w-full rounded-2xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/30"
            />
            <div className="flex items-center justify-between">
              <EmojiInsert value={editText} max={MAX_COMMENT_CHARS} onChange={setEditText} />
              <CharCount value={editText} max={MAX_COMMENT_CHARS} />
            </div>
            <div className="flex gap-3 text-xs">
              <button type="submit" className="font-semibold text-accent">
                {t("live.saveEdit")}
              </button>
              <button type="button" className="text-muted" onClick={() => setEditing(false)}>
                {t("live.cancelEdit")}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-1 space-y-2">
            {item.type === "comment" && item.body.media?.[0]?.mime.startsWith("audio/") ? (
              <VoiceNote
                media={item.body.media[0]}
                onRemove={
                  canChange
                    ? () => {
                        try {
                          if (!item.body.text.trim()) deleteComment(item);
                          else editComment(item, item.body.text, []);
                        } catch (err) {
                          console.warn(errorMessage(err, "live.editFailed"));
                        }
                      }
                    : undefined
                }
                removeLabel={t("compose.removeVoice")}
              />
            ) : null}
            {item.type === "comment" && item.body.media?.[0]?.mime.startsWith("video/") ? (
              <VideoNote
                media={item.body.media[0]}
                onRemove={
                  canChange
                    ? () => {
                        try {
                          if (!item.body.text.trim()) deleteComment(item);
                          else editComment(item, item.body.text, []);
                        } catch (err) {
                          console.warn(errorMessage(err, "live.editFailed"));
                        }
                      }
                    : undefined
                }
                removeLabel={t("compose.removeVideo")}
              />
            ) : null}
            {item.body.text.trim() ? (
              <p className="whitespace-pre-wrap">
                <FilteredText text={item.body.text} />
              </p>
            ) : null}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-3">
          <HeartButton count={cLikes.count} mine={cLikes.mine} onClick={() => toggleLike(item.sig, "comment")} />
          <button
            type="button"
            className="text-xs font-semibold text-plum"
            onClick={() => setReplyTo(replyTo === item.sig ? null : item.sig)}
          >
            {t("live.reply")}
          </button>
          <ReportButton
            done={cReports.mine}
            label={t("live.report")}
            reviewing={t("live.reviewing")}
            onClick={() => {
              try {
                report(item.sig, "comment");
              } catch (err) {
                console.warn(errorMessage(err, "live.reportFailed"));
              }
            }}
          />
        </div>
        {identity && replyTo === item.sig ? (
          <div className="mt-2">
            <CommentForm
              value={text}
              onChange={setText}
              onSubmit={() => {
                onSubmit(text, item.sig);
                setText("");
              }}
              onVoice={(blob) => {
                void (async () => {
                  try {
                    const media = await ingestVoice(blob);
                    onSubmit("", item.sig, media);
                  } catch {
                    // parent shows error via onSubmit
                  }
                })();
              }}
              onVideo={(file) => {
                void (async () => {
                  try {
                    const media = await ingestVideo(file);
                    onSubmit("", item.sig, media);
                  } catch {
                    // parent shows error via onSubmit
                  }
                })();
              }}
              placeholder={t("live.replyTo")}
              sendLabel={t("live.send")}
            />
            <button type="button" className="mt-1 text-xs text-muted" onClick={() => setReplyTo(null)}>
              {t("live.cancelReply")}
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-2 space-y-2">
        {(replies.length ? replies : nested).map((child) => (
          <CommentBlock
            key={child.sig}
            item={child}
            replies={comments(item.body.target).filter(
              (entry) => entry.type === "comment" && entry.body.parent === child.sig,
            )}
            depth={depth + 1}
            replyTo={replyTo}
            setReplyTo={setReplyTo}
            showHidden={showHidden}
            onSubmit={onSubmit}
          />
        ))}
      </div>
    </div>
  );
}

function CommentForm({
  value,
  onChange,
  onSubmit,
  onVoice,
  onVideo,
  onVoiceError,
  placeholder,
  sendLabel,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onVoice?: (blob: Blob) => void;
  onVideo?: (file: File) => void;
  onVoiceError?: (message: string) => void;
  placeholder: string;
  sendLabel: string;
  inputRef?: { current: HTMLInputElement | null };
}) {
  return (
    <form
      className="flex gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit();
      }}
    >
      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_COMMENT_CHARS))}
          placeholder={placeholder}
          maxLength={MAX_COMMENT_CHARS}
          className="w-full rounded-full border border-line bg-paper px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/30"
        />
        <div className="mt-1 flex items-center justify-between px-1">
          <span className="flex items-center gap-1">
            <EmojiInsert value={value} max={MAX_COMMENT_CHARS} onChange={onChange} />
            {onVoice ? <VoiceMic onBlob={onVoice} onError={onVoiceError} /> : null}
            {onVideo ? <VideoClip onFile={onVideo} onError={onVoiceError} /> : null}
          </span>
          <CharCount value={value} max={MAX_COMMENT_CHARS} />
        </div>
      </div>
      <button type="submit" className="mt-2 self-start text-sm font-semibold text-accent">
        {sendLabel}
      </button>
    </form>
  );
}
