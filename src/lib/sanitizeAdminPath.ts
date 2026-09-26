const DEFAULT_ADMIN_PATH = "topogue";

const RESERVED = new Set([
  "welcome",
  "unlock",
  "legal",
  "people",
  "saved",
  "protocolo",
  "discover",
  "compose",
  "messages",
  "settings",
  "n",
  "p",
  "brand",
  "beta",
  "signal",
  "admin-api",
  "moderation",
  "assets",
]);

export function parseAdminPath(raw: string | undefined): string | null {
  const value = String(raw ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) return null;
  if (RESERVED.has(value.toLowerCase())) return null;
  return value;
}

export function sanitizeAdminPath(raw: string | undefined): string {
  return parseAdminPath(raw) ?? DEFAULT_ADMIN_PATH;
}
