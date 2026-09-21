import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { MAX_VOICE_MS } from "@/lib/protocol/media";

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function secureEnough(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
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
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    return () => {
      window.clearInterval(timer.current);
      try {
        recRef.current?.stop();
      } catch {
        // ignore
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function fail(message: string) {
    setHint(message);
    onError?.(message);
    setRec(false);
    busy.current = false;
  }

  async function start() {
    if (disabled || rec || busy.current) return;
    setHint(null);
    if (!secureEnough()) {
      fail(t("live.voiceInsecure"));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      fail(t("live.voiceDenied"));
      return;
    }
    busy.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.onerror = () => fail(t("live.voiceDenied"));
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        window.clearInterval(timer.current);
        const type = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type: type.startsWith("audio/") ? type : "audio/webm" });
        setRec(false);
        setSecs(0);
        busy.current = false;
        if (blob.size < 32) {
          fail(t("live.voiceDenied"));
          return;
        }
        setHint(null);
        onBlob(blob);
      };
      recRef.current = recorder;
      recorder.start();
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
      fail(t("live.voiceDenied"));
    }
  }

  function stop() {
    window.clearInterval(timer.current);
    const recorder = recRef.current;
    recRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        if (recorder.state === "recording") recorder.requestData();
      } catch {
        // ignore
      }
      recorder.stop();
    } else {
      busy.current = false;
      setRec(false);
    }
  }

  return (
    <span className="inline-flex max-w-[12rem] flex-col items-start">
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
