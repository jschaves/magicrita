import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { MAX_VOICE_MS } from "@/lib/protocol/media";

const TARGET_RATE = 16_000;

function secureEnough(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)] ?? 0;
  return out;
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const merged = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const pcm = downsample(merged, sampleRate, TARGET_RATE);
  const bytes = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(bytes);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let p = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    p += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export function VoiceMic({
  onBlob,
  onError,
  disabled,
}: {
  onBlob: (blob: Blob) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const samples = useRef<Float32Array[]>([]);
  const busy = useRef(false);
  const recFlag = useRef(false);

  useEffect(() => {
    return () => {
      recFlag.current = false;
      window.clearInterval(timer.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void ctxRef.current?.close();
    };
  }, []);

  function fail(message: string) {
    setHint(message);
    onError?.(message);
    setRec(false);
    recFlag.current = false;
    busy.current = false;
  }

  function cleanup() {
    window.clearInterval(timer.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    try {
      procRef.current?.disconnect();
    } catch {
      // ignore
    }
    procRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
  }

  async function start() {
    if (disabled || rec || busy.current) return;
    setHint(null);
    if (!secureEnough()) {
      fail(t("live.voiceInsecure"));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(t("live.voiceDenied"));
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      fail(t("live.voiceDenied"));
      return;
    }
    busy.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      const ctx = new AC();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      samples.current = [];
      processor.onaudioprocess = (event) => {
        if (!recFlag.current) return;
        samples.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      procRef.current = processor;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      recFlag.current = true;
      setRec(true);
      busy.current = false;
      setSecs(0);
      setHint(t("live.voiceHint"));
      const started = Date.now();
      timer.current = window.setInterval(() => {
        const elapsed = Date.now() - started;
        setSecs(Math.floor(elapsed / 1000));
        if (elapsed >= MAX_VOICE_MS) stop();
      }, 200);
    } catch {
      cleanup();
      fail(t("live.voiceDenied"));
    }
  }

  function stop() {
    if (!recFlag.current) return;
    recFlag.current = false;
    window.clearInterval(timer.current);
    const rate = ctxRef.current?.sampleRate ?? TARGET_RATE;
    const chunks = samples.current;
    samples.current = [];
    cleanup();
    setRec(false);
    setSecs(0);
    busy.current = false;
    if (!chunks.length) {
      fail(t("live.voiceDenied"));
      return;
    }
    const blob = encodeWav(chunks, rate);
    if (blob.size < 128) {
      fail(t("live.voiceDenied"));
      return;
    }
    setHint(null);
    onBlob(blob);
  }

  return (
    <span className="inline-flex max-w-[14rem] flex-col items-start">
      <button
        type="button"
        disabled={disabled}
        className={`rounded-full p-1.5 ${rec ? "bg-accent text-white" : "text-muted hover:bg-cream hover:text-plum"}`}
        aria-label={rec ? t("live.recording") : t("live.voice")}
        onClick={() => (rec ? stop() : void start())}
      >
        {rec ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold">
            <Square size={12} fill="currentColor" />
            0:{String(Math.min(secs, 30)).padStart(2, "0")}
          </span>
        ) : (
          <Mic size={16} />
        )}
      </button>
      {hint ? <span className="mt-0.5 text-[10px] leading-3 text-accent">{hint}</span> : null}
    </span>
  );
}
