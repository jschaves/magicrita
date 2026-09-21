import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ensurePhotoSrc, onMediaStored, type MediaRef } from "@/lib/protocol/media";

export function VoiceNote({ media, light }: { media: MediaRef; light?: boolean }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void ensurePhotoSrc(media.hash).then((url) => {
      if (alive) setSrc(url);
    });
    const stop = onMediaStored((hash) => {
      if (hash === media.hash) void ensurePhotoSrc(media.hash, true).then((url) => {
        if (alive) setSrc(url);
      });
    });
    return () => {
      alive = false;
      stop();
    };
  }, [media.hash]);

  if (!src) {
    return <p className={`text-xs ${light ? "text-cream/70" : "text-muted"}`}>{t("live.voiceWait")}</p>;
  }
  return (
    <audio
      controls
      src={src}
      className="max-w-full"
      preload="metadata"
      playsInline
    />
  );
}
