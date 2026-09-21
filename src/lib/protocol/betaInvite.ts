import { ProtocolError } from "./errors";

const KEY = "magicrita.betaInvite";

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

export async function redeemBetaInvite(code: string): Promise<void> {
  const invite = code.trim();
  const res = await fetch("/beta/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invite }),
  });
  if (res.status === 403) throw new ProtocolError("invite_bad");
  if (!res.ok) throw new ProtocolError("invite_required");
  if (invite) saveBetaInvite(invite);
}

export async function assertBetaInvite(): Promise<void> {
  if (!(await betaInviteRequired())) return;
  const code = loadBetaInvite();
  if (!code) throw new ProtocolError("invite_required");
  await redeemBetaInvite(code);
}
