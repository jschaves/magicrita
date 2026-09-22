import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { loadVerifiedBlob, onMediaStored, type MediaRef } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";

function fmt(secs: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(secs) ? secs : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  const node = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const blob = await loadVerifiedBlob(media.hash, media.mime);
      if (!alive) return;
      if (!blob) {
        requestMedia(media.hash);
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setSrc(url);
    };
    void pull();
    const stop = onMediaStored((hash) => {
      if (hash === media.hash) void pull();
    });
    const retry = window.setInterval(() => {
      if (!alive || urlRef.current) return;
      requestMedia(media.hash);
      void pull();
    }, 2500);
    return () => {
      alive = false;
      stop();
      window.clearInterval(retry);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [media.hash, media.mime]);

  useEffect(() => {
    const el = node.current;
    if (!el || !src) return;
    el.src = src;
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

  const ink = light ? "text-cream" : "text-ink";
  const bar = light ? "bg-cream/30" : "bg-line";
  const fill = light ? "bg-cream" : "bg-accent";

  if (!src) {
    return <p className={`text-xs ${light ? "text-cream/70" : "text-muted"}`}>{t("live.voiceWait")}</p>;
  }

  return (
    <span className="block">
      <audio
        ref={node}
        preload="auto"
        className="hidden"
        onTimeUpdate={(event) => setPos(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDur(event.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
          const el = node.current;
          if (el) el.currentTime = 0;
        }}
      />
      <span className={`flex items-center gap-2 ${ink}`}>
        <button
          type="button"
          className={`rounded-full p-2 ${light ? "bg-cream/20 hover:bg-cream/30" : "bg-cream hover:bg-line"}`}
          aria-label={playing ? t("compose.pause") : t("compose.play")}
          onClick={() => void toggle()}
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <span className={`h-1.5 flex-1 overflow-hidden rounded-full ${bar}`}>
          <span
            className={`block h-full rounded-full ${fill}`}
            style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }}
          />
        </span>
        <span className="w-10 text-[11px] font-semibold tabular-nums">{fmt(playing ? pos : dur)}</span>
      </span>
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
