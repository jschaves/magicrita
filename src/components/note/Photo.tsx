import { useEffect, useState } from "react";
import { ensurePhotoSrc, livePhotoUrl, loadPreview, onMediaStored } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";

export function Photo({ hash, alt, preview }: { hash: string; alt: string; preview?: string }) {
  const [url, setUrl] = useState<string | null>(
    () => livePhotoUrl(hash) || preview || loadPreview(hash) || null,
  );

  useEffect(() => {
    let stop = false;
    const show = (next: string | null | undefined) => {
      if (!stop && next) setUrl(next);
    };
    const load = (fresh: boolean) => {
      void ensurePhotoSrc(hash, fresh).then((next) => {
        if (stop) return;
        if (next) show(next);
        else requestMedia(hash);
      });
    };
    show(livePhotoUrl(hash) || preview || loadPreview(hash));
    load(false);
    const unsub = onMediaStored((stored) => {
      if (stored !== hash || stop) return;
      load(true);
    });
    return () => {
      stop = true;
      unsub();
    };
  }, [hash, preview]);

  if (!url) {
    return <div className="mt-1 h-48 w-full animate-pulse rounded-2xl bg-line" />;
  }

  return (
    <img
      src={url}
      alt={alt}
      className="mt-1 max-h-[32rem] w-full rounded-2xl border border-line bg-paper object-contain"
    />
  );
}
