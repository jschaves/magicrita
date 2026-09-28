/**
 * Base de la API HTTP del relé (`/beta`, `/brand`, `/moderation/check`, ...).
 *
 * En la web es cadena vacía: las rutas relativas caen en el mismo origen donde
 * vive la SPA y el relé. En el APK no: dentro del WebView el origen es la propia
 * app, así que una ruta relativa nunca llegaría al relé externo. Ahí
 * `VITE_API_BASE` apunta a la URL absoluta del servidor (por ejemplo
 * `https://magicrita.com`).
 */
const RAW = (import.meta.env.VITE_API_BASE ?? "").trim().replace(/\/+$/, "");

export const API_BASE = RAW;

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) return `${RAW}/${path}`;
  return `${RAW}${path}`;
}
