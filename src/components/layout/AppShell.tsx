import { Link, NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { Bookmark, Compass, Home, LogOut, MessageCircle, PenLine, Settings, UserRound, Users } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Avatar } from "@/components/note/Avatar";
import { NoticeBell } from "@/components/ui/NoticeBell";
import { SiteMark } from "@/components/ui/SiteMark";
import { shortenId } from "@/lib/protocol/identity";

export function AppShell() {
  const { status, vault, identity, profile, logout, notices } = useRita();
  const { t } = useI18n();
  const navigate = useNavigate();

  if (status === "anonymous" && !vault) {
    return <Navigate to="/welcome" replace />;
  }
  if (status === "locked") {
    return <Navigate to="/unlock" replace />;
  }

  const rpub = identity?.rpub ?? "";
  const inbox = notices ?? [];
  const chatBadge = inbox.filter((item) => item.kind !== "invite").length;
  const peopleBadge = inbox.filter((item) => item.kind === "invite").length;
  const links = [
    { to: "/", label: t("nav.home"), icon: Home },
    { to: "/people", label: t("nav.people"), icon: Users },
    { to: "/saved", label: t("nav.saved"), icon: Bookmark },
    { to: "/protocolo", label: t("nav.protocol"), icon: Compass },
    { to: "/messages", label: t("nav.messages"), icon: MessageCircle },
    { to: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  return (
    <div className="relative mx-auto flex h-full max-h-full w-full max-w-6xl flex-col overflow-x-clip md:grid md:h-auto md:min-h-dvh md:max-h-none md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_260px]">
      <div className="fixed right-3 top-3 z-30 md:right-4">
        <NoticeBell />
      </div>
      <aside className="hidden border-r border-line md:flex md:flex-col md:px-4 md:py-6">
        <Link to="/" className="px-3">
          <SiteMark size="md" />
        </Link>
        <nav className="mt-8 flex flex-col gap-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-semibold ${
                  isActive ? "bg-white text-accent" : "text-ink hover:bg-white/60"
                }`
              }
            >
              <span className="relative">
                <Icon size={18} />
                {to === "/messages" && chatBadge ? (
                  <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-ink px-1 text-center text-[10px] font-bold leading-4 text-cream">
                    {chatBadge > 9 ? "9+" : chatBadge}
                  </span>
                ) : null}
                {to === "/people" && peopleBadge ? (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
                ) : null}
              </span>
              {label}
            </NavLink>
          ))}
          {rpub ? (
            <NavLink
              to={`/p/${rpub}`}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-semibold ${
                  isActive ? "bg-white text-accent" : "text-ink hover:bg-white/60"
                }`
              }
            >
              <UserRound size={18} />
              {t("nav.profile")}
            </NavLink>
          ) : null}
        </nav>
        <Link
          to="/compose"
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-accent-dark"
        >
          <PenLine size={16} />
          {t("nav.publish")}
        </Link>
        <div className="mt-3 flex items-center gap-2 px-3 text-xs text-muted">
          <Avatar name={profile?.name} picture={profile?.picture} size="sm" />
          <div className="min-w-0">
            <p className="font-semibold text-ink">{profile?.name || t("common.unnamed")}</p>
            <p className="truncate">{rpub ? shortenId(rpub) : ""}</p>
          </div>
        </div>
        <button
          type="button"
          className="mt-1 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-accent hover:bg-white/60"
          onClick={() => {
            logout();
            navigate("/unlock");
          }}
        >
          <LogOut size={16} />
          {t("settings.logout")}
        </button>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip md:contents">
        <main className="min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto border-r border-line bg-paper/40 md:min-h-dvh">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 pr-14 md:hidden">
            <Link to="/">
              <SiteMark size="sm" />
            </Link>
          </div>
          <Outlet />
        </main>

        <nav className="w-full max-w-full shrink-0 border-t border-line bg-white px-1 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] md:hidden">
          <div className="flex w-full max-w-full items-center justify-around">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                aria-label={label}
                className={({ isActive }) =>
                  `relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    isActive ? "bg-accent/10 text-accent" : "text-muted"
                  }`
                }
              >
                <Icon size={22} strokeWidth={1.75} />
                {to === "/messages" && chatBadge ? (
                  <span className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-ink px-1 text-center text-[9px] font-bold leading-3 text-white">
                    {chatBadge > 9 ? "9+" : chatBadge}
                  </span>
                ) : null}
                {to === "/people" && peopleBadge ? (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                ) : null}
              </NavLink>
            ))}
            <NavLink
              to="/compose"
              aria-label={t("nav.publish")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white"
            >
              <PenLine size={18} strokeWidth={2} />
            </NavLink>
          </div>
        </nav>
      </div>

      <aside className="hidden p-6 lg:block">
        <div className="rounded-3xl border border-line bg-paper p-4">
          <p className="font-display text-lg">{t("shell.philosophyTitle")}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{t("shell.philosophyBody")}</p>
        </div>
        <ol className="mt-6 space-y-2 text-sm text-ink">
          <li>{t("shell.road1")}</li>
          <li>{t("shell.road2")}</li>
          <li>{t("shell.road3")}</li>
          <li>{t("shell.road4")}</li>
          <li>{t("shell.road5")}</li>
        </ol>
      </aside>

    </div>
  );
}
