import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextArea, TextField } from "@/components/ui/Field";
import { betaInviteRequired, loadBetaInvite, redeemBetaInvite } from "@/lib/protocol/betaInvite";

export function ImportKeyPage() {
  const { status, importSecret } = useRita();
  const { t, errorMessage } = useI18n();
  const navigate = useNavigate();
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needInvite, setNeedInvite] = useState(true);
  const [invite, setInvite] = useState(() => loadBetaInvite());

  useEffect(() => {
    void betaInviteRequired().then(setNeedInvite);
  }, []);

  if (status === "ready") return <Navigate to="/" replace />;
  if (status === "locked") return <Navigate to="/unlock" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needInvite && invite.trim()) await redeemBetaInvite(invite);
      await importSecret(secret, password, undefined, invite);
      navigate("/");
    } catch (err) {
      setError(errorMessage(err, "importKey.failed"));
      // Codigo invalido o caducado: se vacia para obligar a escribir otro.
      if (err instanceof Error && err.message.startsWith("invite")) setInvite("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-12">
      <Link to="/welcome" className="mb-4 text-sm text-muted hover:text-ink">
        {t("common.back")}
      </Link>
      <Card>
        <p className="font-display text-3xl text-plum">{t("importKey.title")}</p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <TextArea
            label={t("importKey.secret")}
            rows={3}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="rsec_…"
            required
          />
          <TextField
            label={t("importKey.password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t("importKey.hint")}
            required
            minLength={8}
          />
          {needInvite ? (
            <TextField
              label={t("create.inviteCode")}
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              hint={t("create.inviteHint")}
              required
            />
          ) : null}
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("importKey.importing") : t("importKey.submit")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
