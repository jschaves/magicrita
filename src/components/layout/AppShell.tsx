import { Link, NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { Bookmark, Compass, Home, LogOut, MessageCircle, PenLine, Settings, UserRound, Users } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Avatar } from "@/components/note/Avatar";
import { shortenId } from "@/lib/protocol/identity";

export function AppShell() {
  const { status, vault, identity, profile, logout } = useRita();
  const { t } = useI18n();
  const navigate = useNavigate();

  if (status === "anonymous" && !vault) {
    return <Navigate to="/welcome" replace />;
  }
  if (status === "locked") {
    return <Navigate to="/unlock" replace />;
  }

  const rpub = identity?.rpub ?? "";
  const links = [
    { to: "/", label: t("nav.home"), icon: Home },
    { to: "/people", label: t("nav.people"), icon: Users },
    { to: "/saved", label: t("nav.saved"), icon: Bookmark },
    { to: "/protocolo", label: t("nav.protocol"), icon: Compass },
    { to: "/messages", label: t("nav.messages"), icon: MessageCircle },
    { to: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  return (
    <div className="mx-auto grid min-h-dvh max-w-6xl grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_260px]">
      <aside className="hidden border-r border-line md:flex md:flex-col md:px-4 md:py-6">
        <Link to="/" className="px-3 font-display text-3xl font-semibold tracking-tight text-plum">
          MagicRita
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
              <Icon size={18} />
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

      <main className="min-w-0 border-r border-line bg-paper/40 pb-20 md:pb-0">
        <Outlet />
      </main>

      <aside className="hidden p-6 lg:block">
        <div className="rounded-3xl border border-line bg-paper p-4">
          <p className="font-display text-lg">{t("shell.stepOf", { current: 2, total: 5 })}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{t("shell.step2Blurb")}</p>
        </div>
        <ol className="mt-6 space-y-2 text-sm text-muted">
          <li>{t("shell.road1")}</li>
          <li className="font-semibold text-ink">{t("shell.road2")}</li>
          <li>{t("shell.road3")}</li>
          <li>{t("shell.road4")}</li>
          <li>{t("shell.road5")}</li>
        </ol>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-paper/95 px-2 py-2 backdrop-blur md:hidden">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 rounded-xl py-1 text-[11px] font-semibold ${
                isActive ? "text-accent" : "text-muted"
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
        <NavLink
          to="/compose"
          className="flex flex-1 flex-col items-center gap-1 rounded-xl py-1 text-[11px] font-semibold text-accent"
        >
          <PenLine size={18} />
          {t("nav.publish")}
        </NavLink>
      </nav>
    </div>
  );
}
