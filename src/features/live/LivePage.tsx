import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import { Avatar } from "@/components/note/Avatar";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { toolsText, type ToolsKey } from "@/i18n/tools";
import {
  getLiveSnapshot,
  joinLive,
  leaveLive,
  requestLives,
  startBroadcast,
  stopBroadcast,
  subscribeLive,
  type LiveSnapshot,
} from "@/lib/protocol/live";
import { shortenId } from "@/lib/protocol/identity";

const PAGE = 5;
const EMPTY: LiveSnapshot = { lives: [], session: null };

export function LivePage() {
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot, () => EMPTY);
  const { follows, profileOf, identity } = useRita();
  const { t, locale } = useI18n();
  const tt = (key: ToolsKey, vars?: Record<string, string | number>) => toolsText(locale, key, vars);
  const [title, setTitle] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    requestLives();
  }, []);

  const session = live.session;
  useEffect(() => {
    if (localRef.current && session?.role === "broadcast") localRef.current.srcObject = session.local;
    if (remoteRef.current && session?.role === "viewing") remoteRef.current.srcObject = session.remote;
  }, [session]);

  const ordered = useMemo(() => {
    return [...live.lives]
      .filter((item) => item.host !== identity?.rpub)
      .sort((a, b) => {
        const fa = follows.includes(a.host) ? 0 : 1;
        const fb = follows.includes(b.host) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return a.startedAt - b.startedAt;
      });
  }, [live.lives, follows, identity]);

  const pages = Math.max(1, Math.ceil(ordered.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const visible = ordered.slice(safePage * PAGE, safePage * PAGE + PAGE);

  async function onStart() {
    setError(null);
    try {
      await startBroadcast(title);
    } catch {
      setError(tt("liveError"));
    }
  }

  if (session?.role === "broadcast") {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col bg-ink/95">
        <video ref={localRef} autoPlay playsInline muted className="min-h-0 flex-1 bg-black object-contain" />
        <div className="flex shrink-0 items-center justify-between gap-3 bg-ink/80 px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-bold text-white">
              <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">
                <Radio size={12} /> {tt("liveOn")}
              </span>
              <span className="truncate">{session.title}</span>
            </p>
            <p className="mt-1 text-xs text-cream/70">{tt("liveViewers", { n: session.viewers })}</p>
          </div>
          <Button type="button" variant="danger" onClick={() => stopBroadcast()}>
            {tt("liveStop")}
          </Button>
        </div>
      </div>
    );
  }

  if (session?.role === "viewing") {
    const name = profileOf(session.host)?.name || shortenId(session.host);
    return (
      <div className="fixed inset-0 z-[80] flex flex-col bg-ink/95">
        <video ref={remoteRef} autoPlay playsInline className="min-h-0 flex-1 bg-black object-contain" />
        <div className="flex shrink-0 items-center justify-between gap-3 bg-ink/80 px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-cream">
            {tt("liveWatching", { name })}
          </p>
          <Button type="button" variant="danger" onClick={() => leaveLive()}>
            {tt("liveLeave")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <Radio className="text-accent" />
          <h1 className="font-display text-2xl">{tt("live")}</h1>
        </div>
        <p className="mt-1 text-xs text-muted">{tt("liveHint")}</p>
      </header>
      <div className="space-y-4 p-4">
        <div className="rounded-3xl border border-line bg-paper p-4">
          <p className="font-display text-lg">{tt("liveCreate")}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <TextField
              label={tt("liveTitle")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={tt("liveTitlePlaceholder")}
              maxLength={80}
              className="min-w-52 flex-1"
            />
            <Button type="button" onClick={() => void onStart()} disabled={!identity}>
              {tt("liveStart")}
            </Button>
          </div>
          {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
        </div>

        <div>
          {ordered.length === 0 ? (
            <p className="text-sm text-muted">{tt("liveEmpty")}</p>
          ) : (
            <>
              <ul className="divide-y divide-line rounded-3xl border border-line bg-paper">
                {visible.map((item) => {
                  const followed = follows.includes(item.host);
                  const name = profileOf(item.host)?.name || shortenId(item.host);
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <Avatar name={name} picture={profileOf(item.host)?.picture} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate font-semibold">
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">
                            <Radio size={12} /> {tt("liveOn")}
                          </span>
                          {item.title}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {name}
                          {followed ? ` · ${tt("liveFollowing")}` : ""}
                        </p>
                      </div>
                      <Button type="button" variant="secondary" onClick={() => void joinLive(item.id).catch(() => undefined)}>
                        {tt("liveWatch")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {pages > 1 ? (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Button type="button" variant="secondary" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)}>
                    {tt("livePrev")}
                  </Button>
                  <p className="text-xs text-muted">{tt("livePageStatus", { page: safePage + 1, pages })}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={safePage >= pages - 1}
                    onClick={() => setPage(safePage + 1)}
                  >
                    {tt("liveNext")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <p>
          <Link to="/" className="text-sm text-muted hover:text-ink">
            {t("common.back")}
          </Link>
        </p>
      </div>
    </section>
  );
}
