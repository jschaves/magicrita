import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { SiteMark } from "@/components/ui/SiteMark";
import { acceptTerms } from "@/lib/protocol/terms";

/**
 * Puerta de condiciones de uso. Cubre todo hasta que el usuario acepta, de modo
 * que no puede crear identidad ni publicar contenido sin haber aceptado (lo que
 * pide la politica de contenido generado por el usuario de Google Play). El
 * boton solo se activa al marcar la casilla, asi que no se puede omitir.
 */
export function TermsGate({ onAccept }: { onAccept: () => void }) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-12">
        <LanguageSwitch className="mb-8" />
        <SiteMark size="lg" />
        <h1 className="mt-6 font-display text-3xl text-plum">{t("terms.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("terms.intro")}</p>

        <Card className="mt-6">
          <p className="font-display text-lg text-plum">{t("terms.rulesTitle")}</p>
          <p className="welcome-pitch mt-2 max-h-56 overflow-y-auto pr-2 text-sm leading-6 text-muted">
            {t("terms.rulesBody")}
          </p>
        </Card>

        <p className="mt-4 text-sm leading-6 text-muted">{t("legal.termsBody")}</p>

        <label className="mt-6 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>{t("terms.checkbox")}</span>
        </label>

        <Button
          className="mt-6 w-full"
          disabled={!checked}
          onClick={() => {
            acceptTerms();
            onAccept();
          }}
        >
          {t("terms.accept")}
        </Button>
      </div>
    </div>
  );
}
