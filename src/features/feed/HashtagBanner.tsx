import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export function HashtagBanner({ tag, onClear }: { tag: string; onClear: () => void }) {
  const { t } = useI18n();
  if (!tag) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-accent/5 px-4 py-2 text-sm">
      <span className="min-w-0 truncate text-muted">
        {t("live.tagFilter")} <span className="font-semibold text-accent">#{tag}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-xs font-semibold"
      >
        <X size={14} />
        {t("live.clearFilter")}
      </button>
    </div>
  );
}
