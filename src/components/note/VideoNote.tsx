import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { loadVerifiedBlob, onMediaStored, type MediaRef } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";
import { revealMediaDuration } from "@/lib/protocol/stampMedia";

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
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    const pull = async () => {
      if (url) return;
      const blob = await loadVerifiedBlob(media.hash, media.mime);
      if (!alive || !blob) {
        if (alive && !blob) requestMedia(media.hash);
        return;
      }
      url = URL.createObjectURL(blob);
      setSrc(url);
    };
    void pull();
    const stop = onMediaStored((hash) => {
      if (hash === media.hash) void pull();
    });
    const retry = window.setInterval(() => {
      if (!alive || url) return;
      requestMedia(media.hash);
      void pull();
    }, 5000);
    return () => {
      alive = false;
      stop();
      window.clearInterval(retry);
    };
  }, [media.hash, media.mime]);

  if (!src) {
    return <p className="text-xs text-muted">{t("compose.videoWait")}</p>;
  }

  return (
    <span className="block">
      <video
        src={src}
        controls
        playsInline
        preload="auto"
        className="mt-1 max-h-[32rem] w-full rounded-2xl border border-line bg-ink"
        ref={(el) => revealMediaDuration(el)}
      />
      {onRemove ? (
        <button type="button" className="mt-1 text-[11px] font-semibold text-accent" onClick={onRemove}>
          {removeLabel}
        </button>
      ) : null}
    </span>
  );
}
