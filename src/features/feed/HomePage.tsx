import { Link } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { LiveFeed } from "./LiveFeed";

export function HomePage() {
  const { feed } = useRita();
  const { t } = useI18n();

  return (
    <LiveFeed
      items={feed}
      title={t("home.title")}
      subtitle={t("info.home")}
      emptyTitle={t("home.emptyTitle")}
      emptyBody={t("home.emptyBody")}
      emptyAction={
        <Link
          to="/compose"
          className="mt-6 inline-flex rounded-full bg-accent px-4 py-2 text-sm font-bold text-white"
        >
          {t("home.firstNote")}
        </Link>
      }
    />
  );
}
