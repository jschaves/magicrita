import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { WipeConfirm } from "@/components/ui/WipeConfirm";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { shortenId } from "@/lib/protocol/identity";


export function UnlockPage() {
  const { status, vault, unlock, wipeIdentity } = useRita();
  const { t, errorMessage } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);


  if (status === "ready") return <Navigate to="/" replace />;
  if (status === "anonymous" && !vault) return <Navigate to="/welcome" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await unlock(password);
      navigate("/");
    } catch (err) {
      setError(errorMessage(err, "unlock.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-12">
      <Card>
        <p className="font-display text-3xl text-plum">{t("unlock.title")}</p>
        <p className="mt-2 text-sm text-muted">
          {vault?.rpub ? shortenId(vault.rpub) : t("unlock.saved")}
        </p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <TextField
            label={t("unlock.password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("unlock.unlocking") : t("unlock.submit")}
          </Button>
          {wipeOpen ? (
            <WipeConfirm
              onConfirm={() => {
                void wipeIdentity().then(() => navigate("/welcome"));
              }}
              onCancel={() => setWipeOpen(false)}
            />
          ) : (
            <Button type="button" variant="ghost" className="w-full" onClick={() => setWipeOpen(true)}>
              {t("unlock.other")}
            </Button>
          )}
        </form>
      </Card>
    </div>
  );
}
