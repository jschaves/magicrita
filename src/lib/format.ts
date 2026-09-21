import type { Translate } from "@/i18n/I18nProvider";

export function timeAgo(ts: number, t: Translate, locale: string): string {
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 15) return t("time.now");
  if (delta < 60) return t("time.seconds", { n: delta });
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return t("time.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("time.days", { n: days });
  return new Date(ts).toLocaleDateString(locale, { day: "numeric", month: "short" });
}
