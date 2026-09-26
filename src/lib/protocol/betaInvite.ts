import { ProtocolError } from "./errors";

const KEY = "magicrita.betaInvite";
const AT_KEY = "magicrita.betaInviteAt";

/**
 * Ventana en la que un código recién validado no se vuelve a preguntar al
 * relay. La pestaña que redime y el proveedor que importa llaman casi seguidos:
 * sin esto cada intento gastaba dos peticiones del límite por IP, que es de 10
 * cada 10 minutos, y el usuario legítimo se quedaba fuera sin haber fallado.
 */
const REUSE_MS = 60 * 1000;

export function loadBetaInvite(): string {
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveBetaInvite(code: string): void {
  localStorage.setItem(KEY, code.trim());
}

/** Descarta el codigo guardado (y el sello de "recien validado"). */
export function clearBetaInvite(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(AT_KEY);
  } catch {
    // ignore
  }
}

export async function betaInviteRequired(): Promise<boolean> {
  try {
    const res = await fetch("/beta");
    if (!res.ok) return false;
    const data = (await res.json()) as { required?: boolean };
    return Boolean(data.required);
  } catch {
    return false;
  }
}

function markRedeemed(code: string): void {
  try {
    localStorage.setItem(AT_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // sin el sello solo se pierde la deduplicación, no la redempción
  }
}

function recentlyRedeemed(code: string): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(AT_KEY) || "null") as
      | { code?: string; at?: number }
      | null;
    return Boolean(raw && raw.code === code && Date.now() - (raw.at ?? 0) < REUSE_MS);
  } catch {
    return false;
  }
}

export async function redeemBetaInvite(code: string): Promise<void> {
  const invite = code.trim();
  if (!invite) throw new ProtocolError("invite_required");
  const res = await fetch("/beta/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invite }),
  });
  if (res.status === 403) {
    // El codigo ya no vale (revocado o borrado): si es el que teniamos
    // guardado, se descarta para que la proxima vez pidan uno nuevo en vez de
    // reintentar el mismo.
    if (loadBetaInvite() === invite) clearBetaInvite();
    throw new ProtocolError("invite_bad");
  }
  // El relay corta por IP tras varios intentos. Antes esto se mostraba como
  // "falta el código", que confundía justo cuando hacía falta esperar.
  if (res.status === 429) throw new ProtocolError("invite_rate");
  if (!res.ok) throw new ProtocolError("invite_required");
  if (invite) {
    saveBetaInvite(invite);
    markRedeemed(invite);
  }
}

/**
 * Comprueba la beta. Acepta el código que el usuario acaba de escribir para no
 * depender de que la pestaña lo haya guardado antes: si el sondeo de `needInvite`
 * aún no había vuelto, el campo podía estar oculto y el código se perdía.
 */
export async function assertBetaInvite(code?: string): Promise<void> {
  if (!(await betaInviteRequired())) return;
  const invite = (code ?? "").trim() || loadBetaInvite();
  if (!invite) throw new ProtocolError("invite_required");
  if (recentlyRedeemed(invite)) return;
  await redeemBetaInvite(invite);
}
