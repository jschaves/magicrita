import { sanitizeAdminPath } from "./sanitizeAdminPath";

export const ADMIN_PATH = sanitizeAdminPath(import.meta.env.VITE_ADMIN_PATH);

export function adminHref(): string {
  return `/${ADMIN_PATH}`;
}
