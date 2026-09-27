import { useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * Boton "+ Info" que abre un popup con la informacion de la pantalla.
 *
 * El popup se monta en `document.body` con un portal: si se dejara dentro de la
 * cabecera (que lleva `backdrop-blur`), ese filtro crea un "containing block" y
 * el `fixed inset-0` se posicionaria respecto a la cabecera en vez de a toda la
 * pantalla.
 */
export function InfoButton({
  title,
  body,
  className = "",
}: {
  title: string;
  body: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("common.info")}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted transition hover:text-plum ${className}`}
      >
        <Info size={16} /> {t("common.info")}
      </button>
      {open
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 px-4"
              onClick={() => setOpen(false)}
            >
              <div
                className="w-full max-w-md rounded-3xl border border-line bg-paper p-5 shadow-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-xl text-plum">{title}</h2>
                  <button
                    type="button"
                    className="shrink-0 rounded-full p-1 text-muted hover:text-accent"
                    aria-label={t("common.close")}
                    onClick={() => setOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{body}</p>
                <Button type="button" className="mt-4 w-full" onClick={() => setOpen(false)}>
                  {t("common.close")}
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
