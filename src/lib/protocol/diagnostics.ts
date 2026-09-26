/**
 * Registro de diagnostico del ensamblado de media.
 *
 * El guardia de `n` (ver MAX_CHUNKS en mesh.ts) existe porque un par hostil
 * podia mandar `n: 2000000000` y `Array(n)` + `parts.some(...)` congelaba el
 * hilo principal del navegador unos 27 s. Este modulo deja constancia de cada
 * paquete descartado para poder comprobarlo navigating en local, no solo leyendo
 * el codigo: el panel de administracion lo muestra y `window.__magicritaDiag`
 * lo deja leer desde la consola.
 */

export type AssemblyVia = "ws-blob" | "dc-media" | "dc-env" | "dc-preview";

export type AssemblyEvent = {
  at: number;
  via: AssemblyVia;
  /** `n` que declaraba el emisor. */
  n: number;
  i: number;
  /** Tope que hay en el codigo. */
  cap: number;
  verdict: "rechazado" | "aceptado";
  /** Por que se rechazo, o que se abrio un slot. */
  motivo: string;
  /** Milisegundos que tardo la ruta en decideirse. */
  ms: number;
  /** De donde vino el paquete, para distinguir red de data channel. */
  origen: string;
};

const MAX_EVENTS = 300;
const events: AssemblyEvent[] = [];
const counters = { rechazados: 0, aceptados: 0, ultimoRechazo: 0 };

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function noteAssembly(event: Omit<AssemblyEvent, "at"> & { at?: number }): void {
  const row: AssemblyEvent = { ...event, at: event.at ?? Date.now() };
  if (row.verdict === "rechazado") {
    counters.rechazados += 1;
    counters.ultimoRechazo = row.at;
  } else {
    counters.aceptados += 1;
  }
  events.push(row);
  if (events.length > MAX_EVENTS) events.shift();
}

export function assemblyReport(): {
  rechazados: number;
  aceptados: number;
  ultimoRechazo: number;
  eventos: AssemblyEvent[];
} {
  return { rechazados: counters.rechazados, aceptados: counters.aceptados, ultimoRechazo: counters.ultimoRechazo, eventos: [...events] };
}

export function clearAssemblyLog(): void {
  events.length = 0;
  counters.rechazados = 0;
  counters.aceptados = 0;
  counters.ultimoRechazo = 0;
}

/** Reloj monótono, para medir lo que tarda en decidirse un paquete. */
export function tick(): () => number {
  const start = now();
  return () => now() - start;
}

declare global {
  interface Window {
    __magicritaDiag?: {
      report: () => ReturnType<typeof assemblyReport>;
      clear: () => void;
      selfTest: () => Promise<unknown>;
    };
  }
}

/**
 * Se instala siempre: es de solo lectura y es la via mas comoda para comprobar
 * la guarda desde DevTools sin abrir el panel.
 */
export function installDiagHook(selfTest: () => Promise<unknown>): void {
  if (typeof window === "undefined") return;
  window.__magicritaDiag = {
    report: assemblyReport,
    clear: clearAssemblyLog,
    selfTest,
  };
}
