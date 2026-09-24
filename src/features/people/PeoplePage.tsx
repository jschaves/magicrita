import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Avatar } from "@/components/note/Avatar";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { shortenId } from "@/lib/protocol/identity";
import type { Person } from "@/context/RitaProvider";

const PAGE_SIZE = 5;

function followedFirst(list: Person[], follows: string[]): Person[] {
  const followed: Person[] = [];
  const rest: Person[] = [];
  for (const person of list) {
    if (follows.includes(person.rpub)) followed.push(person);
    else rest.push(person);
  }
  return [...followed, ...rest];
}

export function PeoplePage() {
  const {
    people,
    follows,
    follow,
    invitePeer,
    invited,
    unfollow,
    block,
    unblock,
    blocks,
    identity,
    signalOn,
    dismissNoticesFor,
  } = useRita();
  const navigate = useNavigate();
  const { t, errorMessage } = useI18n();

  useEffect(() => {
    dismissNoticesFor({ kind: "invite" });
  }, [dismissNoticesFor]);
  const [rpub, setRpub] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [onlinePage, setOnlinePage] = useState(0);
  const [offlinePage, setOfflinePage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((person) => {
      if (!q) return true;
      const name = person.profile?.name?.toLowerCase() ?? "";
      const about = person.profile?.about?.toLowerCase() ?? "";
      const interests = (person.profile?.interests ?? []).join(" ").toLowerCase();
      return (
        name.includes(q) ||
        about.includes(q) ||
        interests.includes(q) ||
        person.rpub.toLowerCase().includes(q)
      );
    });
  }, [people, query]);

  const online = useMemo(
    () => followedFirst(filtered.filter((person) => person.online), follows),
    [filtered, follows],
  );
  const offline = useMemo(
    () => followedFirst(filtered.filter((person) => !person.online), follows),
    [filtered, follows],
  );
  const onlinePages = Math.max(1, Math.ceil(online.length / PAGE_SIZE));
  const offlinePages = Math.max(1, Math.ceil(offline.length / PAGE_SIZE));
  const onlineSafe = Math.min(onlinePage, onlinePages - 1);
  const offlineSafe = Math.min(offlinePage, offlinePages - 1);

  useEffect(() => {
    setOnlinePage(0);
    setOfflinePage(0);
  }, [query]);

  function personRow(person: (typeof people)[number]) {
    const following = follows.includes(person.rpub);
    const alreadyInvited = invited.includes(person.rpub);
    const blocked = blocks.includes(person.rpub);
    const isMe = person.rpub === identity?.rpub;
    return (
      <li key={person.rpub} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Link to={`/p/${person.rpub}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar
            name={person.profile?.name}
            picture={person.profile?.picture}
            src={person.avatarUrl || undefined}
          />
          <div className="min-w-0">
            <p className="font-semibold">
              {person.profile?.name || t("common.unnamed")}
              <span
                className={`ml-2 inline-block h-2 w-2 rounded-full ${
                  person.online ? "bg-emerald-500" : "bg-line"
                }`}
              />
              {alreadyInvited ? (
                <span className="ml-2 rounded-full bg-plum/10 px-2 py-0.5 text-[11px] font-semibold text-plum">
                  {t("people.alreadyInvited")}
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted">
              {person.online ? t("live.online") : t("live.offline")} · {shortenId(person.rpub)}
            </p>
            {person.profile?.interests?.length ? (
              <p className="truncate text-xs text-plum">{person.profile.interests.join(" · ")}</p>
            ) : null}
          </div>
        </Link>
        {isMe ? (
          <span className="text-xs text-muted">{t("live.you")}</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(`/messages/${encodeURIComponent(person.rpub)}`)}
            >
              {t("messages.title")}
            </Button>
            <Button
              type="button"
              variant={following ? "secondary" : "primary"}
              onClick={() => (following ? unfollow(person.rpub) : follow(person.rpub))}
            >
              {following ? t("people.unfollow") : t("people.follow")}
            </Button>
            <Button
              type="button"
              variant={alreadyInvited ? "secondary" : "ghost"}
              onClick={() => {
                try {
                  invitePeer(person.rpub);
                  setMessage(t("people.invited"));
                } catch (err) {
                  setError(errorMessage(err, "people.inviteFailed"));
                }
              }}
            >
              {alreadyInvited ? t("people.alreadyInvited") : t("people.invite")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                try {
                  blocked ? unblock(person.rpub) : block(person.rpub);
                } catch (err) {
                  setError(errorMessage(err, "live.blockFailed"));
                }
              }}
            >
              {blocked ? t("live.unblock") : t("live.block")}
            </Button>
          </div>
        )}
      </li>
    );
  }

  function onFollow(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      follow(rpub);
      setRpub("");
      setMessage(t("people.followed"));
    } catch (err) {
      setError(errorMessage(err, "people.followFailed"));
    }
  }

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <h1 className="font-display text-2xl">{t("people.title")}</h1>
        <p className="text-sm text-muted">{t("people.subtitle")}</p>
        <p className="mt-1 text-xs text-muted">{t("people.quarantineHint")}</p>
        <p className={`mt-1 text-xs font-semibold ${signalOn ? "text-emerald-700" : "text-accent"}`}>
          {signalOn ? t("people.signalOn") : t("people.signalOff")}
        </p>
      </header>
      <div className="space-y-6 p-4">
        <TextField
          label={t("live.filter")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("live.filterHint")}
        />

        <form className="space-y-3 rounded-3xl border border-line bg-paper p-4" onSubmit={onFollow}>
          <p className="font-display text-lg">{t("people.byRpub")}</p>
          <TextField
            label={t("people.pasteRpub")}
            value={rpub}
            onChange={(e) => setRpub(e.target.value)}
            placeholder="rpub_"
          />
          <Button type="submit">{t("people.follow")}</Button>
        </form>

        {error ? <p className="text-sm text-accent">{error}</p> : null}
        {message ? <p className="text-sm text-plum">{message}</p> : null}

        {filtered.length === 0 ? (
          <p className="text-sm text-muted">{t("live.noConnected")}</p>
        ) : (
          <>
            {online.length ? (
              <PeopleSlice
                label={t("people.connectedNow")}
                labelClass="text-accent"
                people={online.slice(onlineSafe * PAGE_SIZE, onlineSafe * PAGE_SIZE + PAGE_SIZE)}
                page={onlineSafe}
                pages={onlinePages}
                onPage={setOnlinePage}
                render={personRow}
              />
            ) : null}
            {offline.length ? (
              <PeopleSlice
                label={t("people.notConnected")}
                labelClass="text-muted"
                people={offline.slice(offlineSafe * PAGE_SIZE, offlineSafe * PAGE_SIZE + PAGE_SIZE)}
                page={offlineSafe}
                pages={offlinePages}
                onPage={setOfflinePage}
                render={personRow}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function PeopleSlice({
  label,
  labelClass,
  people,
  page,
  pages,
  onPage,
  render,
}: {
  label: string;
  labelClass: string;
  people: Person[];
  page: number;
  pages: number;
  onPage: (page: number) => void;
  render: (person: Person) => ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <p className={`text-xs font-bold uppercase tracking-wide ${labelClass}`}>{label}</p>
      <ul className="divide-y divide-line rounded-3xl border border-line bg-paper">{people.map(render)}</ul>
      {pages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="secondary" disabled={page <= 0} onClick={() => onPage(page - 1)}>
            {t("people.pagePrev")}
          </Button>
          <p className="text-xs text-muted">{t("people.pageStatus", { page: page + 1, pages })}</p>
          <Button type="button" variant="secondary" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
            {t("people.pageNext")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
