import { useState, type FormEvent } from "react";
import { Avatar } from "@/components/note/Avatar";
import { Button } from "@/components/ui/Button";
import { CharCount } from "@/components/ui/Field";
import { EmojiInsert } from "@/components/ui/EmojiInsert";
import { useRita } from "@/context/RitaProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { toolsText, type ToolsKey } from "@/i18n/tools";
import { shortenId } from "@/lib/protocol/identity";
import {
  LIVE_CHAT_MAX_CHARS,
  LIVE_REACTION_EMOJIS,
  sendLiveChat,
  sendLiveReaction,
  type LiveChatMessage,
  type LiveReaction,
} from "@/lib/protocol/live";

/** Cuántos comentarios se ven a la vez en el directo. */
const LIVE_CHAT_VISIBLE = 3;

/**
 * Chat efímero de un directo: hasta tres comentarios (con avatar) anclados a la
 * derecha sobre el vídeo, y reacciones con emoji + avatar que flotan hacia
 * arriba y desaparecen. Nada se guarda en el dispositivo ni en el relé; el
 * emisor reenvía lo que mandan los espectadores.
 */
export function LiveChat({
  chat,
  reactions,
  canWrite,
}: {
  chat: LiveChatMessage[];
  reactions: LiveReaction[];
  canWrite: boolean;
}) {
  const { profileOf, personByRpub } = useRita();
  const { locale } = useI18n();
  const tt = (key: ToolsKey, vars?: Record<string, string | number>) => toolsText(locale, key, vars);
  const [text, setText] = useState("");

  const visible = chat.slice(-LIVE_CHAT_VISIBLE);
  const infoOf = (from: string) => {
    const p = profileOf(from);
    // Un par comparte su avatar (data URL) por el canal P2P; se pinta al
    // instante sin esperar a la foto completa.
    const src = personByRpub(from)?.avatarUrl;
    return { name: p?.name || shortenId(from), picture: p?.picture, src };
  };

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    sendLiveChat(value);
    setText("");
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[85] overflow-hidden">
      {/* Reacciones flotantes: emoji + avatar subiendo por la banda derecha. */}
      <div className="absolute inset-y-0 right-0 w-40 overflow-hidden">
        {reactions.map((reaction) => {
          const info = infoOf(reaction.from);
          return (
            <div
              key={reaction.key}
              className="rita-reaction absolute bottom-0 flex items-center gap-1.5"
              style={{ right: `${reaction.x}%` }}
              aria-hidden
            >
              <span className="text-2xl drop-shadow">{reaction.emoji}</span>
              <Avatar name={info.name} picture={info.picture} src={info.src} size="sm" />
            </div>
          );
        })}
      </div>

      {/* Comentarios: máximo tres, anclados abajo a la derecha, con avatar. En
          pantallas anchas se separan a la izquierda de la banda de reacciones
          para que los emojis flotantes no se superpongan al primer mensaje. */}
      <div className="absolute bottom-32 right-2 z-10 flex w-56 flex-col items-end gap-1.5 sm:right-44 sm:w-64">
        {visible.map((message) => {
          const info = infoOf(message.from);
          return (
            <div key={message.key} className="pointer-events-auto flex max-w-full items-start gap-2">
              <Avatar name={info.name} picture={info.picture} src={info.src} size="sm" />
              <div className="min-w-0 max-w-[12rem] rounded-2xl rounded-tl-sm bg-ink/60 px-2.5 py-1.5 backdrop-blur">
                <p className="truncate text-[11px] font-semibold text-cream/80">{info.name}</p>
                <p className="break-words text-sm leading-5 text-white">{message.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Entrada y reacciones: barra inferior derecha, pulsable. */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-16 px-3">
        <div className="ml-auto flex w-full max-w-md flex-col items-stretch gap-2">
          <div className="flex items-center justify-end gap-1">
            {LIVE_REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => sendLiveReaction(emoji)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/50 text-lg backdrop-blur transition hover:bg-ink/70"
                aria-label={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
          {canWrite ? (
            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-line bg-paper/95 px-2 py-1 backdrop-blur">
                <EmojiInsert
                  value={text}
                  max={LIVE_CHAT_MAX_CHARS}
                  onChange={setText}
                />
                <input
                  value={text}
                  onChange={(event) => setText(event.target.value.slice(0, LIVE_CHAT_MAX_CHARS))}
                  maxLength={LIVE_CHAT_MAX_CHARS}
                  placeholder={tt("liveChatPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-ink outline-none placeholder:text-muted/70"
                />
                <CharCount value={text} max={LIVE_CHAT_MAX_CHARS} />
              </div>
              <Button type="submit" variant="secondary" disabled={!text.trim()} className="shrink-0">
                {tt("liveChatSend")}
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
