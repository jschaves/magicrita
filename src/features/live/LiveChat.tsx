import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

/**
 * Chat efímero de un directo: comentarios (con avatar) subiendo por la derecha
 * y reacciones con emoji que flotan y desaparecen. Nada se guarda en el
 * dispositivo ni en el relé; el emisor reenvía lo que mandan los espectadores.
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
  const { profileOf } = useRita();
  const { locale } = useI18n();
  const tt = (key: ToolsKey, vars?: Record<string, string | number>) => toolsText(locale, key, vars);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chat.length]);

  const authors = useMemo(
    () => new Map(chat.map((item) => [item.from, profileOf(item.from)])),
    [chat, profileOf],
  );

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    sendLiveChat(value);
    setText("");
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[85] overflow-hidden">
      {/* Reacciones flotantes: suben por la banda derecha. */}
      <div className="absolute inset-y-0 right-0 w-24 overflow-hidden">
        {reactions.map((reaction) => (
          <span
            key={reaction.key}
            className="rita-reaction absolute bottom-0 select-none text-3xl drop-shadow"
            style={{ right: `${reaction.x}%` }}
            aria-hidden
          >
            {reaction.emoji}
          </span>
        ))}
      </div>

      {/* Comentarios: banda derecha, encima del vídeo, con avatar. */}
      <div
        ref={listRef}
        className="pointer-events-none absolute inset-y-0 right-0 flex max-h-full w-56 flex-col gap-1.5 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-64"
      >
        {chat.map((message) => {
          const name = authors.get(message.from)?.name || shortenId(message.from);
          return (
            <div key={message.key} className="pointer-events-auto flex items-start gap-2">
              <Avatar name={name} picture={authors.get(message.from)?.picture} size="sm" />
              <div className="min-w-0 rounded-2xl rounded-tl-sm bg-ink/55 px-2.5 py-1.5 backdrop-blur">
                <p className="truncate text-[11px] font-semibold text-cream/80">{name}</p>
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
