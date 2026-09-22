import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ensurePhotoSrc, onMediaStored, type MediaRef } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";

const bound = new WeakSet<HTMLMediaElement>();

function bindPlayable(el: HTMLMediaElement | null) {
  if (!el || bound.has(el)) return;
  bound.add(el);
  const snap = () => {
    if (el.currentTime > 1e6) {
      el.currentTime = 0;
    }
  };
  const fix = () => {
    if (el.duration === Infinity || Number.isNaN(el.duration)) {
      try {
        el.currentTime = 1e101;
      } catch {
        // ignore
      }
    }
  };
  el.addEventListener("loadedmetadata", fix);
  el.addEventListener("timeupdate", snap);
  if (el.readyState >= 1) fix();
  try {
    el.load();
  } catch {
    // ignore
  }
}

export function VoiceNote({
  media,
  light,
  onRemove,
  removeLabel,
}: {
  media: MediaRef;
  light?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);
  const mime = media.mime?.startsWith("audio/") ? media.mime.split(";")[0] : "audio/wav";

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
      void ensurePhotoSrc(media.hash, true, mime).then(show);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [media.hash, mime]);

  if (!src) {
    return <p className={`text-xs ${light ? "text-cream/70" : "text-muted"}`}>{t("live.voiceWait")}</p>;
  }
  return (
    <span className="block">
      <audio
        key={src}
        ref={bindPlayable}
        controls
        preload="auto"
        playsInline
        className="w-full max-w-full"
      >
        <source src={src} type={mime} />
      </audio>
      {onRemove ? (
        <button
          type="button"
          className={`mt-0.5 text-[11px] font-semibold ${light ? "text-cream/80" : "text-accent"}`}
          onClick={onRemove}
        >
          {removeLabel}
        </button>
      ) : null}
    </span>
  );
}
