import { useSyncExternalStore } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { shortenId } from "@/lib/protocol/identity";
import {
  acceptCall,
  declineCall,
  endCall,
  getCallSnapshot,
  subscribeCall,
  toggleMute,
} from "@/lib/protocol/call";

/**
 * Panel de llamada de voz. Vive en `App` para que la llamada entrante se vea
 * esté donde esté la persona, no solo dentro de Mensajes.
 */
export function CallOverlay() {
  const call = useSyncExternalStore(subscribeCall, getCallSnapshot, () => null);
  const { profileOf } = useRita();
  const { t } = useI18n();
  if (!call) return null;

  const name = profileOf(call.peer)?.name || shortenId(call.peer);
  const label =
    call.phase === "incoming"
      ? t("messages.call.incoming", { name })
      : call.phase === "outgoing"
        ? t("messages.call.calling", { name })
        : t("messages.call.active", { name });

  return (
    <div className="fixed left-1/2 top-4 z-[90] w-[min(22rem,calc(100%-2rem))] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-3xl border border-line bg-paper p-3 shadow-xl">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Phone size={18} />
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
            <>
              {call.phase === "active" ? (
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={call.muted ? t("messages.call.unmute") : t("messages.call.mute")}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                    call.muted
                      ? "border-accent text-accent"
                      : "border-line text-muted hover:text-plum"
                  }`}
                >
                  {call.muted ? <MicOff size={18} /> : <Mic size={18} />}
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
          )}
        </div>
      </div>
    </div>
  );
}
