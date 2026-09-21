import { Card } from "@/components/ui/Card";
import { useI18n, type MessageKey } from "@/i18n/I18nProvider";

const DONE = new Set([1, 2, 3, 4, 5]);

const steps: { n: number; title: MessageKey; body: MessageKey }[] = [
  { n: 1, title: "protocol.s1Title", body: "protocol.s1Body" },
  { n: 2, title: "protocol.s2Title", body: "protocol.s2Body" },
  { n: 3, title: "protocol.s3Title", body: "protocol.s3Body" },
  { n: 4, title: "protocol.s4Title", body: "protocol.s4Body" },
  { n: 5, title: "protocol.s5Title", body: "protocol.s5Body" },
];

export function ProtocolPage() {
  const { t } = useI18n();

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <h1 className="font-display text-2xl">{t("protocol.title")}</h1>
        <p className="text-sm text-muted">{t("protocol.subtitle")}</p>
      </header>
      <div className="space-y-4 p-4">
        {steps.map((step) => (
          <Card key={step.n} className={DONE.has(step.n) ? "border-line" : ""}>
            <p
              className={`text-xs font-bold uppercase tracking-wide ${
                DONE.has(step.n) ? "text-gold" : "text-accent"
              }`}
            >
              {DONE.has(step.n)
                ? `${t("protocol.done")} · ${t("protocol.step", { n: step.n })}`
                : t("protocol.step", { n: step.n })}
            </p>
            <h2 className="mt-1 font-display text-xl">{t(step.title)}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{t(step.body)}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
