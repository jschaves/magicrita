import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { toolsText, type ToolsKey } from "@/i18n/tools";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextArea, TextField } from "@/components/ui/Field";
import { betaInviteRequired, loadBetaInvite, redeemBetaInvite } from "@/lib/protocol/betaInvite";
import { parseShareText, recombineShares, type RecoveryShareEnvelope } from "@/lib/protocol/recovery";

/**
 * Recupera una cuenta a partir de M participaciones (una por linea) y la
 * contraseña de recuperacion. Reconstruye la `rsec`, la envuelve en una boveda
 * nueva con la contraseña local elegida y entra.
 */
export function RecoverPage() {
  const { status, importSecret } = useRita();
  const { t, locale } = useI18n();
  const tt = (key: ToolsKey, vars?: Record<string, string | number>) => toolsText(locale, key, vars);
  const navigate = useNavigate();
  const [shares, setShares] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
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
      const lines = shares
        .split(/\s*\n+\s*/)
        .map((line) => line.trim())
        .filter(Boolean);
      const envelopes: RecoveryShareEnvelope[] = lines.map(parseShareText);
      const identity = await recombineShares(envelopes, password);
      if (needInvite && invite.trim()) await redeemBetaInvite(invite);
      await importSecret(identity.rsec, newPassword, undefined, invite);
      navigate("/");
    } catch {
      setError(tt("failed"));
      if (needInvite) setInvite("");
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
        <p className="font-display text-3xl text-plum">{tt("recoverTitle")}</p>
        <p className="mt-2 text-sm text-muted">{tt("recoverHint")}</p>
        <p className="mt-2 text-xs text-muted">{tt("recoverSteps")}</p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <TextArea
            label={tt("shares")}
            rows={5}
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder={tt("sharePlaceholder")}
            required
          />
          <TextField
            label={tt("password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            required
          />
          <TextField
            label={tt("newPassword")}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint={t("create.passwordHint")}
            autoComplete="new-password"
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
            {busy ? t("importKey.importing") : tt("submit")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
