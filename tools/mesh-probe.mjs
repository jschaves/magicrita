/**
 * Sonda de_mesh para comprobar la guarda de trozos en un navegador de verdad.
 *
 * Se conecta al relay como un par legitimo (hello firmado con PoW), lee el
 * roster,_localiza a la victima y le manda por el WebSocket los mismos paquetes
 * hostiles que mandaria un atacante real. El navegador deberia registrarlos como
 * rechazados en el panel de administracion (o en `window.__magicritaDiag`).
 *
 *   node tools/mesh-probe.mjs                 -> solo al primero del roster
 *   node tools/mesh-probe.mjs --to rpub_abc   -> a uno concreto
 *   node tools/mesh-probe.mjs --n 2000000000  -- otro valor de n
 *   node tools/mesh-probe.mjs --ws ws://127.0.0.1:8787
 *
 * No escribe nada en disco y no usa credenciales reales: genera su propio
 * par de claves Ed25519 y lo tira al terminar.
 */
import crypto from "node:crypto";
import { WebSocket } from "ws";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

const URL_WS = flag("ws", process.env.SIGNAL_WS || "ws://127.0.0.1:8787");
const HOSTILE_N = Number(flag("n", 2_000_000_000));
const WANTED = flag("to", "");

const key = crypto.generateKeyPairSync("ed25519");
const spki = key.publicKey.export({ type: "spki", format: "der" });
const rpub = "rpub_" + spki.subarray(spki.length - 32).toString("hex");

function canonical(fields) {
  const out = {};
  for (const k of Object.keys(fields).sort()) out[k] = fields[k];
  return Buffer.from(JSON.stringify(out), "utf8");
}

function minePow(target) {
  for (let i = 0; ; i += 1) {
    const hex = crypto.createHash("sha256").update(`rita-pow-v1:${target}:${i}`).digest("hex");
    if (hex.startsWith("0000")) return String(i);
  }
}

const ws = new WebSocket(URL_WS);
let sent = 0;
let autenticado = false;
let sondaEnviada = false;

function send(obj) {
  ws.send(JSON.stringify(obj));
}

function hostileBlobs(victim) {
  // n enorme con i en la ultima posicion: sin tope, `Array(n)` + expansions.
  for (let k = 0; k < 3; k += 1) {
    send({
      type: "blob",
      to: victim,
      hash: `probe${k}`.padEnd(64, "0"),
      mime: "image/png",
      tier: "hq",
      i: HOSTILE_N - 1,
      n: HOSTILE_N,
      size: 1,
      data: "AAAA",
    });
    sent += 1;
  }
  // n negativo y no entero, para que la guarda tambien los descarte.
  send({ type: "blob", to: victim, hash: "p".repeat(64), i: 0, n: -5, data: "AAAA" });
  send({ type: "blob", to: victim, hash: "q".repeat(64), i: 0, n: 1.5, data: "AAAA" });
  sent += 2;
  // Un paquete bien formado, para comprobar que la via sigue admitiendo media.
  send({
    type: "pic",
    to: victim,
    hash: "z".repeat(64),
    mime: "image/png",
    data: Buffer.from("PNG-falso-para-la-sonda").toString("base64"),
  });
  sent += 1;
}

ws.on("open", () => console.log(`sonda conectada a ${URL_WS} como ${rpub.slice(0, 14)}…`));

ws.on("message", (raw) => {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (msg.type === "challenge" && typeof msg.nonce === "string") {
    if (autenticado) return;
    const fields = { interests: [], n: msg.nonce, name: "", rpub };
    send({
      type: "hello",
      rpub,
      name: "",
      interests: [],
      pow: minePow(rpub),
      invite: process.env.BETA_INVITE || "",
      auth: { n: msg.nonce, sig: crypto.sign(null, canonical(fields), key.privateKey).toString("hex") },
    });
    return;
  }

  if (msg.type === "hello-ok") {
    autenticado = true;
    console.log("hello aceptado por el relay");
    return;
  }

  if (msg.type === "peers" && Array.isArray(msg.peers)) {
    if (sondaEnviada) return;
    sondaEnviada = true;
    const candidatos = msg.peers.filter((peer) => peer && peer.rpub && peer.rpub !== rpub);
    const victima = WANTED || candidatos[0]?.rpub;
    if (!victima) {
      console.log("no hay ningun par en el roster: abre la app en el navegador y reintenta");
      clearTimeout(tiempoAgotado);
      ws.close();
      process.exit(2);
    }
    if (WANTED && !candidatos.some((peer) => peer.rpub === WANTED)) {
      console.log(`aviso: ${WANTED} no esta en el roster; el relay descartara los paquetes`);
    }
    console.log(`victima: ${victima}`);
    console.log(`mandando ${HOSTILE_N} como n, mas 3 variantes invalidas y 1 pic legitimo`);
    hostileBlobs(victima);
    setTimeout(() => {
      clearTimeout(tiempoAgotado);
      console.log(`\n${sent} paquetes enviados.`);
      console.log("mira ahora el panel de administracion > Diagnostico, o en la consola:");
      console.log("  __magicritaDiag.report()");
      console.log("  await __magicritaDiag.selfTest()");
      ws.close();
      process.exit(0);
    }, 1200);
  }
});

ws.on("error", (error) => {
  console.error("no se pudo conectar:", error.message);
  process.exit(1);
});

const tiempoAgotado = setTimeout(() => {
  console.error("tiempo agotado: no llego roster ni hello-ok");
  process.exit(1);
}, 30_000);
