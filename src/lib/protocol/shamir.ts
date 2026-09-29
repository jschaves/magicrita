import { randomBytes } from "./bytes";

/**
 * Shamir secret sharing sobre GF(256) (polinomio 0x11d). Divide un secreto en
 * `total` participaciones; con `threshold` cualesquiera se reconstruye y con
 * menos no se sabe nada. Lo usa la recuperacion social: cada participacion viaja
 * cifrada al dispositivo de un guardian, nunca a un servidor.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

function div(a: number, b: number): number {
  if (b === 0) throw new Error("shamir_div0");
  if (a === 0) return 0;
  return EXP[(LOG[a]! - LOG[b]! + 255) % 255]!;
}

export type Share = { x: number; y: Uint8Array };

export function split(secret: Uint8Array, total: number, threshold: number): Share[] {
  if (threshold < 2 || threshold > total || total > 255) throw new Error("shamir_params");
  if (secret.length === 0) throw new Error("shamir_secret");
  const coeffs: Uint8Array[] = [];
  for (let i = 0; i < threshold - 1; i += 1) coeffs.push(randomBytes(secret.length));
  // poly[0] = secreto (termino constante), poly[i] = coeficiente de x^i.
  const poly = [secret, ...coeffs];
  const shares: Share[] = [];
  for (let x = 1; x <= total; x += 1) {
    const y = new Uint8Array(secret.length);
    for (let j = 0; j < secret.length; j += 1) {
      // Horner de mayor a menor potencia: acaba en el termino constante en x=0.
      let acc = 0;
      for (let c = poly.length - 1; c >= 0; c -= 1) {
        acc = mul(acc, x) ^ poly[c]![j]!;
      }
      y[j] = acc;
    }
    shares.push({ x, y });
  }
  return shares;
}

export function combine(shares: Share[]): Uint8Array {
  if (shares.length === 0) throw new Error("shamir_shares");
  const len = shares[0]!.y.length;
  for (const share of shares) {
    if (share.y.length !== len || share.x < 1) throw new Error("shamir_share");
  }
  const out = new Uint8Array(len);
  for (let j = 0; j < len; j += 1) {
    let acc = 0;
    for (let i = 0; i < shares.length; i += 1) {
      const xi = shares[i]!.x;
      let num = 1;
      let den = 1;
      for (let m = 0; m < shares.length; m += 1) {
        if (m === i) continue;
        const xm = shares[m]!.x;
        num = mul(num, xm);
        den = mul(den, xi ^ xm);
      }
      acc ^= mul(shares[i]!.y[j]!, div(num, den));
    }
    out[j] = acc;
  }
  return out;
}
