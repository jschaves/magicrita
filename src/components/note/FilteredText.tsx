import { Link, useLocation } from "react-router-dom";
import { splitFlagged } from "@/lib/protocol/moderation";
import { stripBlobText } from "@/lib/protocol/media";
import { tokenizeHashtags } from "@/lib/protocol/hashtags";
import { useI18n } from "@/i18n/I18nProvider";

export function FilteredText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const parts = splitFlagged(stripBlobText(text));
  const base = pathname === "/saved" ? "/saved" : "/";
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
          <span key={index}>
            {tokenizeHashtags(part.text).map((token, tokenIndex) =>
              token.tag ? (
                <Link
                  key={tokenIndex}
                  to={`${base}?tag=${encodeURIComponent(token.tag)}`}
                  className="font-semibold text-accent hover:underline"
                >
                  {token.text}
                </Link>
              ) : (
                <span key={tokenIndex}>{token.text}</span>
              ),
            )}
          </span>
        ),
      )}
    </span>
  );
}
