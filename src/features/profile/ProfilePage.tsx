import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Avatar } from "@/components/note/Avatar";
import { Button } from "@/components/ui/Button";
import { useRita } from "@/context/RitaProvider";
import { LiveFeed } from "@/features/feed/LiveFeed";
import { useI18n } from "@/i18n/I18nProvider";
import { shortenId } from "@/lib/protocol/identity";

export function ProfilePage() {
  const { rpub: raw } = useParams();
  const rpub = raw ? decodeURIComponent(raw) : undefined;
  const {
    identity,
    profile,
    follows,
    follow,
    unfollow,
    block,
    unblock,
    blocks,
    profileOf,
    personByRpub,
    askPeerData,
    feed,
  } = useRita();
  const { t } = useI18n();
  const isMe = Boolean(identity && rpub && identity.rpub === rpub);
  const person = rpub ? personByRpub(rpub) : undefined;
  const otherProfile = rpub && !isMe ? profileOf(rpub) : null;
  const name = isMe ? profile?.name : otherProfile?.name || person?.profile?.name;
  const picture = isMe ? profile?.picture : otherProfile?.picture || person?.profile?.picture;
  const about = isMe ? profile?.about : otherProfile?.about || person?.profile?.about;
  const interests = isMe
    ? profile?.interests
    : otherProfile?.interests?.length
      ? otherProfile.interests
      : person?.profile?.interests;
  const following = Boolean(rpub && follows.includes(rpub));
  const blocked = Boolean(rpub && blocks.includes(rpub));
  const items = useMemo(
    () => feed.filter((item) => item.event.author === rpub),
    [feed, rpub],
  );

  useEffect(() => {
    if (rpub && !isMe) askPeerData(rpub);
  }, [askPeerData, isMe, rpub]);

  return (
    <LiveFeed
      items={items}
      title={name || t("common.unnamed")}
      subtitle={t("home.subtitle")}
      emptyTitle={isMe ? t("home.emptyTitle") : t("profile.emptyOther")}
      emptyBody={isMe ? t("home.emptyBody") : t("profile.emptyOtherBody")}
      banner={
        <div className="border-b border-line px-4 py-5">
          <Avatar name={name} picture={picture} src={!isMe ? person?.avatarUrl : undefined} size="lg" />
          <p className="mt-2 break-all text-sm text-muted">{rpub}</p>
          {about ? <p className="mt-3 text-sm leading-6">{about}</p> : null}
          {interests?.length ? <p className="mt-2 text-sm text-plum">{interests.join(" · ")}</p> : null}
          <p className="mt-2 text-xs text-muted">{shortenId(rpub ?? "")}</p>
          {!isMe && rpub ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant={following ? "secondary" : "primary"}
                onClick={() => (following ? unfollow(rpub) : follow(rpub))}
              >
                {following ? t("people.unfollow") : t("people.follow")}
              </Button>
              <Button variant="ghost" onClick={() => (blocked ? unblock(rpub) : block(rpub))}>
                {blocked ? t("live.unblock") : t("live.block")}
              </Button>
            </div>
          ) : null}
          {isMe ? (
            <div className="mt-4 space-y-2 rounded-2xl border border-line bg-paper px-3 py-3 text-xs leading-5 text-muted">
              <p>{t("profile.editNote")}</p>
              <p>{t("profile.capNote")}</p>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
