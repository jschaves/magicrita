import { useEffect, useRef, useState } from "react";
import { Camera, FolderOpen, Square, Video } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { MAX_VIDEO_MS } from "@/lib/protocol/media";

function durationOf(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const node = document.createElement("video");
    node.preload = "metadata";
    node.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(node.duration) ? node.duration * 1000 : 0);
    };
    node.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("video"));
    };
    node.src = url;
  });
}

function secureEnough(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function pickRecorderMime(): string {
  const types = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function VideoClip({
  onFile,
  onError,
  disabled,
}: {
  onFile: (file: File) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recFlag = useRef(false);
  const busy = useRef(false);
  const sent = useRef(false);
  const gen = useRef(0);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      gen.current += 1;
      recFlag.current = false;
      window.clearInterval(timer.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!rec) return;
    void previewRef.current?.play().catch(() => {});
  }, [rec]);

  useEffect(() => {
    if (!open) return;
    const hide = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", hide);
    return () => document.removeEventListener("mousedown", hide);
  }, [open]);

  function fail(message: string) {
    sent.current = true;
    recFlag.current = false;
    releaseStream();
    setHint(message);
    onError?.(message);
    setRec(false);
    busy.current = false;
  }

  function releaseStream() {
    window.clearInterval(timer.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      onError?.(t("errors.media_type"));
      return;
    }
    try {
      const ms = await durationOf(file);
      if (ms > MAX_VIDEO_MS + 400) {
        onError?.(t("compose.videoTooLong"));
        return;
      }
    } catch {
      onError?.(t("errors.media_type"));
      return;
    }
    onFile(file);
  }

  function finish(mime: string) {
    if (sent.current) {
      releaseStream();
      setRec(false);
      setSecs(0);
      busy.current = false;
      return;
    }
    sent.current = true;
    const parts = chunks.current;
    chunks.current = [];
    releaseStream();
    setRec(false);
    setSecs(0);
    busy.current = false;
    const type = (mime || "video/webm").split(";")[0];
    const blob = new Blob(parts, { type: type.startsWith("video/") ? type : "video/webm" });
    if (blob.size < 32) {
      fail(t("live.videoDenied"));
      return;
    }
    setHint(null);
    const ext = type.includes("mp4") ? "mp4" : "webm";
    onFile(new File([blob], `clip.${ext}`, { type: blob.type }));
  }

  function stopCamera() {
    if (!recFlag.current) return;
    recFlag.current = false;
    window.clearInterval(timer.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    finish(recorder?.mimeType ?? "video/webm");
  }

  async function startCamera() {
    setOpen(false);
    if (disabled || rec || busy.current) return;
    setHint(null);
    if (!secureEnough()) {
      fail(t("live.videoInsecure"));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      fail(t("live.videoDenied"));
      return;
    }
    const mime = pickRecorderMime();
    const my = ++gen.current;
    sent.current = false;
    busy.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { facingMode: { ideal: "user" }, width: { ideal: 720 }, height: { ideal: 720 } },
      });
      if (my !== gen.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        void previewRef.current.play().catch(() => {});
      }
      chunks.current = [];
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_200_000 })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recorder.onerror = () => fail(t("live.videoDenied"));
      recorder.onstop = () => finish(recorder.mimeType || mime || "video/webm");
      recFlag.current = true;
      if (mime.includes("mp4")) recorder.start();
      else recorder.start(200);
      setRec(true);
      busy.current = false;
      setSecs(0);
      setHint(t("live.videoHint"));
      const started = Date.now();
      timer.current = window.setInterval(() => {
        const elapsed = Date.now() - started;
        setSecs(Math.min(10, Math.floor(elapsed / 1000)));
        if (elapsed >= MAX_VIDEO_MS) stopCamera();
      }, 200);
    } catch {
      releaseStream();
      fail(t("live.videoDenied"));
    }
  }

  return (
    <span className="inline-flex max-w-[16rem] flex-col items-start">
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void pick(file);
        }}
      />
      <div ref={root} className="relative">
        <button
          type="button"
          disabled={disabled}
          className={`rounded-full p-1.5 ${rec ? "bg-accent text-white" : "text-muted hover:bg-cream hover:text-plum"} disabled:opacity-40`}
          aria-label={rec ? t("live.recording") : t("compose.video")}
          onClick={() => {
            if (rec) stopCamera();
            else setOpen((on) => !on);
          }}
        >
          {rec ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold">
              <Square size={12} fill="currentColor" />
              0:{String(secs).padStart(2, "0")}
            </span>
          ) : (
            <Video size={16} />
          )}
        </button>
        {open && !rec ? (
          <div className="absolute bottom-full left-0 z-20 mb-1 flex min-w-[9.5rem] flex-col gap-0.5 rounded-2xl border border-line bg-paper p-1 shadow-sm">
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-semibold text-ink hover:bg-cream"
              onClick={() => {
                setOpen(false);
                inputRef.current?.click();
              }}
            >
              <FolderOpen size={14} className="text-plum" />
              {t("compose.videoFile")}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-semibold text-ink hover:bg-cream"
              onClick={() => void startCamera()}
            >
              <Camera size={14} className="text-plum" />
              {t("compose.videoCamera")}
            </button>
          </div>
        ) : null}
        <video
          ref={previewRef}
          muted
          playsInline
          autoPlay
          className={
            rec
              ? "absolute bottom-full left-0 z-30 mb-1 h-40 w-40 rounded-2xl border border-line bg-ink object-cover shadow-sm"
              : "pointer-events-none hidden"
          }
        />
      </div>
      {hint ? <span className="mt-0.5 text-[10px] leading-3 text-accent">{hint}</span> : null}
    </span>
  );
}
