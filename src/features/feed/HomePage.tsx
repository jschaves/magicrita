import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { filterPostsByTag, normalizeTag } from "@/lib/protocol/hashtags";
import { HashtagBanner } from "./HashtagBanner";
import { LiveFeed } from "./LiveFeed";

export function HomePage() {
  const { feed, comments } = useRita();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tag = normalizeTag(params.get("tag") ?? "");
  const items = useMemo(() => filterPostsByTag(feed, tag, comments), [feed, comments, tag]);

  return (
    <LiveFeed
      items={items}
      title={t("home.title")}
      subtitle={t("info.home")}
      emptyTitle={t("home.emptyTitle")}
      emptyBody={tag ? t("live.tagEmpty") : t("home.emptyBody")}
      emptyAction={
        tag ? undefined : (
          <Link
            to="/compose"
            className="mt-6 inline-flex rounded-full bg-accent px-4 py-2 text-sm font-bold text-white"
          >
            {t("home.firstNote")}
          </Link>
        )
      }
      banner={
        <HashtagBanner
          tag={tag}
          onClear={() => {
            const next = new URLSearchParams(params);
            next.delete("tag");
            setParams(next);
          }}
        />
      }
    />
  );
}
