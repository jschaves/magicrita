import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { drawCaptcha, issueCaptcha } from "@/lib/protocol/captcha";

export function LocalCaptcha({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawCaptcha(canvas, issueCaptcha());
    onChange("");
  }, [tick, onChange]);

  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-ink">{t("create.captcha")}</span>
      <div className="flex flex-wrap items-center gap-3">
        <canvas
          ref={canvasRef}
          width={220}
          height={72}
          className="h-[72px] w-[220px] rounded-2xl border border-line bg-paper"
        />
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm font-semibold text-plum hover:text-accent"
          onClick={() => setTick((n) => n + 1)}
        >
          <RefreshCw size={14} />
          {t("create.captchaRefresh")}
        </button>
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        autoComplete="off"
        spellCheck={false}
        maxLength={5}
        className="mt-3 w-full rounded-2xl border border-line bg-paper px-3.5 py-2.5 tracking-[0.35em] text-ink outline-none ring-accent/30 placeholder:tracking-normal placeholder:text-muted/70 focus:ring-2"
        placeholder="•••••"
        aria-label={t("create.captcha")}
        required
      />
      <p className="mt-1 text-xs text-muted">{t("create.captchaHint")}</p>
    </div>
  );
}
