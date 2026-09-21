import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

const EMOJIS = ["❤️", "💛", "👍", "😊", "😂", "😮", "😢", "🔥", "✨", "👏"];

export function EmojiInsert({
  value,
  max,
  onChange,
}: {
  value: string;
  max: number;
  onChange: (next: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const hide = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", hide);
    return () => document.removeEventListener("mousedown", hide);
  }, [open]);

  function pick(mark: string) {
    const next = (value + mark).slice(0, max);
    onChange(next);
    setOpen(false);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="rounded-full p-1.5 text-muted hover:bg-cream hover:text-plum"
        aria-label={t("live.emoji")}
        onClick={() => setOpen((on) => !on)}
      >
        <Smile size={16} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 rounded-2xl border border-line bg-paper p-1 shadow-sm">
          {EMOJIS.map((mark) => (
            <button
              key={mark}
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-base hover:bg-cream"
              onClick={() => pick(mark)}
            >
              {mark}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
