import { useEffect, useState } from "react";
import type { MediaRef } from "@/lib/protocol/media";
import { ensurePhotoSrc, loadPreview, onMediaStored, peekRamPhotoUrl } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";

const sizes = {
  sm: "h-11 w-11 text-sm",
  md: "h-12 w-12 text-sm",
  lg: "h-20 w-20 text-2xl",
};

function isImgSrc(value?: string): value is string {
  return Boolean(value && (value.startsWith("data:image/") || value.startsWith("blob:")));
}

export function Avatar({
  name,
  picture,
  src,
  size = "sm",
}: {
  name?: string;
  picture?: MediaRef;
  src?: string;
  size?: keyof typeof sizes;
}) {
  const hash = picture?.hash;
  // Thumbnail en línea del propio sobre, o el que dejó un par. Se pinta al
  // instante y despues se sustituye por la imagen completa si esta en el disco.
  const preview = (picture?.preview && isImgSrc(picture.preview) ? picture.preview : undefined) ?? (hash ? loadPreview(hash) : undefined);
  const [url, setUrl] = useState<string | null>(() => (isImgSrc(src) ? src : preview ?? null));
  const [failed, setFailed] = useState(false);
  const initial = (name || "R").slice(0, 1).toUpperCase();
  const box = `flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-plum font-bold text-white ${sizes[size]}`;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (isImgSrc(src)) {
      setUrl(src);
      return;
    }
    const quick = preview ?? (hash ? peekRamPhotoUrl(hash) : null);
    if (quick) setUrl(quick);
    if (!hash) {
      if (!quick) setUrl(null);
      return;
    }
    const show = (next: string | null) => {
      if (cancelled || !next) return;
      setFailed(false);
      setUrl(next);
    };
    void ensurePhotoSrc(hash).then((next) => {
      if (next) {
        show(next);
        return;
      }
      // No está en el dispositivo: pídela a los pares (mientras, se ve el thumb).
      if (!cancelled) requestMedia(hash);
    });
    const stop = onMediaStored((stored) => {
      if (stored !== hash || cancelled) return;
      void ensurePhotoSrc(hash, true).then(show);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [src, hash, preview]);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        onError={() => {
          // Si falla la imagen completa, se queda el thumbnail; sin el, inicial.
          if (preview && url !== preview) {
            setUrl(preview);
            return;
          }
          setFailed(true);
          if (hash) {
            void ensurePhotoSrc(hash, true).then((next) => {
              if (!next) return;
              setFailed(false);
              setUrl(next);
            });
          }
        }}
        className={`${box} object-cover`}
      />
    );
  }

  return <div className={box}>{initial}</div>;
}
