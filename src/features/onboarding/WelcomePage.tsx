import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { FileUp, KeyRound, Lock, Network, PenLine, Radio, Sparkles, type LucideIcon } from "lucide-react";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { LanguageSwitch } from "@/components/ui/LanguageSwitch";
import { SiteMark } from "@/components/ui/SiteMark";
import { createBlock } from "@/lib/protocol/signupGuard";
import { betaInviteRequired, loadBetaInvite, redeemBetaInvite } from "@/lib/protocol/betaInvite";

export function WelcomePage() {
  const { status, importBundleFile } = useRita();
  const { t, errorMessage } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needInvite, setNeedInvite] = useState(false);
  const [invite, setInvite] = useState(() => loadBetaInvite());

  useEffect(() => {
    void betaInviteRequired().then(setNeedInvite);
  }, []);

  if (status === "ready") return <Navigate to="/" replace />;
  if (status === "locked") return <Navigate to="/unlock" replace />;

  const signup = createBlock();

  async function onPortable(file: File) {
    setBusy(true);
    setError(null);
    try {
      if (needInvite) await redeemBetaInvite(invite);
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-4 py-12">
      <LanguageSwitch className="mb-8" />
      <SiteMark size="lg" github />
      <WelcomeNote icon={Network} title={t("welcome.tagline")} body={t("welcome.pitch")} first />
      <WelcomeNote icon={Radio} title={t("welcome.relayTitle")} body={t("welcome.relayBody")} />
      <WelcomeNote icon={Lock} title={t("welcome.chatTitle")} body={t("welcome.chatBody")} />
      <WelcomeNote icon={PenLine} title={t("welcome.postsTitle")} body={t("welcome.postsBody")} />

      {needInvite ? (
        <div className="mt-6 max-w-xl">
          <TextField
            label={t("create.inviteCode")}
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            hint={t("create.inviteHint")}
          />
        </div>
      ) : null}

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <Card>
          <Sparkles className="text-accent" />
          <h2 className="mt-3 font-display text-xl">{t("welcome.createTitle")}</h2>
          <p className="mt-2 text-sm text-muted">{t("welcome.createBody")}</p>
          {signup ? (
            <p className="mt-5 text-sm text-accent">
              {signup.reason === "exists"
                ? t("create.blockedExists")
                : t("create.rateLimited", { n: signup.minutes })}
            </p>
          ) : (
            <Link to="/welcome/create" className="mt-5 block">
              <Button className="w-full">{t("welcome.start")}</Button>
            </Link>
          )}
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
      <p className="mt-3 text-sm">
        <Link to="/legal" className="font-semibold text-accent hover:underline">
          {t("legal.link")}
        </Link>
      </p>
      </div>
    </div>
  );
}

function WelcomeNote({
  icon: Icon,
  title,
  body,
  first,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  first?: boolean;
}) {
  return (
    <div className={`${first ? "mt-6" : "mt-4"} max-w-xl rounded-3xl border border-line bg-paper/80 p-4`}>
      <p className="flex items-center gap-2 font-display text-lg text-plum">
        <Icon size={18} className="text-gold" />
        {title}
      </p>
      <div className="welcome-pitch mt-2 max-h-28 overflow-y-auto pr-2 text-sm leading-6 text-muted sm:max-h-36">
        {body}
      </div>
    </div>
  );
}
