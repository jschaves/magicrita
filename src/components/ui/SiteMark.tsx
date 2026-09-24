import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchBrand, logoUrl, onBrandChange, SITE_NAME } from "@/lib/protocol/brand";

type Size = "sm" | "md" | "lg";

const imgClass: Record<Size, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-14 w-14 md:h-16 md:w-16",
};

const nameClass: Record<Size, string> = {
  sm: "font-display text-xl font-semibold tracking-tight text-plum",
  md: "font-display text-3xl font-semibold tracking-tight text-plum",
  lg: "font-display text-5xl text-plum md:text-6xl",
};

const betaClass: Record<Size, string> = {
  sm: "text-[10px] leading-none",
  md: "text-xs leading-none",
  lg: "text-sm leading-none",
};

export function SiteMark({
  size = "md",
  className = "",
  github = false,
}: {
  size?: Size;
  className?: string;
  github?: boolean;
}) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const info = await fetchBrand();
      if (cancelled) return;
      setSrc(info.logo ? logoUrl(info.updated) : null);
    }
    void load();
    const stop = onBrandChange(() => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <span className={`inline-flex min-w-0 flex-col ${className}`}>
      <span className="inline-flex min-w-0 items-center gap-2">
        {src ? (
          <img
            src={src}
            alt=""
            className={`${imgClass[size]} shrink-0 rounded-lg object-contain`}
            onError={() => setSrc(null)}
          />
        ) : null}
        <span className={nameClass[size]}>{SITE_NAME}</span>
      </span>
      <span className="mt-1 inline-flex flex-wrap items-baseline gap-x-3">
        <span className={`font-semibold tracking-wide text-gold ${betaClass[size]}`}>Beta 0.1</span>
        {github ? (
          <a
            href="https://github.com/jschaves/magicrita"
            target="_blank"
            rel="noreferrer"
            className={`font-display text-plum hover:underline ${betaClass[size]}`}
          >
            {t("welcome.github")}
          </a>
        ) : null}
      </span>
    </span>
  );
}
