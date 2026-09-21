import { Card } from "@/components/ui/Card";
import { useI18n } from "@/i18n/I18nProvider";

export function MessagesPage() {
  const { t } = useI18n();

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <h1 className="font-display text-2xl">{t("messages.title")}</h1>
      </header>
      <div className="p-4">
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">{t("messages.step")}</p>
          <p className="mt-2 font-display text-xl">{t("messages.heading")}</p>
          <p className="mt-2 text-sm leading-6 text-muted">{t("messages.body")}</p>
        </Card>
      </div>
    </section>
  );
}
