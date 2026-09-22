import { useEffect, useState } from "react";
import { livePhotoUrl, loadPhotoUrl, mqKey, onMediaStored } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";

function isFull(url: string | null | undefined): url is string {
  return Boolean(url && (url.startsWith("blob:") || (url.startsWith("data:image/") && url.length > 30_000)));
}

export function useStoredPhoto(hash?: string, src?: string) {
  const [url, setUrl] = useState<string | null>(() => (isFull(src) ? src : null));

  useEffect(() => {
    let cancelled = false;
    let got = false;

    const pull = async () => {
      if (!hash) {
        if (isFull(src)) setUrl(src);
        return;
      }
      const live = livePhotoUrl(hash);
      if (isFull(live)) {
        got = true;
        setUrl(live);
        return;
      }
      try {
        const hq = await loadPhotoUrl(hash);
        if (cancelled) return;
        if (hq) {
          got = true;
          setUrl(hq);
          return;
        }
        const mid = await loadPhotoUrl(mqKey(hash));
        if (cancelled) return;
        if (mid) {
          got = true;
          setUrl(mid);
          return;
        }
        requestMedia(hash);
      } catch {
        if (!cancelled) requestMedia(hash);
      }
    };

    void pull();
    if (!hash) return;
    const stop = onMediaStored((stored) => {
      if (stored === hash && !cancelled) void pull();
    });
    let tries = 0;
    const retry = window.setInterval(() => {
      if (cancelled || got || tries >= 6) return;
      tries += 1;
      void pull();
    }, 4000);
    return () => {
      cancelled = true;
      stop();
      window.clearInterval(retry);
    };
  }, [hash, src]);

  return { url, placeholder: null as string | null, tier: url ? ("hq" as const) : ("lq" as const) };
}
