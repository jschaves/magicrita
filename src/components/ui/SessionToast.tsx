import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";

export function SessionToast() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const show = () => {
      setOpen(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOpen(false), 6000);
    };
    window.addEventListener("magicrita-session-exists", show);
    return () => {
      window.removeEventListener("magicrita-session-exists", show);
      window.clearTimeout(timer);
    };
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-ink/20 pt-20"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative mx-4 max-w-sm rounded-2xl bg-ink px-4 py-3 pr-10 text-sm leading-5 text-cream shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-2 top-1 text-lg leading-none text-cream/80 hover:text-white"
          aria-label="×"
          onClick={() => setOpen(false)}
        >
          ×
        </button>
        {t("errors.session_exists")}
      </div>
    </div>
  );
}
