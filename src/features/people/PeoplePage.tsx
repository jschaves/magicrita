import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Avatar } from "@/components/note/Avatar";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { shortenId } from "@/lib/protocol/identity";

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
            {filtered.some((person) => person.online) ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-accent">{t("people.connectedNow")}</p>
                <ul className="divide-y divide-line rounded-3xl border border-line bg-paper">
                  {filtered.filter((person) => person.online).map(personRow)}
                </ul>
              </>
            ) : null}
            {filtered.some((person) => !person.online) ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">{t("people.notConnected")}</p>
                <ul className="divide-y divide-line rounded-3xl border border-line bg-paper">
                  {filtered.filter((person) => !person.online).map(personRow)}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
