import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ensurePhotoSrc, onMediaStored, type MediaRef } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";

export function VideoNote({
  media,
  onRemove,
  removeLabel,
}: {
  media: MediaRef;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const { t } = useI18n();
  const node = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const mime = media.mime?.startsWith("video/") ? media.mime.split(";")[0] : "video/webm";

  useEffect(() => {
    let alive = true;
    const show = (url: string | null) => {
      if (alive && url) setSrc((prev) => prev ?? url);
    };
    void ensurePhotoSrc(media.hash, false, mime).then((url) => {
      if (url) show(url);
      else requestMedia(media.hash);
    });
    const stop = onMediaStored((hash) => {
      if (hash !== media.hash) return;
      void ensurePhotoSrc(media.hash, false, mime).then(show);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [media.hash, mime]);

  useEffect(() => {
    const el = node.current;
    if (!el || !src) return;
    if (el.getAttribute("src") !== src) {
      el.src = src;
    }
  }, [src]);

  async function toggle() {
    const el = node.current;
    if (!el) return;
    try {
      if (el.paused) {
        await el.play();
        setPlaying(true);
      } else {
        el.pause();
        setPlaying(false);
      }
    } catch {
      setPlaying(false);
    }
  }

  if (!src) {
    return <p className="text-xs text-muted">{t("compose.videoWait")}</p>;
  }

  return (
    <span className="block">
      <span className="relative mt-1 block overflow-hidden rounded-2xl border border-line bg-ink">
        <video
          ref={node}
          playsInline
          preload="auto"
          className="max-h-[32rem] w-full"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            const el = node.current;
            if (el) el.currentTime = 0;
          }}
        />
        <button
          type="button"
          className={`absolute inset-0 flex items-center justify-center ${playing ? "bg-transparent" : "bg-ink/30"}`}
          aria-label={playing ? t("compose.pause") : t("compose.play")}
          onClick={() => void toggle()}
        >
          {playing ? null : (
            <span className="rounded-full bg-paper/90 p-3 text-ink shadow-sm">
              <Play size={22} fill="currentColor" />
            </span>
          )}
        </button>
      </span>
      {onRemove ? (
        <button type="button" className="mt-1 text-[11px] font-semibold text-accent" onClick={onRemove}>
          {removeLabel}
        </button>
      ) : null}
    </span>
  );
}
