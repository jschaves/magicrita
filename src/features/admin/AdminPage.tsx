import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { BrowserVerify } from "@/components/ui/BrowserVerify";
import { TextField } from "@/components/ui/Field";
import {
  LOGO_MAX_BYTES,
  fetchBrand,
  fileToBase64,
  logoUrl,
  mimeFromFile,
  notifyBrandChange,
} from "@/lib/protocol/brand";
import { assemblyReport, clearAssemblyLog, type AssemblyEvent } from "@/lib/protocol/diagnostics";
import { runAssemblyGuardSelfTest, type GuardReport } from "@/lib/protocol/mesh";
import { apiUrl } from "@/lib/protocol/apiBase";
import {
  captchaFresh,
  fetchAdminCaptcha,
  solveAdminCaptcha,
  type AdminCaptcha,
} from "@/lib/protocol/adminCaptcha";
import { useI18n, type MessageKey } from "@/i18n/I18nProvider";

type AdminTab = "settings" | "diagnostics" | "invites" | "users" | "comments" | "language";

type CaptchaEstado = "resolviendo" | "listo" | "fallo";

type Blocks = { users: string[]; comments: string[] };
type LivePeer = { rpub: string; name: string };
type Invite = {
  id: string;
  code: string;
  note: string;
  disabled: boolean;
  created: number;
  uses: number;
  lastUsed: number;
};

const LIVE_PAGE_SIZE = 5;

const TOKEN_KEY = "magicrita.adminToken";

/**
 * El token da acceso a moderacion y a la marca, asi que no se guarda en
 * sessionStorage: Firefox lo escribe a disco y sobrevive a un cierre por fallo.
 * Se queda en la memoria de la pestana, igual que la rsec del vault. El coste
 * es que recargar pide usuario y contrasena otra vez.
 */
let adminToken: string | null = null;
try {
  sessionStorage.removeItem(TOKEN_KEY);
} catch {
  // ignore
}

async function api(path: string, init?: RequestInit) {
  const token = adminToken ?? "";
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error || res.status));
  return data;
}

/**
 * `api` propaga el codigo crudo del relay (`bad_path`, `ruta`, `too_many`...). Se
 * enseña el texto traducido y, detras, el codigo entre parentesis: es lo unico
 * que sirve para depurar y no merece una traduccion por codigo.
 */
function conCodigo(mensaje: string, codigo: string): string {
  return codigo ? `${mensaje} (${codigo})` : mensaje;
}

/**
 * `performance.now()` viene con la resolucion degradada a proposito, asi que por
 * debajo del grano sale 0.000 ms. Mostrarlo en microsegundos deja claro que si
 * se midio algo, sin inventar precision que el navegador no da.
 */
function duracion(ms: number): string {
  const us = Math.round(ms * 1000);
  return us < 1000 ? `${us} µs` : `${ms.toFixed(2)} ms`;
}

