import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { WipeConfirm } from "@/components/ui/WipeConfirm";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { TextArea, TextField } from "@/components/ui/Field";
import { Avatar } from "@/components/note/Avatar";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { ingestPhoto, isAcceptedPhoto } from "@/lib/protocol/media";

export function SettingsPage() {
  const {
    identity,
    profile,
    logout,
    wipeIdentity,
    publishProfile,
    exportBackup,
    importBundleFile,
  } = useRita();
  const { t, errorMessage } = useI18n();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const bundleRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile?.name ?? "");
  const [about, setAbout] = useState(profile?.about ?? "");
  const [interests, setInterests] = useState((profile?.interests ?? []).join(", "));
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);

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

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <h1 className="font-display text-2xl">{t("settings.title")}</h1>
      </header>
      <div className="space-y-8 p-4">
        <div>
          <h2 className="font-display text-xl">{t("settings.language")}</h2>
          <p className="mt-1 text-sm text-muted">{t("settings.languageHint")}</p>
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

        <form className="space-y-3" onSubmit={(event) => void onProfile(event)}>
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
          <TextField label={t("settings.name")} value={name} onChange={(e) => setName(e.target.value)} />
          <TextArea
            label={t("settings.about")}
            rows={3}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />
          <TextField
            label={t("settings.interests")}
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            hint={t("settings.interestsHint")}
          />
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? t("compose.saving") : t("settings.signProfile")}
          </Button>
        </form>

        {message ? <p className="text-sm text-plum">{message}</p> : null}

        <div className="space-y-3">
          <h2 className="font-display text-xl">{t("bundle.title")}</h2>
          <p className="text-sm text-muted">{t("bundle.hint")}</p>
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
                void importBundleFile(next)
                  .then(() => setMessage(t("bundle.imported")))
                  .catch((err) => setError(errorMessage(err, "people.importFailed")));
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
          <p className="text-xs text-muted">{t("settings.logoutHint")}</p>
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
              <p className="text-xs text-muted">{t("settings.deleteHint")}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
