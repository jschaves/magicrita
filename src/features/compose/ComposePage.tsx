import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { EmojiInsert } from "@/components/ui/EmojiInsert";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { ingestPhoto, ingestVideo, ingestVoice, isAcceptedPhoto, MAX_PHOTOS, type MediaRef } from "@/lib/protocol/media";
import { MAX_POST_CHARS } from "@/lib/protocol/envelope";
import { VoiceMic } from "@/components/ui/VoiceMic";
import { VoiceNote } from "@/components/note/VoiceNote";
import { VideoClip } from "@/components/ui/VideoClip";
import { VideoNote } from "@/components/note/VideoNote";
import { MobileDock } from "@/components/ui/MobileDock";
import { useVisualViewport } from "@/lib/useVisualViewport";
import { InfoButton } from "@/components/ui/InfoButton";


type Preview = {
  file: File;
  url: string;
};

export function ComposePage() {
  const { publishPost } = useRita();
  const { t, errorMessage } = useI18n();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [voice, setVoice] = useState<MediaRef | null>(null);
  const [video, setVideo] = useState<MediaRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const view = useVisualViewport();
  const pinSubmit = view.mobile && view.keyboard;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const incoming = [...list].filter(isAcceptedPhoto);
    if (incoming.length === 0) {
      setError(t("errors.media_type"));
      return;
    }
    setPreviews((current) => {
      const room = MAX_PHOTOS - current.length;
      if (room <= 0) return current;
      const extra = incoming.slice(0, room).map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));
      return [...current, ...extra];
    });
  }

  function removePreview(index: number) {
    setPreviews((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim() && previews.length === 0 && !voice && !video) return;
    setBusy(true);
    setError(null);
    try {
      const media: MediaRef[] = [];
      for (const preview of previews) {
        media.push(await ingestPhoto(preview.file));
      }
      if (voice) media.push(voice);
      if (video) media.push(video);
      publishPost(content, media);
      previews.forEach((item) => URL.revokeObjectURL(item.url));
      navigate("/");
    } catch (err) {
      setError(errorMessage(err, "compose.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl">{t("compose.title")}</h1>
          <InfoButton
            title={t("compose.title")}
            body={`${t("compose.subtitle")}\n\n${t("profile.editNote")}\n${t("profile.capNote")}`}
          />
        </div>
      </header>
      <form
        id="compose-form"
        className="space-y-4 p-4"
        onSubmit={(event) => void onSubmit(event)}
        onDragOver={(event) => {
          if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (![...event.dataTransfer.files].some(isAcceptedPhoto)) return;
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
      >
        <TextArea
          label={t("compose.note")}
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, MAX_POST_CHARS))}
          placeholder={t("compose.placeholder")}
          maxLength={MAX_POST_CHARS}
          counter
          onPaste={(e) => {
            const files = e.clipboardData?.files;
            if (files && files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onDragOver={(e) => {
            if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
          }}
        />
        <div className="-mt-2">
          <EmojiInsert value={content} max={MAX_POST_CHARS} onChange={setContent} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold">{t("compose.photos")}</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {previews.length > 0 ? (
            <div className="mb-3">
              {previews.map((item, index) => (
                <div key={item.url} className="relative">
                  <img src={item.url} alt="" className="h-36 w-full rounded-2xl object-cover" />
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-full bg-ink/80 p-1 text-white"
                    onClick={() => removePreview(index)}
                    aria-label={t("compose.removePhoto")}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={previews.length >= MAX_PHOTOS}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus size={16} />
            {t("compose.addPhotos")}
          </Button>
          <p className="mt-1 text-xs text-muted">{t("compose.photoHint")}</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold">{t("compose.voice")}</p>
          {voice ? (
            <div className="mb-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <VoiceNote media={voice} />
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-muted hover:text-accent"
                onClick={() => setVoice(null)}
                aria-label={t("compose.removeVoice")}
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <VoiceMic
              onBlob={(blob) => {
                void (async () => {
                  try {
                    setVoice(await ingestVoice(blob));
                    setError(null);
                  } catch (err) {
                    setError(errorMessage(err, "compose.failed"));
                  }
                })();
              }}
              onError={setError}
            />
          )}
          <p className="mt-1 text-xs text-muted">{t("compose.voiceHint")}</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold">{t("compose.video")}</p>
          {video ? (
            <div className="mb-2">
              <VideoNote media={video} />
              <button
                type="button"
                className="mt-1 text-xs font-semibold text-accent"
                onClick={() => setVideo(null)}
              >
                {t("compose.removeVideo")}
              </button>
            </div>
          ) : (
            <VideoClip
              onError={setError}
              onFile={(file) => {
                void (async () => {
                  try {
                    setVideo(await ingestVideo(file));
                    setError(null);
                  } catch (err) {
                    setError(errorMessage(err, "compose.failed"));
                  }
                })();
              }}
            />
          )}
          <p className="mt-1 text-xs text-muted">{t("compose.videoHint")}</p>
        </div>

        {error ? <p className="text-sm text-accent">{error}</p> : null}
        <div className={pinSubmit ? "hidden" : "flex justify-end"}>
          <Button type="submit" disabled={busy || (!content.trim() && previews.length === 0 && !voice && !video)}>
            {busy ? t("compose.saving") : t("compose.submit")}
          </Button>
        </div>
      </form>
      <MobileDock enabled={pinSubmit} role="composer" className="border-t border-line p-3">
        <div className="flex justify-end">
          <Button
            type="submit"
            form="compose-form"
            disabled={busy || (!content.trim() && previews.length === 0 && !voice && !video)}
          >
            {busy ? t("compose.saving") : t("compose.submit")}
          </Button>
        </div>
      </MobileDock>
    </section>
  );
}
