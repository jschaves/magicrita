import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { loadVerifiedBlob, onMediaStored, type MediaRef } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";
import { revealMediaDuration } from "@/lib/protocol/stampMedia";

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
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);

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

  async function toggle() {
    const el = node.current;
    if (!el) return;
    try {
      if (el.paused) await el.play();
      else el.pause();
    } catch {
      setPlaying(false);
    }
  }

  if (!src) {
    return <p className={`text-xs ${light ? "text-cream/70" : "text-muted"}`}>{t("live.voiceWait")}</p>;
  }

  const ink = light ? "text-cream" : "text-ink";
  const track = light ? "bg-cream/25" : "bg-line";
  const fill = light ? "bg-cream" : "bg-accent";

  return (
    <span className={`block w-full min-w-0 max-w-full ${ink}`}>
      <audio
        ref={(el) => {
          node.current = el;
          revealMediaDuration(el);
        }}
        src={src}
        preload="auto"
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
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
      <span className={`flex items-center gap-2 rounded-2xl px-2 py-1.5 ${light ? "bg-cream/15" : "border border-line bg-cream"}`}>
        <Mic size={16} className={light ? "text-cream/90" : "text-plum"} aria-hidden />
        <button
          type="button"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            light ? "bg-cream text-plum" : "bg-plum text-cream"
          }`}
          aria-label={playing ? t("compose.pause") : t("compose.play")}
          onClick={() => void toggle()}
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
        <span className="min-w-0 flex-1">
          <span className={`flex h-2 overflow-hidden rounded-full ${track}`}>
            <span
              className={`block h-full rounded-full ${fill}`}
              style={{ width: `${dur > 0 ? Math.min(100, (pos / dur) * 100) : 0}%` }}
            />
          </span>
          <span className={`mt-1 block text-[11px] font-semibold tabular-nums ${light ? "text-cream/80" : "text-muted"}`}>
            {t("live.voice")} · {fmt(playing ? pos : dur || 0)}
          </span>
        </span>
      </span>
      {onRemove ? (
        <button
          type="button"
          className={`mt-1 text-[11px] font-semibold ${light ? "text-cream/80" : "text-accent"}`}
          onClick={onRemove}
        >
          {removeLabel}
        </button>
      ) : null}
    </span>
  );
}
