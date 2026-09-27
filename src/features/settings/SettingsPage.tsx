import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { WipeConfirm } from "@/components/ui/WipeConfirm";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { TextArea, TextField } from "@/components/ui/Field";
import { Avatar } from "@/components/note/Avatar";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { ingestPhoto, isAcceptedPhoto } from "@/lib/protocol/media";
import { MAX_BIO_CHARS, MAX_NAME_CHARS } from "@/lib/protocol/envelope";
import { MobileDock } from "@/components/ui/MobileDock";
import { useVisualViewport } from "@/lib/useVisualViewport";
import { InfoButton } from "@/components/ui/InfoButton";
import { betaInviteRequired, loadBetaInvite } from "@/lib/protocol/betaInvite";

export function SettingsPage() {
  const {
    identity,
    profile,
    logout,
    changePassword,
    wipeIdentity,
    publishProfile,
    exportBackup,
    importBundleFile,
  } = useRita();
  const { t, errorMessage } = useI18n();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const bundleRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState((profile?.name ?? "").slice(0, MAX_NAME_CHARS));
  const [about, setAbout] = useState((profile?.about ?? "").slice(0, MAX_BIO_CHARS));
  const [interests, setInterests] = useState((profile?.interests ?? []).join(", "));
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [needInvite, setNeedInvite] = useState(true);
  const [invite, setInvite] = useState(() => loadBetaInvite());
  const [curPassword, setCurPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const view = useVisualViewport();
  const pinSave = view.mobile && view.keyboard;

  useEffect(() => {
    void betaInviteRequired().then(setNeedInvite);
  }, []);

  function pickFile(list: FileList | null) {
    const next = list?.[0];
    if (!next) return;
    if (!isAcceptedPhoto(next)) {
      setError(t("errors.media_type"));
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setRemoved(false);
    setError(null);
  }

  async function onProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let picture = removed ? undefined : profile?.picture;
      if (file) picture = await ingestPhoto(file);
      publishProfile({
        name,
        about,
        picture,
        interests: interests
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setMessage(t("settings.signed"));
    } catch (err) {
      setError(errorMessage(err, "compose.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onChangePassword(event: FormEvent) {
    event.preventDefault();
    setPwError(null);
    if (newPassword !== confirmPassword) {
      setPwError(t("create.mismatch"));
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(curPassword, newPassword);
      // Se cambia la bóveda, así que se saca al usuario para que entre con la
      // nueva contraseña.
      logout();
      navigate("/unlock");
    } catch (err) {
      setPwError(errorMessage(err, "settings.passwordFailed"));
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl">{t("settings.title")}</h1>
          <InfoButton title={t("settings.title")} body={t("info.settings")} />
        </div>
      </header>
      <div className="space-y-8 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl">{t("settings.language")}</h2>
            <InfoButton title={t("settings.language")} body={t("settings.languageHint")} />
          </div>
          <LanguageSwitch className="mt-3" showLabel={false} />
        </div>

        <div>
          <h2 className="font-display text-xl">{t("settings.identity")}</h2>
          <p className="mt-1 break-all text-sm text-muted">{identity?.rpub}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowSecret((v) => !v)}>
              {showSecret ? t("settings.hideRsec") : t("settings.showRsec")}
            </Button>
            {showSecret && identity ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void navigator.clipboard.writeText(identity.rsec)}
              >
                {t("common.copy")}
              </Button>
            ) : null}
          </div>
          {showSecret && identity ? (
            <pre className="mt-3 overflow-x-auto rounded-2xl bg-ink px-3 py-3 text-xs break-all text-cream">
              {identity.rsec}
            </pre>
          ) : null}
        </div>

        <form id="profile-form" className="space-y-3" onSubmit={(event) => void onProfile(event)}>
          <h2 className="font-display text-xl">{t("settings.publicProfile")}</h2>
          <div className="flex items-center gap-4">
            {previewUrl ? (
              <img src={previewUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
            ) : removed ? (
              <Avatar name={name} size="lg" />
            ) : (
              <Avatar name={name || profile?.name} picture={profile?.picture} size="lg" />
            )}
            <div className="flex flex-col gap-2">
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={(event) => {
                  pickFile(event.target.files);
                  event.target.value = "";
                }}
              />
              <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
                {t("settings.changePicture")}
              </Button>
              {(previewUrl || (!removed && profile?.picture)) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                    setFile(null);
                    setRemoved(true);
                  }}
                >
                  {t("settings.removePicture")}
                </Button>
              )}
            </div>
          </div>
          <TextField
            label={t("settings.name")}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_CHARS))}
            maxLength={MAX_NAME_CHARS}
            counter
          />
          <TextArea
            label={t("settings.about")}
            rows={3}
            value={about}
            onChange={(e) => setAbout(e.target.value.slice(0, MAX_BIO_CHARS))}
            maxLength={MAX_BIO_CHARS}
            counter
          />
          <TextField
            label={t("settings.interests")}
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            hint={t("settings.interestsHint")}
          />
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" disabled={busy} className={pinSave ? "hidden" : ""}>
            {busy ? t("compose.saving") : t("settings.signProfile")}
          </Button>
        </form>
        <MobileDock enabled={pinSave} role="composer" className="border-t border-line p-3">
          <Button type="submit" form="profile-form" disabled={busy} className="w-full">
            {busy ? t("compose.saving") : t("settings.signProfile")}
          </Button>
        </MobileDock>

        {message ? <p className="text-sm text-plum">{message}</p> : null}

        <form className="space-y-3" onSubmit={(event) => void onChangePassword(event)}>
          <h2 className="font-display text-xl">{t("settings.changePassword")}</h2>
          <TextField
            label={t("settings.currentPassword")}
            type="password"
            autoComplete="current-password"
            value={curPassword}
            onChange={(e) => setCurPassword(e.target.value)}
            required
          />
          <TextField
            label={t("settings.newPassword")}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint={t("create.passwordHint")}
            required
            minLength={8}
          />
          <TextField
            label={t("create.repeat")}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
          {pwError ? <p className="text-sm text-accent">{pwError}</p> : null}
          <Button type="submit" variant="secondary" disabled={pwBusy}>
            {pwBusy ? t("compose.saving") : t("settings.changePasswordSubmit")}
          </Button>
        </form>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl">{t("bundle.title")}</h2>
            <InfoButton title={t("bundle.title")} body={t("bundle.hint")} />
          </div>
          {needInvite ? (
            <TextField
              label={t("create.inviteCode")}
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              hint={t("create.inviteHint")}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void exportBackup().then(() => setMessage(t("bundle.exportedBackup")))}
            >
              {t("bundle.exportBackup")}
            </Button>
            <input
              ref={bundleRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const next = event.target.files?.[0];
                event.target.value = "";
                if (!next) return;
                void importBundleFile(next, undefined, invite)
                  .then(() => setMessage(t("bundle.imported")))
                  .catch((err) => {
                    setError(errorMessage(err, "people.importFailed"));
                    // Codigo invalido o caducado: se vacia para pedir otro.
                    if (err instanceof Error && err.message.startsWith("invite")) setInvite("");
                  });
              }}
            />
            <Button type="button" onClick={() => bundleRef.current?.click()}>
              {t("bundle.import")}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              logout();
              navigate("/unlock");
            }}
          >
            {t("settings.logout")}
          </Button>
          <InfoButton title={t("settings.logout")} body={t("settings.logoutHint")} />
          {wipeOpen ? (
            <WipeConfirm
              onConfirm={() => {
                void wipeIdentity().then(() => navigate("/welcome"));
              }}
              onCancel={() => setWipeOpen(false)}
            />
          ) : (
            <>
              <Button type="button" variant="danger" className="w-full" onClick={() => setWipeOpen(true)}>
                {t("settings.delete")}
              </Button>
              <InfoButton title={t("settings.delete")} body={t("settings.deleteHint")} />
            </>
          )}
        </div>
        <p>
          <Link to="/legal" className="text-sm font-semibold text-accent hover:underline">
            {t("legal.link")}
          </Link>
        </p>
      </div>
    </section>
  );
}