export function AdminPage() {
  const { t, locale, locales, setLocale } = useI18n();
  const [tab, setTab] = useState<AdminTab>("settings");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(Boolean(adminToken));
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Blocks>({ users: [], comments: [] });
  const [live, setLive] = useState<LivePeer[]>([]);
  const [userId, setUserId] = useState("");
  const [commentId, setCommentId] = useState("");
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [diag, setDiag] = useState(() => assemblyReport());
  const [guard, setGuard] = useState<GuardReport | null>(null);
  const [guardBusy, setGuardBusy] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const [liveQuery, setLiveQuery] = useState("");
  const [livePage, setLivePage] = useState(0);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [betaRequired, setBetaRequired] = useState(true);
  const [inviteNote, setInviteNote] = useState("");
  const [inviteCount, setInviteCount] = useState("1");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [nuevos, setNuevos] = useState<Invite[]>([]);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [adminPath, setAdminPath] = useState("");
  const [adminPathActual, setAdminPathActual] = useState("");
  const [adminPathBusy, setAdminPathBusy] = useState(false);
  const [adminPathError, setAdminPathError] = useState<string | null>(null);
  const [adminPathGuardado, setAdminPathGuardado] = useState<string | null>(null);
  const [captchaBusy, setCaptchaBusy] = useState(false);
  const [captchaEstado, setCaptchaEstado] = useState<CaptchaEstado>("resolviendo");
  const captchaRef = useRef<AdminCaptcha | null>(null);

  // El registro de diagnostico vive en memoria, asi que se refresca solo.
  useEffect(() => {
    const timer = setInterval(() => setDiag(assemblyReport()), 1000);
    return () => clearInterval(timer);
  }, []);

  // El reto del captcha se resuelve en segundo plano para que el primer intento
  // no espere. Si caduca, `ensureCaptcha` pide otro al enviar.
  useEffect(() => {
    if (authed) return;
    let vivo = true;
    setCaptchaEstado("resolviendo");
    void (async () => {
      try {
        const reto = await fetchAdminCaptcha();
        const resuelto = await solveAdminCaptcha(reto);
        if (!vivo) return;
        if (!captchaFresh(captchaRef.current)) captchaRef.current = resuelto;
        setCaptchaEstado("listo");
      } catch {
        if (vivo) setCaptchaEstado("fallo");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [authed]);

  async function ensureCaptcha(): Promise<AdminCaptcha> {
    const cacheado = captchaRef.current;
    if (cacheado && captchaFresh(cacheado)) return cacheado;
    setCaptchaEstado("resolviendo");
    try {
      const reto = await fetchAdminCaptcha();
      const resuelto = await solveAdminCaptcha(reto);
      captchaRef.current = resuelto;
      setCaptchaEstado("listo");
      return resuelto;
    } catch (err) {
      setCaptchaEstado("fallo");
      throw err;
    }
  }

  async function runGuard() {
    setGuardBusy(true);
    try {
      setGuard(await runAssemblyGuardSelfTest());
      setDiag(assemblyReport());
    } finally {
      setGuardBusy(false);
    }
  }

  async function copyDiag() {
    const payload = JSON.stringify({ reporte: assemblyReport(), prueba: guard }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // clipboard puede estar bloqueado; el panel ya muestra lo mismo en pantalla
    }
  }

  async function copyText(text: string, marca: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiado(marca);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setInviteError(t("admin.invites.copyError"));
    }
  }

  async function refresh() {
    const session = (await api("/admin-api/session")) as { live?: LivePeer[] };
    const next = (await api("/admin-api/blocks")) as Blocks;
    const brand = await fetchBrand();
    const invitesRes = (await api("/admin-api/invites")) as {
      invites?: Invite[];
      required?: boolean;
    };
    const pathRes = (await api("/admin-api/admin-path").catch(() => null)) as {
      path?: string;
    } | null;
    const actual = typeof pathRes?.path === "string" ? pathRes.path : "";
    setAdminPathActual(actual);
    setAdminPath(actual);
    setLive(Array.isArray(session.live) ? session.live : []);
    setInvites(Array.isArray(invitesRes.invites) ? invitesRes.invites : []);
    setBetaRequired(Boolean(invitesRes.required));
    setBlocks({
      users: Array.isArray(next.users) ? next.users : [],
      comments: Array.isArray(next.comments) ? next.comments : [],
    });
    setLogoSrc(brand.logo ? logoUrl(brand.updated) : null);
  }

  useEffect(() => {
    if (!authed) return;
    void refresh().catch(() => {
      adminToken = null;
      setAuthed(false);
    });
  }, [authed]);

  async function saveAdminPath(event: React.FormEvent) {
    event.preventDefault();
    setAdminPathError(null);
    setAdminPathGuardado(null);
    const limpio = adminPath.trim().replace(/^\/+|\/+$/g, "");
    // Se compara contra lo que dice el servidor, no contra `adminHref()`: ese es
    // un valor de modulo que se queda viejo en cuanto rotas la ruta, y haria que
    // la nueva ruta pareciese "la actual" y la muerta pareciese nueva.
    if (limpio === adminPathActual) {
      setAdminPathError(t("admin.settings.pathSame"));
      return;
    }
    setAdminPathBusy(true);
    try {
      const data = (await api("/admin-api/admin-path", {
        method: "POST",
        body: JSON.stringify({ path: limpio }),
      })) as { path?: string };
      const guardado = typeof data.path === "string" ? data.path : "";
      setAdminPathActual(guardado);
      setAdminPath(guardado);
      setAdminPathGuardado(guardado);
    } catch (err) {
      setAdminPathError(
        conCodigo(t("admin.settings.pathError"), err instanceof Error ? err.message : ""),
      );
    } finally {
      setAdminPathBusy(false);
    }
  }

  async function createInvites(event: React.FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setInviteBusy(true);
    try {
      const data = (await api("/admin-api/invites", {
        method: "POST",
        body: JSON.stringify({ note: inviteNote, count: Number(inviteCount) }),
      })) as { invites?: Invite[]; required?: boolean; created?: Invite[] };
      setInvites(Array.isArray(data.invites) ? data.invites : []);
      setBetaRequired(Boolean(data.required));
      setNuevos(Array.isArray(data.created) ? data.created : []);
      setInviteNote("");
    } catch (err) {
      setInviteError(
        conCodigo(t("admin.invites.createError"), err instanceof Error ? err.message : ""),
      );
    } finally {
      setInviteBusy(false);
    }
  }

  async function toggleInvite(id: string, disabled: boolean) {
    setInviteError(null);
    try {
      const data = (await api("/admin-api/invites/toggle", {
        method: "POST",
        body: JSON.stringify({ id, disabled }),
      })) as { invites?: Invite[]; required?: boolean };
      setInvites(Array.isArray(data.invites) ? data.invites : []);
      setBetaRequired(Boolean(data.required));
    } catch (err) {
      setInviteError(
        conCodigo(t("admin.invites.toggleError"), err instanceof Error ? err.message : ""),
      );
    }
  }

  async function deleteInvite(id: string) {
    setInviteError(null);
    try {
      const data = (await api("/admin-api/invites", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      })) as { invites?: Invite[]; required?: boolean };
      setInvites(Array.isArray(data.invites) ? data.invites : []);
      setBetaRequired(Boolean(data.required));
      setNuevos((list) => list.filter((item) => item.id !== id));
    } catch (err) {
      setInviteError(
        conCodigo(t("admin.invites.deleteError"), err instanceof Error ? err.message : ""),
      );
    }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setCaptchaBusy(true);
    try {
      const captcha = await ensureCaptcha();
      const data = (await api("/admin-api/login", {
        method: "POST",
        body: JSON.stringify({ user, password, captcha }),
      })) as { token?: string };
      if (!data.token) throw new Error("sesion");
      adminToken = data.token;
      captchaRef.current = null;
      setAuthed(true);
      setPassword("");
    } catch (err) {
      // El relay gasta el nonce aunque la clave sea mala, asi que un reintento
      // tiene que resolver un reto nuevo: se descarta el que hubiera.
      captchaRef.current = null;
      const codigo = err instanceof Error ? err.message : "";
      if (codigo.startsWith("captcha")) {
        setError(t("admin.login.captchaError"));
        setCaptchaEstado("fallo");
      } else {
        if (codigo === "rate" || codigo === "too_many") setError(t("admin.login.rate"));
        else setError(t("admin.login.error"));
        // El nonce se gasto aunque la clave fuera mala: deja otro resuelto por
        // detras para que el siguiente intento no espere.
        void ensureCaptcha().catch(() => {});
      }
    } finally {
      setCaptchaBusy(false);
    }
  }

  async function block(kind: "user" | "comment", id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    const next = (await api("/admin-api/blocks", {
      method: "POST",
      body: JSON.stringify({ kind, id: trimmed }),
    })) as Blocks;
    setBlocks(next);
    if (kind === "user") setUserId("");
    else setCommentId("");
  }

  async function unblock(kind: "user" | "comment", id: string) {
    const next = (await api("/admin-api/blocks", {
      method: "DELETE",
      body: JSON.stringify({ kind, id }),
    })) as Blocks;
    setBlocks(next);
  }

  async function uploadLogo(file: File) {
    const mime = mimeFromFile(file);
    if (!mime) {
      setLogoError(t("admin.settings.logoType"));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(t("admin.settings.logoSize"));
      return;
    }
    setLogoBusy(true);
    setLogoError(null);
    try {
      const data = await fileToBase64(file);
      const next = (await api("/admin-api/logo", {
        method: "POST",
        body: JSON.stringify({ mime, data }),
      })) as { updated?: number };
      setLogoSrc(logoUrl(next.updated ?? Date.now()));
      notifyBrandChange();
    } catch {
      setLogoError(t("admin.settings.uploadError"));
    } finally {
      setLogoBusy(false);
    }
  }

  // El roster cambia de orden en cuanto entra o sale alguien, así que se ordena
  // antes de paginar: si no, los saltos de página muevan las filas debajo del dedo.
  const liveOrdenados = useMemo(
    () =>
      [...live].sort(
        (a, b) =>
          (a.name || "￿").localeCompare(b.name || "￿", "es") || a.rpub.localeCompare(b.rpub),
      ),
    [live],
  );

  const liveFiltrados = useMemo(() => {
    const q = liveQuery.trim().toLowerCase();
    if (!q) return liveOrdenados;
    return liveOrdenados.filter(
      (peer) => peer.name.toLowerCase().includes(q) || peer.rpub.toLowerCase().includes(q),
    );
  }, [liveOrdenados, liveQuery]);

  const livePaginas = Math.max(1, Math.ceil(liveFiltrados.length / LIVE_PAGE_SIZE));
  // El total puede encogerse con el buscador o al irse gente: se recorta en vez
  // de dejar el indice colgando y mostrar una pagina vacia.
  const livePagina = Math.min(livePage, livePaginas - 1);
  const liveSlice = liveFiltrados.slice(
    livePagina * LIVE_PAGE_SIZE,
    livePagina * LIVE_PAGE_SIZE + LIVE_PAGE_SIZE,
  );

  async function removeLogo() {
    setLogoBusy(true);
    setLogoError(null);
    try {
      await api("/admin-api/logo", { method: "DELETE" });
      setLogoSrc(null);
      notifyBrandChange();
    } catch {
      setLogoError(t("admin.settings.removeError"));
    } finally {
      setLogoBusy(false);
    }
  }

  const TABS: { id: AdminTab; label: MessageKey }[] = [
    { id: "settings", label: "admin.menu.settings" },
    { id: "diagnostics", label: "admin.menu.diagnostics" },
    { id: "invites", label: "admin.menu.invites" },
    { id: "users", label: "admin.menu.users" },
    { id: "comments", label: "admin.menu.comments" },
    { id: "language", label: "admin.menu.language" },
  ];

  if (!authed) {
    return (
      <main className="mx-auto h-full max-w-md overflow-y-auto overscroll-y-contain px-4 py-16">
        <h1 className="font-display text-3xl">{t("admin.title")}</h1>
        <form className="mt-8 space-y-4" onSubmit={(e) => void login(e)}>
          <TextField
            label={t("admin.login.user")}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
          />
          <TextField
            label={t("admin.login.password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <BrowserVerify
            state={
              captchaEstado === "listo" ? "done" : captchaEstado === "fallo" ? "failed" : "working"
            }
          />
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <p className="text-xs text-ink/50">{t("admin.login.hint")}</p>
          <Button type="submit" className="w-full" disabled={captchaBusy}>
            {captchaBusy ? t("admin.login.verifying") : t("admin.login.submit")}
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto h-full max-w-5xl overflow-y-auto overscroll-y-contain px-4 py-8">
      {/*
        `html/body/#root` llevan `overflow: hidden`, asi que el documento no
        scrollea: cada pagina aporta su propio contenedor, como hace AppShell.
      */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">{t("admin.title")}</h1>
        <Button
          variant="ghost"
          onClick={() => {
            adminToken = null;
            setAuthed(false);
          }}
        >
          {t("settings.logout")}
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-start">
        {/*
          En movil, una tira de pastillas que scrollea en horizontal; en
          escritorio, una columna fija. Mismo estado, misma lista.
        */}
        <nav
          className="-mx-4 flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:w-52 md:flex-col md:overflow-visible md:px-0 md:pb-0"
          aria-label={t("admin.title")}
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition md:w-full md:text-left ${
                tab === item.id ? "bg-accent text-white" : "bg-cream text-ink hover:bg-line/60"
              }`}
            >
              {t(item.label)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === "settings" ? (
            <>
              <section className="rounded-2xl border border-line bg-paper p-4">
                <h2 className="font-semibold">{t("admin.settings.logo")}</h2>
                <p className="mt-1 text-xs text-muted">{t("admin.settings.logoIntro")}</p>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-cream">
                    {logoSrc ? (
                      <img
                        src={logoSrc}
                        alt={t("admin.settings.logoAlt")}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="px-2 text-center text-[11px] text-muted">
                        {t("admin.settings.noLogo")}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={logoRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadLogo(file);
                      }}
                    />
                    <Button
                      type="button"
                      disabled={logoBusy}
                      onClick={() => logoRef.current?.click()}
                    >
                      {logoBusy ? t("admin.settings.uploading") : t("admin.settings.upload")}
                    </Button>
                    {logoSrc ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={logoBusy}
                        onClick={() => void removeLogo()}
                      >
                        {t("admin.settings.remove")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {logoError ? <p className="mt-3 text-sm text-accent">{logoError}</p> : null}
              </section>

              <section className="mt-4 rounded-2xl border border-line bg-paper p-4">
                <h2 className="font-semibold">{t("admin.settings.path")}</h2>
                <p className="mt-1 text-xs text-muted">
                  {t("admin.settings.pathNow", { path: `/${adminPathActual}` })}
                </p>
                <p className="mt-2 rounded-xl border border-line bg-cream p-2.5 text-xs text-muted">
                  {t("admin.settings.pathWarning")}
                </p>
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => void saveAdminPath(e)}
                >
                  <TextField
                    label={t("admin.settings.pathLabel")}
                    className="sm:flex-1"
                    placeholder={t("admin.settings.pathPlaceholder")}
                    maxLength={64}
                    value={adminPath}
                    onChange={(e) => {
                      setAdminPath(e.target.value);
                      setAdminPathGuardado(null);
                      setAdminPathError(null);
                    }}
                  />
                  <Button
                    type="submit"
                    disabled={adminPathBusy || !adminPath.trim()}
                    className="self-end"
                  >
                    {adminPathBusy
                      ? t("admin.settings.pathSaving")
                      : t("admin.settings.pathChange")}
                  </Button>
                </form>
                {adminPathError ? (
                  <p className="mt-2 text-sm text-accent">{adminPathError}</p>
                ) : null}
                {adminPathGuardado ? (
                  <div className="mt-3 rounded-xl border border-line bg-cream p-3 text-sm">
                    <p>{t("admin.settings.pathSaved")}</p>
                    <p className="mt-2 break-all font-mono text-xs">/{adminPathGuardado}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          void copyText(`${window.location.origin}/${adminPathGuardado}`, "ruta")
                        }
                      >
                        {copiado === "ruta"
                          ? t("admin.invites.copied")
                          : t("admin.settings.pathCopyUrl")}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => window.location.assign(`/${adminPathGuardado}`)}
                      >
                        {t("admin.settings.pathGo")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {tab === "diagnostics" ? (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <h2 className="font-semibold">{t("admin.diagnostics.title")}</h2>
              <p className="mt-1 text-xs text-muted">
                {t("admin.diagnostics.intro", { code: "n" })}
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <span>
                  {t("admin.diagnostics.rejected")}:{" "}
                  <strong className="font-mono">{diag.rechazados}</strong>
                </span>
                <span>
                  {t("admin.diagnostics.accepted")}:{" "}
                  <strong className="font-mono">{diag.aceptados}</strong>
                </span>
                <span>
                  {t("admin.diagnostics.lastRejected")}:{" "}
                  <strong className="font-mono">
                    {diag.ultimoRechazo ? new Date(diag.ultimoRechazo).toLocaleTimeString() : "—"}
                  </strong>
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" disabled={guardBusy} onClick={() => void runGuard()}>
                  {guardBusy ? t("admin.diagnostics.running") : t("admin.diagnostics.run")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => void copyDiag()}>
                  {t("admin.diagnostics.copy")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    clearAssemblyLog();
                    setDiag(assemblyReport());
                  }}
                >
                  {t("admin.diagnostics.clear")}
                </Button>
              </div>
              {guard ? (
                <div
                  className={`mt-4 rounded-xl border p-3 text-sm ${
                    guard.correcto ? "border-line bg-cream" : "border-accent bg-cream"
                  }`}
                >
                  <p>
                    {guard.correcto ? t("admin.diagnostics.ok") : t("admin.diagnostics.fail")} ·{" "}
                    {t("admin.diagnostics.worst")}{" "}
                    <strong className="font-mono">{duracion(guard.msPeor)}</strong> (
                    {t("admin.diagnostics.threshold")} {guard.umbralMs} ms) ·{" "}
                    {t("admin.diagnostics.cap")} <strong className="font-mono">{guard.cap}</strong>
                  </p>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto overscroll-contain font-mono text-xs">
                    {[...guard.casosHostiles, ...guard.casosLegales].map((caso) => (
                      <li key={`${caso.via}-${caso.hostileN}`}>
                        {caso.via.padEnd(11)} n=
                        {String(caso.hostileN).padEnd(12)} {duracion(caso.ms)} ·{" "}
                        {caso.slotAbierto
                          ? t("admin.diagnostics.slotOpen")
                          : t("admin.diagnostics.noSlot")}{" "}
                        ·{" "}
                        {caso.correcto
                          ? t("admin.diagnostics.pass")
                          : t("admin.diagnostics.caseFail")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {diag.eventos.length ? (
                <ul className="mt-4 max-h-64 space-y-1 overflow-auto overscroll-contain font-mono text-xs text-muted">
                  {diag.eventos
                    .slice()
                    .reverse()
                    .slice(0, 40)
                    .map((evento: AssemblyEvent, index) => (
                      <li key={`${evento.at}-${index}`} className="whitespace-pre-wrap">
                        {new Date(evento.at).toLocaleTimeString()} {evento.verdict.padEnd(9)}{" "}
                        {evento.via.padEnd(11)} n=
                        {String(evento.n).padEnd(12)} i=
                        {String(evento.i).padEnd(6)} {duracion(evento.ms)} {evento.motivo}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  {t("admin.diagnostics.empty", {
                    code: "node tools/mesh-probe.mjs",
                  })}
                </p>
              )}
            </section>
          ) : null}

          {tab === "invites" ? (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{t("admin.invites.title")}</h2>
                <span className="text-xs text-muted">
                  {betaRequired
                    ? t("admin.invites.closed", {
                        enabled: invites.filter((i) => !i.disabled).length,
                        total: invites.length,
                      })
                    : t("admin.invites.open")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">{t("admin.invites.intro")}</p>
              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => void createInvites(e)}
              >
                <TextField
                  label={t("admin.invites.noteLabel")}
                  className="sm:flex-1"
                  placeholder={t("admin.invites.notePlaceholder")}
                  maxLength={80}
                  value={inviteNote}
                  onChange={(e) => setInviteNote(e.target.value)}
                />
                <TextField
                  label={t("admin.invites.countLabel")}
                  className="sm:w-24"
                  type="number"
                  min={1}
                  max={20}
                  value={inviteCount}
                  onChange={(e) => setInviteCount(e.target.value)}
                />
                <Button type="submit" disabled={inviteBusy} className="self-end">
                  {inviteBusy ? t("admin.invites.creating") : t("admin.invites.create")}
                </Button>
              </form>
              {inviteError ? <p className="mt-2 text-sm text-accent">{inviteError}</p> : null}
              {nuevos.length ? (
                <div className="mt-3 rounded-xl border border-line bg-cream p-3 text-sm">
                  <p className="font-semibold">{t("admin.invites.newCodes")}</p>
                  <ul className="mt-2 space-y-1 font-mono text-xs">
                    {nuevos.map((invite) => (
                      <li key={invite.id} className="flex flex-wrap items-center gap-2">
                        <span className="break-all">{invite.code}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void copyText(invite.code, invite.id)}
                        >
                          {copiado === invite.id
                            ? t("admin.invites.copied")
                            : t("admin.invites.copy")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => setNuevos([])}
                  >
                    {t("admin.invites.hide")}
                  </Button>
                </div>
              ) : null}
              {invites.length === 0 ? (
                <p className="mt-3 text-sm text-muted">{t("admin.invites.empty")}</p>
              ) : (
                <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto overscroll-contain text-sm">
                  {invites.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <span
                          className={`block break-all font-mono text-xs ${
                            invite.disabled ? "text-muted line-through" : ""
                          }`}
                        >
                          {invite.code}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {invite.note || t("admin.invites.noNote")} ·{" "}
                          {t("admin.invites.uses", { n: invite.uses })}
                          {invite.lastUsed
                            ? t("admin.invites.lastUse", {
                                date: new Date(invite.lastUsed).toLocaleDateString(locale),
                              })
                            : ""}
                          {invite.disabled ? t("admin.invites.disabledTag") : ""}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void copyText(invite.code, invite.id)}
                        >
                          {copiado === invite.id
                            ? t("admin.invites.copied")
                            : t("admin.invites.copy")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void toggleInvite(invite.id, !invite.disabled)}
                        >
                          {invite.disabled ? t("admin.invites.enable") : t("admin.invites.disable")}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => void deleteInvite(invite.id)}
                        >
                          {t("admin.invites.delete")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === "users" ? (
            <>
              <section className="rounded-2xl border border-line bg-paper p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{t("admin.users.online")}</h2>
                  <span className="text-xs text-muted">
                    {liveFiltrados.length === live.length
                      ? t("admin.users.total", { n: live.length })
                      : t("admin.users.filtered", {
                          n: liveFiltrados.length,
                          total: live.length,
                        })}
                  </span>
                </div>
                <input
                  className="mt-3 w-full rounded-2xl border border-line bg-paper px-3.5 py-2.5 text-sm outline-none ring-accent/30 placeholder:text-muted/70 focus:ring-2"
                  placeholder={t("admin.users.search")}
                  value={liveQuery}
                  onChange={(e) => {
                    setLiveQuery(e.target.value);
                    setLivePage(0);
                  }}
                />
                {live.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{t("admin.users.none")}</p>
                ) : liveFiltrados.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    {t("admin.users.noMatch", { query: liveQuery.trim() })}
                  </p>
                ) : (
                  <>
                    <ul className="mt-3 space-y-2 text-sm">
                      {liveSlice.map((peer) => (
                        <li key={peer.rpub} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">
                            <span className="font-semibold">
                              {peer.name || t("common.unnamed")}
                            </span>
                            <span className="block truncate text-xs text-muted">{peer.rpub}</span>
                          </span>
                          <Button variant="danger" onClick={() => void block("user", peer.rpub)}>
                            {t("admin.users.block")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 flex items-center justify-between gap-2 text-sm">
                      <Button
                        variant="ghost"
                        disabled={livePagina === 0}
                        onClick={() => setLivePage((p) => Math.max(0, p - 1))}
                      >
                        {t("admin.users.prev")}
                      </Button>
                      <span className="text-xs text-muted">
                        {t("admin.users.page", {
                          page: livePagina + 1,
                          pages: livePaginas,
                          n: liveFiltrados.length,
                        })}
                      </span>
                      <Button
                        variant="ghost"
                        disabled={livePagina >= livePaginas - 1}
                        onClick={() => setLivePage((p) => Math.min(livePaginas - 1, p + 1))}
                      >
                        {t("admin.users.next")}
                      </Button>
                    </div>
                  </>
                )}
              </section>

              <section className="mt-4 rounded-2xl border border-line bg-paper p-4">
                <h2 className="font-semibold">{t("admin.users.blockTitle")}</h2>
                <p className="mt-1 text-xs text-muted">{t("admin.users.blockHint")}</p>
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void block("user", userId);
                  }}
                >
                  <input
                    className="min-w-0 flex-1 rounded-2xl border border-line px-3 py-2 text-sm"
                    placeholder={t("admin.users.rpubPlaceholder")}
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                  />
                  <Button type="submit">{t("admin.users.block")}</Button>
                </form>
                {blocks.users.length ? (
                  <ul className="mt-4 space-y-2 text-sm">
                    {blocks.users.map((id) => (
                      <li key={id} className="flex items-center justify-between gap-2">
                        <span className="break-all">{id}</span>
                        <Button variant="ghost" onClick={() => void unblock("user", id)}>
                          {t("admin.users.remove")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </>
          ) : null}

          {tab === "comments" ? (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <h2 className="font-semibold">{t("admin.comments.title")}</h2>
              <p className="mt-1 text-xs text-muted">{t("admin.comments.intro")}</p>
              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void block("comment", commentId);
                }}
              >
                <input
                  className="min-w-0 flex-1 rounded-2xl border border-line px-3 py-2 text-sm"
                  placeholder={t("admin.comments.sigPlaceholder")}
                  value={commentId}
                  onChange={(e) => setCommentId(e.target.value)}
                />
                <Button type="submit">{t("admin.comments.block")}</Button>
              </form>
              {blocks.comments.length ? (
                <ul className="mt-4 space-y-2 text-sm">
                  {blocks.comments.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <span className="break-all">{id}</span>
                      <Button variant="ghost" onClick={() => void unblock("comment", id)}>
                        {t("admin.comments.remove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted">{t("admin.comments.empty")}</p>
              )}
            </section>
          ) : null}

          {tab === "language" ? (
            <section className="rounded-2xl border border-line bg-paper p-4">
              <h2 className="font-semibold">{t("admin.language.title")}</h2>
              <p className="mt-1 text-xs text-muted">{t("admin.language.intro")}</p>
              <p className="mt-3 text-sm">
                {t("admin.language.current", {
                  lang: locales.find((item) => item.code === locale)?.native ?? locale,
                })}
              </p>
              <ul className="mt-4 space-y-2">
                {locales.map((item) => (
                  <li key={item.code}>
                    <button
                      type="button"
                      onClick={() => setLocale(item.code)}
                      aria-current={locale === item.code ? "true" : undefined}
                      className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm ${
                        locale === item.code
                          ? "border-accent bg-accent/10 font-semibold text-accent"
                          : "border-line bg-paper hover:bg-cream"
                      }`}
                    >
                      <span>{item.native}</span>
                      <span className="font-mono text-xs text-muted">{item.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
