import { Link, useParams } from "react-router-dom";
import { NoteCard } from "@/components/note/NoteCard";
import { Button } from "@/components/ui/Button";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { toolsText } from "@/i18n/tools";
import { copyText } from "@/lib/protocol/native";
import { attestationsOf, proofText } from "@/lib/protocol/provenance";

export function NotePage() {
  const { id } = useParams();
  const { posts, identity, allEvents, attest, profileOf } = useRita();
  const { t, locale } = useI18n();
  const note = posts.find((item) => item.sig === id);
  const attesters = note ? attestationsOf(allEvents, note.sig) : [];

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <Link to="/" className="text-sm text-muted hover:text-ink">
          {t("common.back")}
        </Link>
        <h1 className="font-display text-2xl">{t("note.title")}</h1>
      </header>
      {note ? (
        <>
          <NoteCard event={note} name={profileOf(note.author)?.name} picture={profileOf(note.author)?.picture} />
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Button type="button" variant="secondary" onClick={() => void copyText(proofText(note))}>
              {toolsText(locale, "copyProof")}
            </Button>
            {identity && note.author !== identity.rpub ? (
              <Button type="button" variant="ghost" onClick={() => attest(note.sig)}>
                {toolsText(locale, "attest")}
              </Button>
            ) : null}
            {attesters.length > 0 ? (
              <span className="text-xs text-muted">
                {toolsText(locale, "attestedBy", { n: attesters.length })}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="px-4 py-8 text-sm text-muted">{t("note.missing")}</p>
      )}
    </section>
  );
}
