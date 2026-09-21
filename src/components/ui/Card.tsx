import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-line bg-paper/90 p-6 shadow-[0_12px_40px_rgba(42,21,32,0.06)] ${className}`}>
      {children}
    </div>
  );
}
