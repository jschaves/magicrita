/**
 * Aceptacion de las condiciones de uso. Se guarda en el dispositivo y es
 * obligatoria antes de crear identidad o publicar contenido (requisito UGC de
 * Google Play): la puerta no se puede saltar. Sube `TERMS_VERSION` cuando las
 * condiciones cambien de forma sustancial para volver a pedir el consentimiento.
 */
const KEY = "magicrita.terms";
const TERMS_VERSION = 1;

export function termsAccepted(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { v?: number };
    return parsed.v === TERMS_VERSION;
  } catch {
    return false;
  }
}

export function acceptTerms(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: TERMS_VERSION, at: Date.now() }));
  } catch {
    // sin almacenamiento no se puede recordar; la puerta se vuelve a pedir
  }
}
