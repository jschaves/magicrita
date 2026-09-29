import type { Locale } from "./messages";

/**
 * Textos de las herramientas experimentales (procedencia, sincronia offline y
 * recuperacion social). Se mantienen aparte del diccionario principal para no
 * obligar a traducirlos en los diez idiomas de golpe; `es` es el respaldo.
 */
const ES = {
  title: "Herramientas",
  notice: "Funciones avanzadas, 100% en tu dispositivo. Nada pasa por un servidor.",
  provenance: "Procedencia verificable",
  provenanceHint:
    "Pega una prueba firmada (post, perfil o comentario) para verificarla sin confiar en ningún servidor.",
  proofPlaceholder: "magicrita-proof…",
  verify: "Verificar",
  valid: "Firma válida de {author}",
  invalid: "Prueba no válida.",
  copyProof: "Copiar prueba",
  attest: "Avalar procedencia",
  attestedBy: "{n} confirmaciones",
  offline: "Sincronización sin conexión",
  offlineHint:
    "Copia este texto y llévalo a otro dispositivo (USB, mensajería, QR) sin red. Cada sobre se reverifica al importarlo.",
  export: "Exportar",
  import: "Importar",
  copyAll: "Copiar todo",
  imported: "{authors} autores y {total} sobres importados.",
  recovery: "Recuperación social",
  recoveryHint:
    "Divide tu clave entre varios contactos (M de N). Si pierdes el dispositivo, reúne M participaciones y tu contraseña de recuperación. Los guardianes no pueden leerlas.",
  guardians: "Guardianes",
  noContacts: "Sigue a alguien para poder elegirlos como guardianes.",
  threshold: "Umbral (M)",
  recoveryPassword: "Contraseña de recuperación",
  setup: "Crear y repartir",
  created: "Repartido entre {n} guardianes.",
  yourShares: "Participaciones que guardas",
  yourSharesHint:
    "Eres guardián de estas cuentas. Guarda el texto y entrégalo solo a su dueño: sin su contraseña de recuperación no sirve de nada.",
  copyShare: "Copiar participación",
  error: "No se pudo completar.",
  recoverTitle: "Recuperar cuenta",
  recoverHint:
    "Pega una participación por línea (tu umbral M) y tu contraseña de recuperación. Con ellas se reconstruye la clave en este dispositivo.",
  shares: "Participaciones",
  sharePlaceholder: "magicrita-recovery…",
  password: "Contraseña de recuperación",
  newPassword: "Nueva contraseña local",
  submit: "Recuperar",
  failed: "No se pudo recuperar. Revisa las participaciones y la contraseña.",
} as const;

type ToolsKey = keyof typeof ES;

const EN: Partial<Record<ToolsKey, string>> = {
  title: "Tools",
  notice: "Advanced features, 100% on your device. Nothing goes through a server.",
  provenance: "Verifiable provenance",
  provenanceHint:
    "Paste a signed proof (post, profile or comment) to verify it without trusting any server.",
  verify: "Verify",
  valid: "Valid signature from {author}",
  invalid: "Invalid proof.",
  copyProof: "Copy proof",
  attest: "Attest provenance",
  attestedBy: "{n} confirmations",
  offline: "Offline sync",
  offlineHint:
    "Copy this text to another device (USB, messaging, QR) with no network. Every envelope is re-verified on import.",
  export: "Export",
  import: "Import",
  copyAll: "Copy all",
  imported: "{authors} authors and {total} envelopes imported.",
  recovery: "Social recovery",
  recoveryHint:
    "Split your key among several contacts (M of N). If you lose the device, gather M shares and your recovery password. Guardians cannot read them.",
  guardians: "Guardians",
  noContacts: "Follow someone to pick them as guardians.",
  threshold: "Threshold (M)",
  recoveryPassword: "Recovery password",
  setup: "Create and share",
  created: "Shared with {n} guardians.",
  yourShares: "Shares you keep",
  yourSharesHint:
    "You are a guardian for these accounts. Keep the text and give it only to its owner: without their recovery password it is useless.",
  copyShare: "Copy share",
  error: "Could not complete.",
  recoverTitle: "Recover account",
  recoverHint:
    "Paste one share per line (your threshold M) and your recovery password. They rebuild the key on this device.",
  shares: "Shares",
  password: "Recovery password",
  newPassword: "New local password",
  submit: "Recover",
  failed: "Recovery failed. Check the shares and the password.",
};

export type { ToolsKey };

export function toolsText(locale: Locale, key: ToolsKey, vars?: Record<string, string | number>): string {
  const table = locale === "en" ? EN : ES;
  let text: string = table[key] ?? ES[key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
