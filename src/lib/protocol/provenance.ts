import { isEnvelope, verifyEnvelope, type Envelope } from "./envelope";

/**
 * Procedencia verificable. Un "proof" es el sobre firmado (post, perfil o
 * comentario) metido en un texto portable que cualquiera puede verificar sin
 * confiar en ningun servidor: la firma Ed25519 ata autor, ts y cuerpo. Los
 * pares pueden ademas co-firmar un sobre (`attest`) como prueba de que lo
 * vieron existir.
 */
export const PROOF_SCHEMA = "magicrita-proof";
export const PROOF_VERSION = 1;

export type Proofable = "post" | "profile" | "comment";

export type Proof = {
  schema: typeof PROOF_SCHEMA;
  v: number;
  envelope: Envelope;
};

export function buildProof(envelope: Envelope): Proof {
  return { schema: PROOF_SCHEMA, v: PROOF_VERSION, envelope };
}

export function proofText(envelope: Envelope): string {
  return JSON.stringify(buildProof(envelope));
}

export type ProofResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; error: string };

export function verifyProof(text: string): ProofResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: "proof_json" };
  }
  const proof = parsed as Partial<Proof> & { envelope?: unknown };
  if (!proof || proof.schema !== PROOF_SCHEMA) return { ok: false, error: "proof_schema" };
  const envelope = proof.envelope as Envelope;
  if (!isEnvelope(envelope)) return { ok: false, error: "proof_envelope" };
  const allowed: Proofable[] = ["post", "profile", "comment"];
  if (!allowed.includes(envelope.type as Proofable)) return { ok: false, error: "proof_type" };
  if (!verifyEnvelope(envelope)) return { ok: false, error: "proof_signature" };
  return { ok: true, envelope };
}

/** Autores distintos que han co-firmado (attest) el sobre `target`. */
export function attestationsOf(envelopes: readonly Envelope[], target: string): string[] {
  const authors = new Set<string>();
  for (const env of envelopes) {
    if (env.type === "attest" && env.body.target === target) authors.add(env.author);
  }
  return [...authors];
}
