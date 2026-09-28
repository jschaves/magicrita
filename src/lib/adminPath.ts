import { parseAdminPath, sanitizeAdminPath } from "./sanitizeAdminPath";
import { apiUrl } from "./protocol/apiBase";

/**
 * La ruta viene del build (VITE_ADMIN_PATH), pero la que manda es la que guarde
 * el admin en el relay. Por eso se pregunta al servidor: si no, cambiar la ruta
 * exigiria recompilar, y el bundle público lleva la ruta dentro de todas formas.
 */
const BUILD_PATH = sanitizeAdminPath(import.meta.env.VITE_ADMIN_PATH);

let current = BUILD_PATH;
let asked = false;

export function currentAdminPath(): string {
  return current;
}

export async function loadAdminPath(): Promise<string> {
  if (asked) return current;
  try {
    const res = await fetch(apiUrl("/admin-path"), { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { path?: unknown };
      // `parseAdminPath` devuelve null en vez del valor por defecto a proposito:
      // si el relay devolviera algo invalido, caer en el del build volveria a
      // abrir la ruta antigua.
      const next = parseAdminPath(typeof data.path === "string" ? data.path : "");
      if (next) current = next;
      else console.warn("[admin] /admin-path no devolvio una ruta valida; se usa la del build");
    } else {
      console.warn(`[admin] /admin-path respondio ${res.status}; se usa la ruta del build`);
    }
  } catch (err) {
    // Sin relay no hay ruta que consultar: nos quedamos con la del build. Se
    // avisa, porque si falla en silencio la ruta nueva parece no funcionar.
    console.warn("[admin] no se pudo consultar /admin-path; se usa la ruta del build", err);
  }
  asked = true;
  return current;
}