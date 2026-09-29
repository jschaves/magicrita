import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea, TextField } from "@/components/ui/Field";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { toolsText } from "@/i18n/tools";
import { copyText } from "@/lib/protocol/native";
import { encodeSync, decodeSync, syncSummary } from "@/lib/protocol/offline";
import { proofText, verifyProof } from "@/lib/protocol/provenance";
import {
  guardianShares,
  RECOVERY_MAX_GUARDIANS,
  RECOVERY_MIN_THRESHOLD,
  shareToText,
} from "@/lib/protocol/recovery";
import { shortenId } from "@/lib/protocol/identity";

/**
 * Panel de herramientas avanzadas: procedencia verificable, sincronia sin
 * conexion y recuperacion social. Todo ocurre en el dispositivo; el relé no
 * interviene mas alla de la senalizacion normal.
 */
export function ToolsPanel() {
  const { identity, log, follows, allEvents, setupRecovery, importEnvelopes, profileOf } = useRita();
  const { locale, t } = useI18n();
  const tt = (key: Parameters<typeof toolsText>[1], vars?: Record<string, string | number>) =>
    toolsText(locale, key, vars);

  const [proof, setProof] = useState("");
  const [proofMsg, setProofMsg] = useState<string | null>(null);
  const [proofOk, setProofOk] = useState(false);

  const [sync, setSync] = useState("");
  const [incoming, setIncoming] = useState("");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const [recPassword, setRecPassword] = useState("");
  const [threshold, setThreshold] = useState(RECOVERY_MIN_THRESHOLD);
  const [picked, setPicked] = useState<string[]>([]);
  const [recMsg, setRecMsg] = useState<string | null>(null);

  const candidates = useMemo(() => follows.slice(0, RECOVERY_MAX_GUARDIANS), [follows]);
  const kept = useMemo(
    () => (identity ? guardianShares(log, identity.rpub) : []),
    [identity, log],
  );

  function checkProof() {
    const result = verifyProof(proof);
    if (result.ok) {
      setProofOk(true);
      setProofMsg(tt("valid", { author: shortenId(result.envelope.author) }));
    } else {
      setProofOk(false);
      setProofMsg(tt("invalid"));
    }
  }

  function doExport() {
    try {
      setSync(encodeSync(allEvents));
      setSyncMsg(syncSummary(allEvents).total ? null : tt("error"));
    } catch {
      setSyncMsg(tt("error"));
    }
  }

  function doImport() {
    try {
      const list = decodeSync(incoming);
      const summary = syncSummary(list);
      const authors = importEnvelopes(list);
      setSyncMsg(tt("imported", { authors, total: summary.total }));
    } catch {
      setSyncMsg(tt("error"));
    }
  }

  async function doSetup() {
    setRecMsg(null);
    try {
      const guardians = picked.slice(0, RECOVERY_MAX_GUARDIANS);
      const m = Math.min(Math.max(threshold, RECOVERY_MIN_THRESHOLD), guardians.length);
      const n = await setupRecovery(recPassword, guardians, m);
      setRecMsg(tt("created", { n }));
    } catch {
      setRecMsg(tt("error"));
    }
  }

  function exportProof() {
    const envelope = [...allEvents]
      .reverse()
      .find((item) => item.author === identity?.rpub && item.type === "post");
    if (!envelope) return;
    void copyText(proofText(envelope));
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-xl">{tt("title")}</h2>
      </div>
      <p className="text-sm text-muted">{tt("notice")}</p>

      <div className="space-y-3">
        <h3 className="font-display text-lg">{tt("provenance")}</h3>
        <p className="text-sm text-muted">{tt("provenanceHint")}</p>
        <TextArea
          label={tt("provenance")}
          rows={3}
          value={proof}
          onChange={(e) => setProof(e.target.value)}
          placeholder={tt("proofPlaceholder")}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={checkProof} disabled={!proof.trim()}>
            {tt("verify")}
          </Button>
          <Button type="button" variant="ghost" onClick={exportProof}>
            {tt("copyProof")}
          </Button>
        </div>
        {proofMsg ? (
          <p className={`text-sm ${proofOk ? "text-plum" : "text-accent"}`}>{proofMsg}</p>
        ) : null}
      </div>

      <div className="space-y-3">
        <h3 className="font-display text-lg">{tt("offline")}</h3>
        <p className="text-sm text-muted">{tt("offlineHint")}</p>
        <TextArea
          label={tt("export")}
          rows={3}
          value={sync}
          onChange={(e) => setSync(e.target.value)}
          placeholder={tt("proofPlaceholder")}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={doExport}>
            {tt("export")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!sync}
            onClick={() => void copyText(sync)}
          >
            {t("common.copy")}
          </Button>
        </div>
        <TextArea
          label={tt("import")}
          rows={3}
          value={incoming}
          onChange={(e) => setIncoming(e.target.value)}
        />
        <Button type="button" onClick={doImport} disabled={!incoming.trim()}>
          {tt("import")}
        </Button>
        {syncMsg ? <p className="text-sm text-plum">{syncMsg}</p> : null}
      </div>

      <div className="space-y-3">
        <h3 className="font-display text-lg">{tt("recovery")}</h3>
        <p className="text-sm text-muted">{tt("recoveryHint")}</p>
        <p className="text-xs text-muted">{tt("recoverySetupHint")}</p>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted">{tt("noContacts")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {candidates.map((rpub) => {
                const active = picked.includes(rpub);
                return (
                  <button
                    key={rpub}
                    type="button"
                    onClick={() =>
                      setPicked((prev) =>
                        prev.includes(rpub) ? prev.filter((item) => item !== rpub) : [...prev, rpub],
                      )
                    }
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      active ? "bg-accent text-white" : "border border-line bg-paper text-ink hover:border-accent/40"
                    }`}
                  >
                    {profileOf(rpub)?.name || shortenId(rpub)}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <TextField
                label={tt("threshold")}
                type="number"
                min={RECOVERY_MIN_THRESHOLD}
                max={Math.max(RECOVERY_MIN_THRESHOLD, picked.length)}
                value={String(threshold)}
                onChange={(e) => setThreshold(Number(e.target.value) || RECOVERY_MIN_THRESHOLD)}
                className="w-28"
              />
              <TextField
                label={tt("recoveryPassword")}
                type="password"
                value={recPassword}
                onChange={(e) => setRecPassword(e.target.value)}
                hint={tt("recoveryPasswordHint")}
                autoComplete="new-password"
              />
            </div>
            <Button
              type="button"
              onClick={doSetup}
              disabled={picked.length < RECOVERY_MIN_THRESHOLD || recPassword.length < 10}
            >
              {tt("setup")}
            </Button>
          </>
        )}
        {recMsg ? <p className="text-sm text-plum">{recMsg}</p> : null}

        {kept.length > 0 ? (
          <div className="space-y-2 rounded-2xl border border-line bg-paper p-3">
            <p className="text-sm font-semibold">{tt("yourShares")}</p>
            <p className="text-xs text-muted">{tt("yourSharesHint")}</p>
            <ul className="space-y-2">
              {kept.map((env) => (
                <li key={env.sig} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-muted">
                    {shortenId(env.body.owner)} · {env.body.index}/{env.body.total}
                  </span>
                  <Button type="button" variant="ghost" onClick={() => void copyText(shareToText(env))}>
                    {tt("copyShare")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
