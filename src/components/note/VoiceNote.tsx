import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { loadMediaRecord, onMediaStored, type MediaRef } from "@/lib/protocol/media";
import { requestMedia } from "@/lib/protocol/mesh";

function copyBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function fmt(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
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
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const bufRef = useRef<AudioBuffer | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const startedAt = useRef(0);
  const offsetRef = useRef(0);
  const raf = useRef(0);
  const playingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    const load = async () => {
      const rec = await loadMediaRecord(media.hash);
      if (!alive) return;
      if (!rec?.bytes) {
        requestMedia(media.hash);
        return;
      }
      if (!ctxRef.current) ctxRef.current = new Ctx();
      const ctx = ctxRef.current;
      try {
        const buf = await ctx.decodeAudioData(copyBuffer(rec.bytes));
        if (!alive) return;
        bufRef.current = buf;
        setDur(buf.duration);
        setReady(true);
      } catch {
        if (alive) setReady(false);
      }
    };

    void load();
    const stop = onMediaStored((hash) => {
      if (hash === media.hash) void load();
    });
    const retry = window.setInterval(() => {
      if (!alive || bufRef.current) return;
      requestMedia(media.hash);
      void load();
    }, 3000);
    return () => {
      alive = false;
      stop();
      window.clearInterval(retry);
      playingRef.current = false;
      cancelAnimationFrame(raf.current);
      try {
        srcRef.current?.stop();
      } catch {
        // already stopped
      }
      srcRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [media.hash]);

  function tick() {
    const ctx = ctxRef.current;
    const buf = bufRef.current;
    if (!ctx || !buf || !playingRef.current) return;
    const t = offsetRef.current + (ctx.currentTime - startedAt.current);
    if (t >= buf.duration) {
      playingRef.current = false;
      setPlaying(false);
      offsetRef.current = 0;
      setPos(0);
      return;
    }
    setPos(t);
    raf.current = requestAnimationFrame(tick);
  }

  async function toggle() {
    const ctx = ctxRef.current;
    const buf = bufRef.current;
    if (!ctx || !buf) return;
    if (ctx.state === "suspended") await ctx.resume();
    if (playingRef.current) {
      try {
        srcRef.current?.stop();
      } catch {
        // ignore
      }
      srcRef.current = null;
      offsetRef.current = Math.min(buf.duration, offsetRef.current + (ctx.currentTime - startedAt.current));
      playingRef.current = false;
      setPlaying(false);
      cancelAnimationFrame(raf.current);
      return;
    }
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    const off = offsetRef.current >= buf.duration - 0.05 ? 0 : offsetRef.current;
    offsetRef.current = off;
    startedAt.current = ctx.currentTime;
    node.onended = () => {
      if (srcRef.current !== node) return;
      playingRef.current = false;
      srcRef.current = null;
      offsetRef.current = 0;
      setPlaying(false);
      setPos(0);
    };
    node.start(0, off);
    srcRef.current = node;
    playingRef.current = true;
    setPlaying(true);
    raf.current = requestAnimationFrame(tick);
  }

  const ink = light ? "text-cream" : "text-ink";
  const bar = light ? "bg-cream/30" : "bg-line";
  const fill = light ? "bg-cream" : "bg-accent";

  if (!ready) {
    return <p className={`text-xs ${light ? "text-cream/70" : "text-muted"}`}>{t("live.voiceWait")}</p>;
  }

  return (
    <span className="block">
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
        <span className="w-10 text-[11px] font-semibold tabular-nums">
          {fmt(playing ? pos : dur)}
        </span>
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
