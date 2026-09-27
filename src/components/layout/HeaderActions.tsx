import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { NoticeBell } from "@/components/ui/NoticeBell";

/**
 * Acciones de la cabecera: acceso al perfil y la campana de avisos. El acceso a
 * mensajes vive en la navegacion (barra lateral / barra inferior), no aqui.
 */
export function HeaderActions() {
  const { identity } = useRita();
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-1">
      {identity ? (
        <Link
          to={`/p/${identity.rpub}`}
          aria-label={t("nav.profile")}
          className="rounded-full p-2 text-orange-500 transition hover:bg-orange-500/10"
        >
          <UserRound size={26} strokeWidth={2.1} />
        </Link>
      ) : null}
      <NoticeBell />
    </div>
  );
}
