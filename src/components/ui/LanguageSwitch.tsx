import { useI18n } from "@/i18n/I18nProvider";

export function LanguageSwitch({
  className = "",
  showLabel = true,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { locale, locales, setLocale, t } = useI18n();

  return (
    <div className={className}>
      {showLabel ? <p className="mb-2 text-sm font-semibold">{t("common.language")}</p> : null}
      <div role="group" aria-label={t("common.language")} className="flex flex-wrap gap-2">
        {locales.map((item) => {
          const active = item.code === locale;
          return (
            <button
              key={item.code}
              type="button"
              onClick={() => setLocale(item.code)}
              aria-pressed={active}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-accent text-white"
                  : "border border-line bg-paper text-ink hover:border-accent/40"
              }`}
            >
              {item.native}
            </button>
          );
        })}
      </div>
    </div>
  );
}
