import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useI18n } from "@/i18n/I18nProvider";
import { loadBetaInvite, redeemBetaInvite } from "@/lib/protocol/betaInvite";

const EVENT = "magicrita-invite-required";

/**
 * Aviso cuando el relé rechaza el `hello` por falta de una invitación vigente.
 * Al guardar un código válido se recarga para reconectar con él.
 */
export function BetaInvitePrompt() {
  const { t, errorMessage } = useI18n();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onRequired = () => {
      setCode(loadBetaInvite());
      setError(null);
      setOpen(true);
    };
    window.addEventListener(EVENT, onRequired);
    return () => window.removeEventListener(EVENT, onRequired);
  }, []);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await redeemBetaInvite(code);
      // Codigo guardado: recargar para reconectar con el nuevo.
      window.location.reload();
    } catch (err) {
      setError(errorMessage(err, "invite.error"));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 px-4"
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-md rounded-3xl border border-line bg-paper p-5 shadow-xl"
      >
        <h2 className="font-display text-xl text-plum">{t("invite.title")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{t("invite.body")}</p>
        <div className="mt-4">
          <TextField
            label={t("create.inviteCode")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        {error ? <p className="mt-2 text-sm text-accent">{error}</p> : null}
        <Button type="submit" className="mt-4 w-full" disabled={busy}>
          {busy ? t("compose.saving") : t("invite.submit")}
        </Button>
      </form>
    </div>,
    document.body,
  );
}
