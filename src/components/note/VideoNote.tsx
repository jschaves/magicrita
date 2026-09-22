import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ensurePhotoSrc, onMediaStored, type MediaRef } from "@/lib/protocol/media";

export function VideoNote({ media }: { media: MediaRef }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void ensurePhotoSrc(media.hash).then((url) => {
      if (alive) setSrc(url);
    });
    const stop = onMediaStored((hash) => {
      if (hash === media.hash) {
        void ensurePhotoSrc(media.hash, true).then((url) => {
          if (alive) setSrc(url);
        });
      }
    });
    return () => {
      alive = false;
      stop();
    };
  }, [media.hash]);

  if (!src) {
    return <p className="text-xs text-muted">{t("compose.videoWait")}</p>;
  }
  return (
    <video
      controls
      playsInline
      preload="metadata"
      src={src}
      className="mt-1 max-h-[32rem] w-full rounded-2xl border border-line bg-ink"
    />
  );
}
