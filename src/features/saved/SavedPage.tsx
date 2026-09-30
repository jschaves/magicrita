import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { filterPostsByTag, normalizeTag } from "@/lib/protocol/hashtags";
import { HashtagBanner } from "@/features/feed/HashtagBanner";
import { LiveFeed } from "@/features/feed/LiveFeed";

export function SavedPage() {
  const { feed, saves, comments } = useRita();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tag = normalizeTag(params.get("tag") ?? "");
  const items = useMemo(
    () =>
      filterPostsByTag(
        feed.filter((item) => item.event.type === "post" && item.event.sig && saves.includes(item.event.sig)),
        tag,
        comments,
      ),
    [feed, saves, comments, tag],
  );

  return (
    <LiveFeed
      items={items}
      title={t("live.savedTitle")}
      subtitle={t("info.saved")}
      emptyTitle={t("live.savedTitle")}
      emptyBody={tag ? t("live.tagEmpty") : t("live.savedEmpty")}
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
