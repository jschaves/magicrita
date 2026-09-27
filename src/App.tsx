import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { SessionToast } from "@/components/ui/SessionToast";
import { BetaInvitePrompt } from "@/components/ui/BetaInvitePrompt";
import { RitaProvider } from "@/context/RitaProvider";
import { AppShell } from "@/components/layout/AppShell";
import { WelcomePage } from "@/features/onboarding/WelcomePage";
import { CreateAccountPage } from "@/features/onboarding/CreateAccountPage";
import { ImportKeyPage } from "@/features/onboarding/ImportKeyPage";
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
import { AdminPage } from "@/features/admin/AdminPage";
import { LegalPage } from "@/features/legal/LegalPage";
import { loadAdminPath } from "@/lib/adminPath";

/**
 * La ruta de admin la fija el relay, no el build, asi que no se puede declarar
 * como `<Route path>`: habria que conocerla antes de resolver. Se resuelve solo
 * para las rutas desconocidas, de modo que ni la portada ni los chats esperan
 * a un fetch. `/` cae en Navigate, como antes.
 */
function UnknownRoute() {
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadAdminPath().then((path) => {
      if (!alive) return;
      setIsAdmin(window.location.pathname.replace(/\/+$/, "") === `/${path}`);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;
  return isAdmin ? <AdminPage /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <I18nProvider>
      <SessionToast />
      <BetaInvitePrompt />
      <RitaProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/legal" element={<LegalPage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/welcome/create" element={<CreateAccountPage />} />
            <Route path="/welcome/import" element={<ImportKeyPage />} />
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
            <Route path="*" element={<UnknownRoute />} />
          </Routes>
        </BrowserRouter>
      </RitaProvider>
    </I18nProvider>
  );
}
