import { Link, useParams } from "react-router-dom";
import { NoteCard } from "@/components/note/NoteCard";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";

export function NotePage() {
  const { id } = useParams();
  const { posts, profile } = useRita();
  const { t } = useI18n();
  const note = posts.find((item) => item.sig === id);

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-line bg-paper/80 px-4 py-4 backdrop-blur">
        <Link to="/" className="text-sm text-muted hover:text-ink">
          {t("common.back")}
        </Link>
        <h1 className="font-display text-2xl">{t("note.title")}</h1>
      </header>
      {note ? (
        <NoteCard event={note} name={profile?.name} picture={profile?.picture} />
      ) : (
        <p className="px-4 py-8 text-sm text-muted">{t("note.missing")}</p>
      )}
    </section>
  );
}
