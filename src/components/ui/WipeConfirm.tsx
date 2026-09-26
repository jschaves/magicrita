import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "./Button";

export function WipeConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alertdialog"
      aria-labelledby="wipe-title"
      aria-describedby="wipe-body"
      className="rounded-2xl border-2 border-accent bg-accent/10 px-4 py-4"
    >
      <p id="wipe-title" className="font-display text-lg font-bold text-accent">
        {t("settings.deleteWarnTitle")}
      </p>
      <p id="wipe-body" className="mt-2 text-sm leading-6 text-ink">
        {t("settings.deleteWarnBody")}
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={onConfirm}
        >
          {t("settings.deleteConfirm")}
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={onCancel}>
          {t("settings.deleteCancel")}
        </Button>
      </div>
    </div>
  );
}
