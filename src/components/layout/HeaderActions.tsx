import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { NoticeBell } from "@/components/ui/NoticeBell";

/**
 * Acciones de la cabecera: campana de avisos y acceso a mensajes con el numero
 * de conversaciones pendientes. Va arriba a la derecha, en naranja y mas grande
 * que los iconos de la navegacion para que se vea de un vistazo.
 */
export function HeaderActions() {
  const { notices } = useRita();
  const { t } = useI18n();
  const count = (notices ?? []).filter((item) => item.kind !== "invite").length;

  return (
    <div className="flex items-center gap-1">
      <Link
        to="/messages"
        aria-label={t("nav.messages")}
        className="relative rounded-full p-2 text-orange-500 transition hover:bg-orange-500/10"
      >
        <MessageCircle size={26} strokeWidth={2.1} />
        {count ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-orange-500 px-1.5 text-center text-xs font-bold leading-5 text-white shadow-sm">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Link>
      <NoticeBell />
    </div>
  );
}
