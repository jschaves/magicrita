import { apiUrl } from "./apiBase";

export const SITE_NAME = "MagicRita";
export const LOGO_MAX_BYTES = 1_000_000;
// Sin SVG a proposito: el logo se sirve en linea con su propio Content-Type, y
// un SVG con <script> se ejecutaria en el origen de la app con acceso al
// storage. El relay tambien lo rechaza.
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type BrandInfo = {
  logo: boolean;
  mime?: string;
  updated?: number;
};

const EVENT = "magicrita-brand";

export async function fetchBrand(): Promise<BrandInfo> {
  try {
    const res = await fetch(apiUrl("/brand"));
    if (!res.ok) return { logo: false };
    const data = (await res.json()) as BrandInfo;
    return {
      logo: Boolean(data.logo),
      mime: typeof data.mime === "string" ? data.mime : undefined,
      updated: typeof data.updated === "number" ? data.updated : undefined,
    };
  } catch {
    return { logo: false };
  }
}

export function logoUrl(updated?: number): string {
  return typeof updated === "number" && updated > 0
    ? `${apiUrl("/brand/logo")}?t=${updated}`
    : apiUrl("/brand/logo");
}

export function notifyBrandChange(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onBrandChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function mimeFromFile(file: File): string {
  if (file.type && (LOGO_TYPES as readonly string[]).includes(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "";
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}
