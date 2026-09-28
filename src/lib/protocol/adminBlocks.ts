import { apiUrl } from "./apiBase";

export type StaffBlocks = { users: string[]; comments: string[] };

const empty: StaffBlocks = { users: [], comments: [] };

/** El relay corta cada lote; el cliente manda varios y va acumulando. */
export const MOD_CHECK_CHUNK = 400;

/**
 * El relay ya no publica la lista de moderacion: solo responde si los items que
 * le preguntas estan bloqueados. Se consulta por lo que el cliente ya tiene,
 * que es publico de todas formas, y nunca por el resto.
 */
export async function checkStaffBlocks(
  rpubs: string[],
  sigs: string[],
): Promise<StaffBlocks> {
  if (!rpubs.length && !sigs.length) return empty;
  try {
    const res = await fetch(apiUrl("/moderation/check"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rpubs, sigs }),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as StaffBlocks;
    return {
      users: Array.isArray(data.users) ? data.users : [],
      comments: Array.isArray(data.comments) ? data.comments : [],
    };
  } catch {
    return empty;
  }
}
