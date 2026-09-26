import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n, type MessageKey } from "@/i18n/I18nProvider";
import { timeAgo } from "@/lib/format";
import type { NoticeKind } from "@/lib/protocol/notices";

const KIND_KEY: Record<NoticeKind, MessageKey> = {
  chat: "notices.chat",
  request: "notices.request",
  invite: "notices.invite",
};

function hrefOf(kind: NoticeKind, from: string): string {
  if (kind === "invite") return "/people";
  return `/messages/${encodeURIComponent(from)}`;
}

export function NoticeBell() {
  const { notices, dismissNotice, profileOf, personByRpub } = useRita();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") void Notification.requestPermission();
  }, []);

  const inbox = notices ?? [];
  const count = inbox.length;
  const [toast, setToast] = useState<(typeof inbox)[0] | null>(null);
  const seenId = useRef<string | null>(null);
  const skipFirst = useRef(true);

  useEffect(() => {
    const newest = inbox[0];
    if (skipFirst.current) {
      skipFirst.current = false;
      seenId.current = newest?.id ?? null;
      return;
    }
    if (newest && newest.id !== seenId.current) {
      seenId.current = newest.id;
      setToast(newest);
      const timer = window.setTimeout(() => setToast(null), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [inbox]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="relative rounded-full p-2 text-orange-500 transition hover:bg-orange-500/10"
        aria-label={t("notices.title")}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={26} strokeWidth={2.1} />
        {count ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-orange-500 px-1.5 text-center text-xs font-bold leading-5 text-white shadow-sm">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-line bg-paper p-2 shadow-lg">
          <p className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-muted">{t("notices.title")}</p>
          {inbox.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">{t("notices.empty")}</p>
          ) : (
            <ul>
              {inbox.map((item) => {
                const name =
                  profileOf(item.from)?.name || personByRpub(item.from)?.profile?.name || t("common.unnamed");
                return (
                  <li key={item.id}>
                    <Link
                      to={hrefOf(item.kind, item.from)}
                      className="block rounded-xl px-2 py-2 hover:bg-cream"
                      onClick={() => {
                        dismissNotice(item.id);
                        setOpen(false);
                      }}
                    >
                      <p className="text-sm font-semibold text-ink">{t(KIND_KEY[item.kind])}</p>
                      <p className="truncate text-xs text-muted">
                        {name} · {timeAgo(item.ts, t, locale)}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
      {toast ? (
        <Link
          to={hrefOf(toast.kind, toast.from)}
          className="fixed left-1/2 top-4 z-40 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-line bg-ink px-4 py-3 text-sm text-cream shadow-lg"
          onClick={() => {
            dismissNotice(toast.id);
            setToast(null);
          }}
        >
          <p className="font-semibold">{t(KIND_KEY[toast.kind])}</p>
        </Link>
      ) : null}
    </div>
  );
}
