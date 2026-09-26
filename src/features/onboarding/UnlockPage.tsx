import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { WipeConfirm } from "@/components/ui/WipeConfirm";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { BrowserVerify, type BrowserVerifyState } from "@/components/ui/BrowserVerify";
import { shortenId } from "@/lib/protocol/identity";
import {
  browserCheckValid,
  issueBrowserCheck,
  solveBrowserCheck,
  type BrowserCheck,
} from "@/lib/protocol/browserCheck";

export function UnlockPage() {
  const { status, vault, unlock, wipeIdentity } = useRita();
  const { t, errorMessage } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [check, setCheck] = useState<BrowserCheck | null>(null);
  const [checkEstado, setCheckEstado] = useState<BrowserVerifyState>("working");

  // Cada intento exige resolver un reto nuevo: el anterior se gasta al enviar.
  const armCheck = useCallback(async () => {
    setCheck(null);
    setCheckEstado("working");
    try {
      const solved = await solveBrowserCheck(issueBrowserCheck());
      setCheck(solved);
      setCheckEstado("done");
    } catch {
      setCheckEstado("failed");
    }
  }, []);

  useEffect(() => {
    void armCheck();
  }, [armCheck]);

  if (status === "ready") return <Navigate to="/" replace />;
  if (status === "anonymous" && !vault) return <Navigate to="/welcome" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!browserCheckValid(check)) {
      setError(t("verify.failed"));
      void armCheck();
      return;
    }
    setCheck(null);
    setCheckEstado("working");
    setError(null);
    setBusy(true);
    try {
      await unlock(password);
      navigate("/");
    } catch (err) {
      setError(errorMessage(err, "unlock.failed"));
      void armCheck();
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
          <BrowserVerify state={checkEstado} />
          <p className="text-xs text-ink/50">{t("verify.hint")}</p>
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || checkEstado === "working"}
          >
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
