import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const styles: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-sm hover:bg-accent-dark disabled:opacity-50",
  secondary:
    "bg-paper text-ink border border-line hover:border-accent/40 disabled:opacity-50",
  ghost: "bg-transparent text-ink hover:bg-white/40 disabled:opacity-50",
  danger: "bg-transparent text-accent hover:bg-accent/10 disabled:opacity-50",
};

export function Button({ variant = "primary", className = "", children, ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
