import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { ingestPhoto, isAcceptedPhoto, MAX_PHOTOS, type MediaRef } from "@/lib/protocol/media";
import { MAX_POST_CHARS } from "@/lib/protocol/envelope";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (!content.trim() && previews.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const media: MediaRef[] = [];
      for (const preview of previews) {
        media.push(await ingestPhoto(preview.file));
      }
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
        <h1 className="font-display text-2xl">{t("compose.title")}</h1>
        <p className="text-sm text-muted">{t("compose.subtitle")}</p>
        <p className="mt-2 text-xs leading-5 text-muted">{t("profile.editNote")}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{t("profile.capNote")}</p>
      </header>
      <form
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

        {error ? <p className="text-sm text-accent">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || (!content.trim() && previews.length === 0)}>
            {busy ? t("compose.saving") : t("compose.submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}
