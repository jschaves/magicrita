import { useEffect, useState } from "react";
import type { MediaRef } from "@/lib/protocol/media";
import { loadPhotoUrl, onMediaStored, peekRamPhotoUrl } from "@/lib/protocol/media";
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
  const [url, setUrl] = useState<string | null>(() => (isImgSrc(src) ? src : null));
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
    const hash = picture?.hash;
    if (!hash) {
      setUrl(null);
      return;
    }
    const ram = peekRamPhotoUrl(hash);
    if (ram) {
      setUrl(ram);
      return;
    }
    void loadPhotoUrl(hash).then((next) => {
      if (cancelled) {
        if (next) URL.revokeObjectURL(next);
        return;
      }
      if (next) setUrl(next);
      else requestMedia(hash);
    });
    const stop = onMediaStored((stored) => {
      if (stored !== hash || cancelled) return;
      void loadPhotoUrl(hash).then((next) => {
        if (!cancelled && next) setUrl(next);
      });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [src, picture?.hash]);

  if (url && !failed) {
    return <img src={url} alt="" onError={() => setFailed(true)} className={`${box} object-cover`} />;
  }

  return <div className={box}>{initial}</div>;
}
