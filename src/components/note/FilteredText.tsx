import { splitFlagged } from "@/lib/protocol/moderation";
import { stripBlobText } from "@/lib/protocol/media";
import { useI18n } from "@/i18n/I18nProvider";

export function FilteredText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const { t } = useI18n();
  const parts = splitFlagged(stripBlobText(text));
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.flagged ? (
          <span
            key={index}
            className="cursor-help underline decoration-accent decoration-2 underline-offset-2"
            title={t("live.inappropriate")}
          >
            xxxx
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
