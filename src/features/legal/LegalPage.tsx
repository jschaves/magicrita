import { Link } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { SiteMark } from "@/components/ui/SiteMark";

const CONTACT = "beta@magicrita.com";

export function LegalPage() {
  const { status } = useRita();
  const { t } = useI18n();
  const home = status === "ready" ? "/" : "/welcome";

  const blocks = [
    { title: t("legal.betaTitle"), body: t("legal.betaBody") },
    { title: t("legal.philosophyTitle"), body: t("legal.philosophyBody") },
    { title: t("legal.dataTitle"), body: t("legal.dataBody") },
    { title: t("legal.termsTitle"), body: t("legal.termsBody") },
    { title: t("legal.contactTitle"), body: t("legal.contactBody") },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-12">
      <LanguageSwitch className="mb-8" />
      <SiteMark size="lg" />
      <h1 className="mt-6 font-display text-3xl text-plum">{t("legal.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("legal.lead")}</p>
      {blocks.map((block) => (
        <div key={block.title} className="mt-4 rounded-3xl border border-line bg-paper/80 p-4">
          <p className="font-display text-lg text-plum">{block.title}</p>
          <div className="welcome-pitch mt-2 max-h-40 overflow-y-auto pr-2 text-sm leading-6 text-muted">
            {block.body}
          </div>
        </div>
      ))}
      <a
        href={`mailto:${CONTACT}`}
        className="mt-4 text-sm font-semibold text-accent hover:underline"
      >
        {CONTACT}
      </a>
      <Link to={home} className="mt-8 text-sm text-muted hover:text-ink">
        {t("common.back")}
      </Link>
    </div>
  );
}
