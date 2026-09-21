import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type FieldProps = {
  label: string;
  hint?: string;
};

export function TextField({
  label,
  hint,
  className = "",
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      <input
        className={`w-full rounded-2xl border border-line bg-paper px-3.5 py-2.5 text-ink outline-none ring-accent/30 placeholder:text-muted/70 focus:ring-2 ${className}`}
        {...props}
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function TextArea({
  label,
  hint,
  className = "",
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      <textarea
        className={`w-full rounded-2xl border border-line bg-paper px-3.5 py-2.5 text-ink outline-none ring-accent/30 placeholder:text-muted/70 focus:ring-2 ${className}`}
        {...props}
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
