import { Bookmark, Flag, Heart, MessageCircle } from "lucide-react";

export function HeartButton({
  count,
  mine,
  onClick,
}: {
  count: number;
  mine: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-sm ${mine ? "text-accent" : "text-muted hover:text-accent"}`}
    >
      <Heart size={16} fill={mine ? "currentColor" : "none"} />
      {count}
    </button>
  );
}

export function SaveButton({ saved, onClick, label }: { saved: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-sm ${saved ? "text-plum" : "text-muted hover:text-ink"}`}
    >
      <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
      {label}
    </button>
  );
}

export function CommentButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <MessageCircle size={16} />
      {count}
    </button>
  );
}

export function ReportButton({
  done,
  onClick,
  label,
  reviewing,
}: {
  done: boolean;
  onClick: () => void;
  label: string;
  reviewing?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-sm ${done ? "text-accent" : "text-muted hover:text-accent"}`}
      >
        <Flag size={16} fill={done ? "currentColor" : "none"} />
        {label}
      </button>
      {done && reviewing ? <span className="text-xs text-plum">{reviewing}</span> : null}
    </span>
  );
}
