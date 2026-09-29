import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { SessionToast } from "@/components/ui/SessionToast";
import { BetaInvitePrompt } from "@/components/ui/BetaInvitePrompt";
import { CallOverlay } from "@/components/ui/CallOverlay";
import { RitaProvider } from "@/context/RitaProvider";
import { AppShell } from "@/components/layout/AppShell";
import { WelcomePage } from "@/features/onboarding/WelcomePage";
import { CreateAccountPage } from "@/features/onboarding/CreateAccountPage";
import { ImportKeyPage } from "@/features/onboarding/ImportKeyPage";
import { RecoverPage } from "@/features/onboarding/RecoverPage";
import { UnlockPage } from "@/features/onboarding/UnlockPage";
import { HomePage } from "@/features/feed/HomePage";
import { ProtocolPage } from "@/features/feed/DiscoverPage";
import { ComposePage } from "@/features/compose/ComposePage";
import { NotePage } from "@/features/note/NotePage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { MessagesPage } from "@/features/chat/MessagesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { PeoplePage } from "@/features/people/PeoplePage";
import { SavedPage } from "@/features/saved/SavedPage";
import { LegalPage } from "@/features/legal/LegalPage";
import { TermsGate } from "@/features/legal/TermsGate";
import { wireAndroidBackButton } from "@/lib/protocol/native";
import { termsAccepted } from "@/lib/protocol/terms";

/**
 * El APK de Android no lleva panel de administración: el admin es solo web. El
 * relé tampoco vive dentro: está en un servidor externo (`VITE_SIGNAL_URL` y
 * `VITE_API_BASE` en `.env.android`).
 */
const ANDROID = import.meta.env.VITE_APP_TARGET === "android";

/**
 * La ruta de admin la fija el relay, no el build, asi que no se puede declarar
 * como `<Route path>`: habria que conocerla antes de resolver. Se resuelve solo
 * para las rutas desconocidas, de modo que ni la portada ni los chats esperan
 * a un fetch. `/` cae en Navigate, como antes.
 *
 * El panel se carga con `import()` dinámico: en el APK esta pantalla no se
 * referencia (ver `ANDROID` más abajo), así que el bundle de admin no se emite.
 */
function UnknownRoute() {
  const [ready, setReady] = useState(false);
  const [Admin, setAdmin] = useState<ComponentType | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { loadAdminPath } = await import("@/lib/adminPath");
      const path = await loadAdminPath();
      if (!alive) return;
      if (window.location.pathname.replace(/\/+$/, "") === `/${path}`) {
        const mod = await import("@/features/admin/AdminPage");
        if (!alive) return;
        setAdmin(() => mod.AdminPage);
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;
  return Admin ? <Admin /> : <Navigate to="/" replace />;
}

/**
 * Condiciones de uso: bloquea la app hasta que el usuario las acepta. Es la
 * puerta que exige la politica de contenido generado por el usuario de Google
 * Play (no se puede crear identidad ni publicar sin aceptar).
 */
function TermsBoundary({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState(() => termsAccepted());
  if (!accepted) return <TermsGate onAccept={() => setAccepted(true)} />;
  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    void wireAndroidBackButton().then((fn) => {
      if (alive) stop = fn;
      else fn();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  return (
    <I18nProvider>
      <TermsBoundary>
        <SessionToast />
        <BetaInvitePrompt />
        <RitaProvider>
          <CallOverlay />
          <BrowserRouter>
            <Routes>
              <Route path="/legal" element={<LegalPage />} />
              <Route path="/welcome" element={<WelcomePage />} />
              <Route path="/welcome/create" element={<CreateAccountPage />} />
              <Route path="/welcome/import" element={<ImportKeyPage />} />
              <Route path="/welcome/recover" element={<RecoverPage />} />
              <Route path="/unlock" element={<UnlockPage />} />
              <Route element={<AppShell />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/people" element={<PeoplePage />} />
                <Route path="/saved" element={<SavedPage />} />
                <Route path="/protocolo" element={<ProtocolPage />} />
                <Route path="/discover" element={<Navigate to="/protocolo" replace />} />
                <Route path="/compose" element={<ComposePage />} />
                <Route path="/n/:id" element={<NotePage />} />
                <Route path="/p/:rpub" element={<ProfilePage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/messages/:rpub" element={<MessagesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              {ANDROID ? (
                <Route path="*" element={<Navigate to="/" replace />} />
              ) : (
                <Route path="*" element={<UnknownRoute />} />
              )}
            </Routes>
          </BrowserRouter>
        </RitaProvider>
      </TermsBoundary>
    </I18nProvider>
  );
}
