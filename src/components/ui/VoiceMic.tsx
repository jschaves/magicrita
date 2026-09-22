import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { MAX_VOICE_MS } from "@/lib/protocol/media";
import { dropStream, getMicStream, isSecureMedia } from "@/lib/protocol/mediaAccess";
import { recorderAudioToWav, stampMediaDuration } from "@/lib/protocol/stampMedia";

function pickAudioMime(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
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
  const timer = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const busy = useRef(false);
  const recFlag = useRef(false);
  const sent = useRef(false);
  const elapsedRef = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    return () => {
      recFlag.current = false;
      window.clearInterval(timer.current);
      dropStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  function fail(message: string) {
    sent.current = true;
    recFlag.current = false;
    cleanup();
    setHint(message);
    onError?.(message);
    setRec(false);
    busy.current = false;
  }

  function cleanup() {
    window.clearInterval(timer.current);
    const recoder = recorderRef.current;
    recorderRef.current = null;
    if (recoder && recoder.state !== "inactive") {
      try {
        recoder.stop();
      } catch {
        // ignore
      }
    }
    dropStream(streamRef.current);
    streamRef.current = null;
  }

  function finish(mime: string) {
    if (sent.current) {
      cleanup();
      setRec(false);
      busy.current = false;
      return;
    }
    sent.current = true;
    const parts = chunks.current;
    chunks.current = [];
    const ms = elapsedRef.current;
    cleanup();
    setRec(false);
    setSecs(0);
    busy.current = false;
    const type = (mime || "audio/webm").split(";")[0];
    const raw = new Blob(parts, { type: type.startsWith("audio/") ? type : "audio/webm" });
    if (raw.size < 64) {
      fail(t("live.voiceDenied"));
      return;
    }
    void (async () => {
      let blob = await recorderAudioToWav(raw);
      if (!blob.type.includes("wav")) blob = await stampMediaDuration(blob, ms);
      setHint(null);
      onBlob(blob);
    })();
  }

  function stop() {
    if (!recFlag.current) return;
    recFlag.current = false;
    window.clearInterval(timer.current);
    elapsedRef.current = Date.now() - startedAt.current;
    const recoder = recorderRef.current;
    if (recoder && recoder.state === "recording") {
      try {
        recoder.requestData();
      } catch {
        // ignore
      }
      recoder.stop();
      return;
    }
    finish(recoder?.mimeType ?? "audio/webm");
  }

  async function start() {
    if (disabled || rec || busy.current) return;
    setHint(null);
    if (!isSecureMedia()) {
      fail(t("live.voiceInsecure"));
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      fail(t("live.voiceDenied"));
      return;
    }
    const mime = pickAudioMime();
    busy.current = true;
    sent.current = false;
    try {
      const stream = await getMicStream();
      streamRef.current = stream;
      chunks.current = [];
      const recoder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recoder;
      recoder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recoder.onerror = () => fail(t("live.voiceDenied"));
      recoder.onstop = () => finish(recoder.mimeType || mime || "audio/webm");
      recFlag.current = true;
      recoder.start(250);
      setRec(true);
      busy.current = false;
      setSecs(0);
      setHint(t("live.voiceHint"));
      startedAt.current = Date.now();
      elapsedRef.current = 0;
      timer.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAt.current;
        elapsedRef.current = elapsed;
        setSecs(Math.floor(elapsed / 1000));
        if (elapsed >= MAX_VOICE_MS) stop();
      }, 200);
    } catch {
      fail(t("live.voiceDenied"));
    }
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
