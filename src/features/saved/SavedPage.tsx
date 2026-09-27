import { useMemo } from "react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { LiveFeed } from "@/features/feed/LiveFeed";

export function SavedPage() {
  const { feed, saves } = useRita();
  const { t } = useI18n();
  const items = useMemo(
    () => feed.filter((item) => item.event.type === "post" && item.event.sig && saves.includes(item.event.sig)),
    [feed, saves],
  );

  return (
    <LiveFeed
      items={items}
      title={t("live.savedTitle")}
      subtitle={t("info.saved")}
      emptyTitle={t("live.savedTitle")}
      emptyBody={t("live.savedEmpty")}
    />
  );
}
