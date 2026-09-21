import { useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { FileUp, KeyRound, Sparkles } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";

export function WelcomePage() {
  const { status, importBundleFile } = useRita();
  const { t, errorMessage } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "ready") return <Navigate to="/" replace />;
  if (status === "locked") return <Navigate to="/unlock" replace />;

  async function onPortable(file: File) {
    setBusy(true);
    setError(null);
    try {
      const result = await importBundleFile(file);
      if (!result.vaultRestored) {
        setError(t("welcome.portableNeedBackup"));
      }
    } catch (err) {
      setError(errorMessage(err, "welcome.portableFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-4 py-12">
      <LanguageSwitch className="mb-8" />
      <p className="font-display text-5xl text-plum md:text-6xl">MagicRita</p>
      <p className="mt-3 max-w-xl text-lg text-muted">{t("welcome.tagline")}</p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <Card>
          <Sparkles className="text-accent" />
          <h2 className="mt-3 font-display text-xl">{t("welcome.createTitle")}</h2>
          <p className="mt-2 text-sm text-muted">{t("welcome.createBody")}</p>
          <Link to="/welcome/create" className="mt-5 block">
            <Button className="w-full">{t("welcome.start")}</Button>
          </Link>
        </Card>
        <Card>
          <FileUp className="text-gold" />
          <h2 className="mt-3 font-display text-xl">{t("welcome.portableTitle")}</h2>
          <p className="mt-2 text-sm text-muted">{t("welcome.portableBody")}</p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onPortable(file);
            }}
          />
          <Button
            variant="secondary"
            className="mt-5 w-full"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? t("welcome.portableLoading") : t("welcome.portableButton")}
          </Button>
        </Card>
        <Card>
          <KeyRound className="text-plum" />
          <h2 className="mt-3 font-display text-xl">{t("welcome.importTitle")}</h2>
          <p className="mt-2 text-sm text-muted">{t("welcome.importBody")}</p>
          <Link to="/welcome/import" className="mt-5 block">
            <Button variant="secondary" className="w-full">
              {t("welcome.import")}
            </Button>
          </Link>
        </Card>
      </div>
      {error ? <p className="mt-4 text-sm text-accent">{error}</p> : null}
      <p className="mt-10 text-sm text-muted">{t("welcome.later")}</p>
    </div>
  );
}
