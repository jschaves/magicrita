import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type BrowserVerifyState = "working" | "done" | "failed";

/**
 * Indicador compartido de la verificacion del navegador. Lo usan el login de
 * admin y el desbloqueo de la identidad para que se vea igual en los dos sitios.
 */
export function BrowserVerify({ state }: { state: BrowserVerifyState }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 text-xs" aria-live="polite">
      {state === "done" ? (
        <>
          <ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="text-ink/60">{t("verify.done")}</span>
        </>
      ) : state === "failed" ? (
        <>
          <ShieldAlert className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="text-accent">{t("verify.failed")}</span>
        </>
      ) : (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink/40" aria-hidden />
          <span className="text-ink/50">{t("verify.working")}</span>
        </>
      )}
    </div>
  );
}
