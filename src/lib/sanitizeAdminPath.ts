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

export function sanitizeAdminPath(raw: string | undefined): string {
  const value = String(raw ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) return DEFAULT_ADMIN_PATH;
  if (RESERVED.has(value.toLowerCase())) return DEFAULT_ADMIN_PATH;
  return value;
}
