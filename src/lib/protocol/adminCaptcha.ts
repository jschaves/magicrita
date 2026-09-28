import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "./bytes";
import { apiUrl } from "./apiBase";

/**
 * Captcha del login de admin: reto firmado que se resuelve con prueba de trabajo.
 *
 * El relay entrega un reto (`nonce`, `iat`, `bits`, `sig`) y NO manda la
 * respuesta, asi que no puede recordar cual era. Lo que se comprueba es que
 * este navegador haya gastado CPU en encontrar un `counter` cuyo hash tenga los
 * bits a cero pedidos. Nada de eso se guarda: no hay estado en el servidor mas
 * alla del nonce ya gastado, y aqui tampoco se cachea la solucion, porque
 * guardarla seria justo lo que el reto tries evitar.
 *
 * Es la unica forma de captcha que no necesita ni memoria en el servidor ni un
 * tercero. Un acertijo visual obligaria al relay a recordar la respuesta (o a
 * mandarla cifrada, que se lee igual desde la pestana del atacante), y un
 * servicio externo si o si acaba guardando algo sobre el usuario.
 */
export const CAPTCHA_PREFIX = "rita-captcha-v1";

/** El relay manda el valor real en el reto; este es el valor de referencia. */
export const CAPTCHA_BITS = 18;

/** Margen antes de caducar para pedir reto nuevo en vez de fallar el intento. */
const REFRESH_MARGIN_MS = 45 * 1000;

/** Se cede el hilo cada tanto para no clavar la pestana ni el boton. */
const YIELD_EVERY = 4096;

export type AdminCaptchaChallenge = {
  nonce: string;
  iat: number;
  bits: number;
  sig: string;
};

export type AdminCaptcha = AdminCaptchaChallenge & { counter: string };

function zeroBits(hex: string, bits: number): boolean {
  const nibbles = Math.floor(bits / 4);
  const rem = bits % 4;
  if (!hex.startsWith("0".repeat(nibbles))) return false;
  if (rem === 0) return true;
  return (Number.parseInt(hex[nibbles] ?? "f", 16) >> (4 - rem)) === 0;
}

export function captchaPowOk(nonce: string, counter: string, bits: number): boolean {
  if (!nonce || !counter) return false;
  const digest = bytesToHex(sha256(utf8ToBytes(`${CAPTCHA_PREFIX}:${nonce}:${counter}`)));
  return zeroBits(digest, bits);
}

/** El contador va en base36: 18 bits entran de sobra en 10 caracteres. */
function counterFits(bits: number): boolean {
  return bits <= 25;
}

export async function fetchAdminCaptcha(): Promise<AdminCaptchaChallenge> {
  const res = await fetch(apiUrl("/admin-api/captcha"), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("captcha_unavailable");
  const data = (await res.json()) as Partial<AdminCaptchaChallenge>;
  if (
    typeof data.nonce !== "string" ||
    !/^[0-9a-f]{32}$/.test(data.nonce) ||
    typeof data.iat !== "number" ||
    typeof data.bits !== "number" ||
    typeof data.sig !== "string"
  ) {
    throw new Error("captcha_bad_challenge");
  }
  return { nonce: data.nonce, iat: data.iat, bits: data.bits, sig: data.sig };
}

export async function solveAdminCaptcha(
  challenge: AdminCaptchaChallenge,
  onProgress?: (attempts: number) => void,
): Promise<AdminCaptcha> {
  if (!counterFits(challenge.bits)) throw new Error("captcha_bad_bits");
  let n = 0;
  for (;;) {
    const counter = n.toString(36);
    if (captchaPowOk(challenge.nonce, counter, challenge.bits)) {
      return { ...challenge, counter };
    }
    n += 1;
    if (n % YIELD_EVERY === 0) {
      onProgress?.(n);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
}

/**
 * El reto caduca en minutos. Si el admin deja el formulario abierto, se pide
 * otro y se resuelve otra vez en vez de fallar el intento por tiempo.
 */
export function captchaFresh(solved: AdminCaptcha | null): boolean {
  if (!solved) return false;
  return Date.now() - solved.iat < 3 * 60 * 1000 - REFRESH_MARGIN_MS;
}
