import { useEffect, useRef, useSyncExternalStore } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { shortenId } from "@/lib/protocol/identity";
import {
  acceptCall,
  declineCall,
  endCall,
  getCallSnapshot,
  subscribeCall,
  toggleCam,
  toggleMute,
} from "@/lib/protocol/call";

/**
 * Panel de llamada de audio o vídeo. Vive en `App` para que la llamada entrante
 * se vea esté donde esté la persona, no solo dentro de Mensajes.
 */
export function CallOverlay() {
  const call = useSyncExternalStore(subscribeCall, getCallSnapshot, () => null);
  const { profileOf } = useRita();
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // `phase` importa: al pasar a `active` se montan los `<video>`, así que hay
  // que reasignar el `srcObject` de los elementos recién creados aunque el
  // stream no haya cambiado. Sin esto la videollamada se conecta pero se ve
  // negra (y sin audio): el `<video>` nuevo se quedaba sin stream.
  useEffect(() => {
    const remote = call?.remote ?? null;
    const audio = audioRef.current;
    if (audio) {
      audio.srcObject = remote && !call?.video ? remote : null;
      if (audio.srcObject) void audio.play().catch(() => undefined);
    }
    const remoteVideo = remoteVideoRef.current;
    if (remoteVideo) {
      remoteVideo.srcObject = call?.video ? remote : null;
      if (remoteVideo.srcObject) void remoteVideo.play().catch(() => undefined);
    }
    const localVideo = localVideoRef.current;
    if (localVideo) localVideo.srcObject = call?.local ?? null;
  }, [call?.remote, call?.local, call?.video, call?.phase]);

  if (!call) return null;

  const name = profileOf(call.peer)?.name || shortenId(call.peer);
  const label =
    call.phase === "incoming"
      ? t(call.video ? "messages.videoCall.incoming" : "messages.call.incoming", { name })
      : call.phase === "outgoing"
        ? t(call.video ? "messages.videoCall.calling" : "messages.call.calling", { name })
        : t(call.video ? "messages.videoCall.active" : "messages.call.active", { name });

  const controls = (
    <>
      {call.phase === "active" ? (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={call.muted ? t("messages.call.unmute") : t("messages.call.mute")}
          className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
            call.muted ? "border-accent text-accent" : "border-line text-muted hover:text-plum"
          }`}
        >
          {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
      ) : null}
      {call.phase === "active" && call.video ? (
        <button
          type="button"
          onClick={toggleCam}
          aria-label={call.camOff ? t("messages.videoCall.camOn") : t("messages.videoCall.camOff")}
          className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
            call.camOff ? "border-accent text-accent" : "border-line text-muted hover:text-plum"
          }`}
        >
          {call.camOff ? <VideoOff size={18} /> : <Video size={18} />}
        </button>
      ) : null}
      <button
        type="button"
        onClick={endCall}
        aria-label={t("messages.call.hangup")}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-dark"
      >
        <PhoneOff size={18} />
      </button>
    </>
  );

  const icon = call.video ? <Video size={18} /> : <Phone size={18} />;

  // Videollamada activa: vídeo remoto grande con la propia cámara en pequeño.
  if (call.video && call.phase === "active") {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col bg-ink/90">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="min-h-0 flex-1 bg-black object-contain"
        />
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute right-4 top-4 h-28 w-20 rounded-2xl border border-cream/30 bg-black object-cover"
        />
        <div className="flex shrink-0 items-center justify-between gap-3 bg-ink/80 px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-cream">{label}</p>
          <div className="flex shrink-0 items-center gap-2">{controls}</div>
        </div>
        <audio ref={audioRef} autoPlay />
      </div>
    );
  }

  return (
    <div className="fixed left-1/2 top-4 z-[90] w-[min(22rem,calc(100%-2rem))] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-3xl border border-line bg-paper p-3 shadow-xl">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          {icon}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-plum">{label}</p>
        <div className="flex shrink-0 items-center gap-2">
          {call.phase === "incoming" ? (
            <>
              <button
                type="button"
                onClick={() => void acceptCall().catch(() => undefined)}
                aria-label={t("messages.call.accept")}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700"
              >
                <Phone size={18} />
              </button>
              <button
                type="button"
                onClick={declineCall}
                aria-label={t("messages.call.decline")}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-dark"
              >
                <PhoneOff size={18} />
              </button>
            </>
          ) : (
            controls
          )}
        </div>
      </div>
      {!call.video ? <audio ref={audioRef} autoPlay /> : null}
    </div>
  );
}
