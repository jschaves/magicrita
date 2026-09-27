import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { NoteCard } from "@/components/note/NoteCard";
import { InfoButton } from "@/components/ui/InfoButton";
import { useRita, type FeedItem } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { FEED_VISIBLE } from "@/lib/protocol/social";

export function LiveFeed({
  items,
  title,
  subtitle,
  emptyTitle,
  emptyBody,
  emptyAction,
  banner,
}: {
  items: FeedItem[];
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyBody: string;
  emptyAction?: ReactNode;
  banner?: ReactNode;
}) {
  const { signalOn, people, identity } = useRita();
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<FeedItem[]>([]);
  const [shown, setShown] = useState(FEED_VISIBLE);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(items.length);
  const source = paused ? frozen : items;
  const list = source.slice(0, shown);
  const hasMore = shown < source.length;
  const others = people.filter((person) => person.online && person.rpub !== identity?.rpub).length;

  useEffect(() => {
    if (paused) return;
    const delta = items.length - prevLen.current;
    prevLen.current = items.length;
    if (delta > 0) setShown((n) => n + delta);
  }, [items.length, paused]);

  useEffect(() => {
    const root = scrollerRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown((n) => n + FEED_VISIBLE);
        }
      },
      { root: null, rootMargin: "400px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [hasMore, list.length]);

  return (
    <section className="flex min-h-0 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl">{title}</h1>
            <InfoButton title={title} body={subtitle} />
          </div>
          {paused ? <p className="text-sm text-muted">{t("live.pausedHint")}</p> : null}
          <p className="mt-1 text-xs text-muted">
            {signalOn ? t("people.signalOn") : t("people.signalOff")}
            {signalOn ? ` · ${others}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (paused) {
              setPaused(false);
            } else {
              setFrozen(items);
              setPaused(true);
            }
          }}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-2 text-sm font-semibold"
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
          {paused ? t("live.resume") : t("live.pause")}
        </button>
      </header>
      <div ref={scrollerRef} className="overflow-x-clip">
        {banner}
        {source.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-display text-2xl">{emptyTitle}</p>
            <p className="mt-2 text-sm text-muted">{emptyBody}</p>
            {emptyAction}
          </div>
        ) : (
          <>
            {list.map((item) => (
              <NoteCard
                key={item.event.sig}
                event={item.event}
                name={item.profile?.name}
                picture={item.profile?.picture}
                src={item.avatarUrl}
              />
            ))}
            {hasMore ? <div ref={sentinelRef} className="h-8" /> : null}
          </>
        )}
      </div>
    </section>
  );
}
