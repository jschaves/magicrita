import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextArea, TextField } from "@/components/ui/Field";
import { Avatar } from "@/components/note/Avatar";
import { LocalCaptcha } from "@/components/ui/LocalCaptcha";
import { ingestPhoto, isAcceptedPhoto } from "@/lib/protocol/media";
import { MAX_BIO_CHARS, MAX_NAME_CHARS } from "@/lib/protocol/envelope";
import { verifyCaptcha } from "@/lib/protocol/captcha";
import { createBlock, noteCreateAttempt } from "@/lib/protocol/signupGuard";
import { betaInviteRequired, loadBetaInvite, redeemBetaInvite } from "@/lib/protocol/betaInvite";

export function CreateAccountPage() {
  const { status, createAccount } = useRita();
  const { t, errorMessage } = useI18n();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaTick, setCaptchaTick] = useState(0);
  const onCaptcha = useCallback((value: string) => setCaptcha(value), []);
  const [rsec, setRsec] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [block, setBlock] = useState(() => createBlock());
  const [needInvite, setNeedInvite] = useState(false);
  const [invite, setInvite] = useState(() => loadBetaInvite());

  useEffect(() => {
    void betaInviteRequired().then(setNeedInvite);
  }, []);

  if (status === "ready") return <Navigate to="/" replace />;
  if (status === "locked") return <Navigate to="/unlock" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("create.mismatch"));
      return;
    }
    const gated = createBlock();
    if (gated) {
      setBlock(gated);
      setError(
        gated.reason === "exists" ? t("create.blockedExists") : t("create.rateLimited", { n: gated.minutes }),
      );
      return;
    }
    if (needInvite) {
      try {
        await redeemBetaInvite(invite);
      } catch (err) {
        setError(errorMessage(err, "create.failed"));
        return;
      }
    }
    noteCreateAttempt();
    if (!verifyCaptcha(captcha)) {
      setError(t("create.captchaWrong"));
      setCaptcha("");
      setCaptchaTick((n) => n + 1);
      setBlock(createBlock());
      return;
    }
    setBusy(true);
    try {
      const picture = pictureFile ? await ingestPhoto(pictureFile) : undefined;
      const keys = await createAccount({ password, name, about, picture });
      setRsec(keys.rsec);
    } catch (err) {
      setError(errorMessage(err, "create.failed"));
      setBlock(createBlock());
    } finally {
      setBusy(false);
    }
  }

  if (rsec) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-12">
        <Card>
          <p className="font-display text-3xl text-plum">{t("create.saveTitle")}</p>
          <p className="mt-3 text-sm leading-6 text-muted">{t("create.saveBody")}</p>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-ink px-3 py-3 text-xs leading-5 break-all text-cream">
            {rsec}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(rsec).then(() => setCopied(true));
              }}
            >
              {copied ? t("create.copied") : t("create.copyRsec")}
            </Button>
            <Button type="button" onClick={() => navigate("/")}>
              {t("create.enter")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (block) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-12">
        <Link to="/welcome" className="mb-4 text-sm text-muted hover:text-ink">
          {t("common.back")}
        </Link>
        <Card>
          <p className="font-display text-3xl text-plum">{t("create.title")}</p>
          <p className="mt-4 text-sm leading-6 text-accent">
            {block.reason === "exists"
              ? t("create.blockedExists")
              : t("create.rateLimited", { n: block.minutes })}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-12">
      <Link to="/welcome" className="mb-4 text-sm text-muted hover:text-ink">
        {t("common.back")}
      </Link>
      <Card>
        <p className="font-display text-3xl text-plum">{t("create.title")}</p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <div className="flex items-center gap-4">
            {previewUrl ? (
              <img src={previewUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <Avatar name={name} size="lg" />
            )}
            <div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  event.target.value = "";
                  if (!next) return;
                  if (!isAcceptedPhoto(next)) {
                    setError(t("errors.media_type"));
                    return;
                  }
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPictureFile(next);
                  setPreviewUrl(URL.createObjectURL(next));
                  setError(null);
                }}
              />
              <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
                {t("create.picture")}
              </Button>
            </div>
          </div>
          <TextField
            label={t("create.name")}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_CHARS))}
            placeholder="Rita"
            maxLength={MAX_NAME_CHARS}
            counter
          />
          <TextArea
            label={t("create.about")}
            rows={3}
            value={about}
            onChange={(e) => setAbout(e.target.value.slice(0, MAX_BIO_CHARS))}
            placeholder={t("create.aboutPlaceholder")}
            maxLength={MAX_BIO_CHARS}
            counter
          />
          <TextField
            label={t("create.password")}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t("create.passwordHint")}
            required
            minLength={8}
          />
          <TextField
            label={t("create.repeat")}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
          <LocalCaptcha key={captchaTick} value={captcha} onChange={onCaptcha} />
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("create.creating") : t("create.submit")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
