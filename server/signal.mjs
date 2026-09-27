/**
 * MagicRita signaling — VPS Linux.
 * No guarda publicaciones, claves ni archivos.
 * Solo RAM: quién está conectado ahora. Reenvía señal WebRTC.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const envPath = path.join(ROOT, "..", ".env");
  try {
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // sin .env: se usan variables del sistema
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_USER = process.env.ADMIN_USER || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const BETA_INVITE = process.env.BETA_INVITE || "";
const RESERVED_ADMIN = new Set([
  "welcome",
  "unlock",
  "legal",
  "people",
  "saved",
  "protocolo",
  "discover",
  "compose",
  "messages",
  "settings",
  "n",
  "p",
  "brand",
  "beta",
  "signal",
  "admin-api",
  "moderation",
  "assets",
]);
const DEFAULT_ADMIN_PATH = "topogue";
const ADMIN_PATH_FILE = path.join(ROOT, "..", "data", "admin-path.json");

/** null si no vale. Distinguir "invalido" de "no configurado" es lo que permite
 *  que un cambio de ruta no se deshaga solo en silencio. */
function parseAdminPath(raw) {
  const value = String(raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) return null;
  if (RESERVED_ADMIN.has(value.toLowerCase())) return null;
  return value;
}

function loadAdminPath() {
  try {
    const raw = JSON.parse(fs.readFileSync(ADMIN_PATH_FILE, "utf8"));
    return parseAdminPath(raw?.path);
  } catch {
    return null;
  }
}

function saveAdminPath(pathValue) {
  fs.mkdirSync(path.dirname(ADMIN_PATH_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_PATH_FILE, JSON.stringify({ path: pathValue }, null, 2));
}

/**
 * La guardada en data/ manda sobre el entorno: el admin puede rotarla sin
 * tocar .env ni recompilar. Sin fichero, se cae al valor del entorno.
 */
function adminPanelPath() {
  return (
    loadAdminPath() ||
    parseAdminPath(process.env.RUTA_ADMINISTRACION || process.env.ADMIN_PATH || "") ||
    DEFAULT_ADMIN_PATH
  );
}
let ADMIN_PATH = adminPanelPath();
const BLOCKS_PATH = path.join(ROOT, "..", "data", "admin-blocks.json");
const INVITES_PATH = path.join(ROOT, "..", "data", "beta-invites.json");
const BRAND_DIR = path.join(ROOT, "..", "data", "brand");
const BRAND_META_PATH = path.join(BRAND_DIR, "meta.json");
const LOGO_MAX_BYTES = 1_000_000;
const LOGO_JSON_MAX = 1_400_000;
// Sin SVG a proposito: el logo se sirve en linea con su propio Content-Type, y un
// SVG con <script> se ejecutaria en el origen de la app con acceso al storage.
const LOGO_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/** @type {Map<import('ws').WebSocket, { rpub: string, name: string, interests: string[] }>} */
const live = new Map();
/** @type {Map<string, import('ws').WebSocket>} */
const byRpub = new Map();
/** Buzón RAM: sobres firmados para quien aún no está conectado. Sin disco. */
/** @type {Map<string, { list: object[], bytes: number, t: number }>} */
const mailbox = new Map();
/** @type {Map<string, { list: object[], bytes: number, t: number }>} */
const blobbox = new Map();
const MAILBOX_MAX = 250;
const MAILBOX_BYTES = 24_000;
const BLOBBOX_MAX = 800;
/**
 * `BLOBBOX_MAX` acotaba la cantidad, no los bytes: 800 trozos de hasta 12 MB son
 * 9,6 GB por destinatario, y como el buzon no caducaba la memoria no volvia.
 */
const BLOBBOX_BYTES = 32_000_000;
/** Los buzones se vacian solos: un rpub que no conecta no puede retener RAM. */
const BOX_TTL_MS = 30 * 60 * 1000;

const sessions = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const POW_BITS = 16;
const POW_PREFIX = "rita-pow-v1";
const MAX_IP_SOCKETS = 16;
const MAX_IP_RPUBS = 16;
/** cupos por tipo de mensaje: [max, ventanaMs] */
const MESSAGE_LIMITS = {
  blob: [2500, 60_000],
  pic: [240, 60_000],
  "need-blob": [60, 60_000],
  signal: [240, 60_000],
  hold: [30, 60_000],
  default: [80, 60_000],
};
const hits = new Map();
/** intentos fallidos de login tolerados por IP antes de cortar */
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/**
 * Captcha del login de admin: reto firmado que no guarda nada.
 *
 * La firma ata el nonce, la hora y la dificultad al secreto del relay, asi que
 * un atacante tiene que pedir un reto fresco en cada intento: no le sirve
 * precalcular millones de soluciones por adelantado. El reto NO lleva la
 * respuesta, de modo que el relay no puede saber cual era y no tiene nada que
 * recordar; lo unico que comprueba es la prueba de trabajo, que es stateless.
 * En RAM queda solo el nonce ya gastado, para que una solucion no se repita;
 * caduca en minutos y un reinicio lo borra. Ni disco, ni terceros, ni copia
 * de lo que se escribe. El limite por IP de arriba sigue ahi debajo.
 */
const CAPTCHA_BITS = 18;
const CAPTCHA_PREFIX = "rita-captcha-v1";
const CAPTCHA_SECRET_TAG = "rita-captcha-secret-v1";
const CAPTCHA_TTL_MS = 3 * 60 * 1000;
/** tolera relojes desfasados entre navegador y relay */
const CAPTCHA_SKEW_MS = 10 * 1000;
const CAPTCHA_USED_MAX = 512;
const CAPTCHA_ISSUES_MAX = 60;
const CAPTCHA_ISSUES_WINDOW_MS = 60 * 1000;
const captchaUsed = new Map();
/** items por consulta de moderacion; el cliente va en lotes */
const MOD_CHECK_MAX = 400;
const MOD_CHECK_MAX_CALLS = 30;
/** intentos de codigo de invitación por IP */
const BETA_MAX_ATTEMPTS = 10;
const BETA_WINDOW_MS = 10 * 60 * 1000;
/** topes de cuerpo. Sin ellos, un POST sin auth podia forzar la RAM del relay. */
const BODY_TINY_MAX = 4 * 1024;
const BODY_MOD_MAX = 256 * 1024;
const BODY_ADMIN_MAX = 64 * 1024;

/**
 * `X-Forwarded-For` la pone el cliente, asi que usarla sin mas hacia que todos
 * los limites por IP no fueran nada: rotando la cabecera se esquivaban el login
 * de admin, el rate de moderacion y el de hello. Se respeta solo si hay un proxy
 * delante declarado, porque en ese caso el que la escribe es el proxy.
 */
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ""));

/**
 * Orígenes permitidos para /admin-api/*. Vacío significa "solo local", que
 * cubre el panel servido por el propio relay y el proxy de Vite en desarrollo.
 * Un despliegue en un dominio real tiene que declarar ese dominio aquí.
 */
const ADMIN_ORIGINS = new Set(
  String(process.env.ADMIN_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = req.headers["x-forwarded-for"];
    if (typeof xf === "string" && xf.trim()) {
      // El proxy fiable AÑADE la IP real al final de la cadena. El cliente
      // puede enviar valores delante, así que se usa la ÚLTIMA, no la primera:
      // con `$proxy_add_x_forwarded_for` la primera era falsificable y saltaba
      // todos los limites por IP.
      const parts = xf
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) return last.startsWith("::ffff:") ? last.slice(7) : last;
    }
  }
  const remote = req.socket?.remoteAddress || "0.0.0.0";
  // ::ffff:127.0.0.1 y 127.0.0.1 son el mismo host: sin normalizar, cada uno
  // llevaba su propio contador.
  return remote.startsWith("::ffff:") ? remote.slice(7) : remote;
}

function inviteOk(code) {
  if (!betaRequired()) return true;
  const got = crypto.createHash("sha256").update(String(code || "").trim()).digest();
  let matched = null;
  // Se recorren TODOS los habilitados sin salir en el primero: si se saliera al
  // acertar, el tiempo de respuesta revelaría cuál de los códigos es válido.
  for (const invite of invites) {
    if (invite.disabled) continue;
    const expect = crypto.createHash("sha256").update(invite.code).digest();
    if (crypto.timingSafeEqual(got, expect)) matched = invite;
  }
  if (!matched && BETA_INVITE) {
    const expect = crypto.createHash("sha256").update(String(BETA_INVITE).trim()).digest();
    if (crypto.timingSafeEqual(got, expect)) return true;
  }
  if (matched) {
    matched.uses += 1;
    matched.lastUsed = Date.now();
    saveInvites();
  }
  return Boolean(matched);
}

/**
 * Igual que `inviteOk` pero sin efectos: no cuenta usos ni escribe disco. Es la
 * que usa cada `hello`, donde se comprueba muchas veces por sesion.
 */
function inviteValid(code) {
  if (!betaRequired()) return true;
  const got = crypto.createHash("sha256").update(String(code || "").trim()).digest();
  for (const invite of invites) {
    if (invite.disabled) continue;
    const expect = crypto.createHash("sha256").update(invite.code).digest();
    if (crypto.timingSafeEqual(got, expect)) return true;
  }
  if (BETA_INVITE) {
    const expect = crypto.createHash("sha256").update(String(BETA_INVITE).trim()).digest();
    if (crypto.timingSafeEqual(got, expect)) return true;
  }
  return false;
}

function powOk(rpub, nonce) {
  if (typeof rpub !== "string" || !/^rpub_[0-9a-f]{64}$/i.test(rpub)) return false;
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 32) return false;
  const hex = crypto.createHash("sha256").update(`${POW_PREFIX}:${rpub}:${nonce}`).digest("hex");
  const nibbles = Math.floor(POW_BITS / 4);
  const rem = POW_BITS % 4;
  if (!hex.startsWith("0".repeat(nibbles))) return false;
  if (rem === 0) return true;
  return (parseInt(hex[nibbles], 16) >> (4 - rem)) === 0;
}

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HELLO_NAME_MAX = 80;
const HELLO_INTERESTS_MAX = 12;

/** Mismo canonicalJson del cliente: claves ordenadas, arrays en su orden. */
function canonicalHello(fields) {
  const out = {};
  for (const key of Object.keys(fields).sort()) out[key] = fields[key];
  return JSON.stringify(out);
}

/** Un nonce de un solo uso por socket. Sin esto un hello se podría repetir. */
function issueChallenge(ws) {
  ws.nonce = crypto.randomBytes(16).toString("hex");
  send(ws, { type: "challenge", nonce: ws.nonce });
}

function ed25519KeyFromHex(hex) {
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  });
}

/**
 * El hello tiene que venir firmado con la rsec del rpub que dice ser. Sin esta
 * prueba cualquiera puede listarse con el rpub de otra persona, suplantar su
 * presencia, saltarse la cuarentena o echarle de su propio socket.
 */
function helloAuthOk(msg, ws) {
  const auth = msg.auth;
  if (!auth || typeof auth !== "object") return false;
  if (typeof auth.n !== "string" || !ws.nonce || auth.n !== ws.nonce) return false;
  if (typeof auth.sig !== "string" || !/^[0-9a-f]{128}$/i.test(auth.sig)) return false;
  const match = /^rpub_([0-9a-f]{64})$/i.exec(msg.rpub);
  if (!match) return false;
  // Se firma exactamente lo que se guarda, para que el roster no pueda llevar
  // un nombre o intereses que nadie firmó.
  const name = typeof msg.name === "string" ? msg.name.slice(0, HELLO_NAME_MAX) : "";
  const interests = Array.isArray(msg.interests)
    ? msg.interests.filter((x) => typeof x === "string").slice(0, HELLO_INTERESTS_MAX)
    : [];
  let key;
  try {
    key = ed25519KeyFromHex(match[1]);
  } catch {
    return false;
  }
  const message = Buffer.from(canonicalHello({ interests, n: auth.n, name, rpub: msg.rpub }), "utf8");
  try {
    return crypto.verify(null, message, key, Buffer.from(auth.sig, "hex"));
  } catch {
    return false;
  }
}

function tooMany(key, max, windowMs) {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || row.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  row.n += 1;
  return row.n > max;
}

/**
 * El secreto del captcha sale de la contraseña de admin: asi no hay una clave
 * mas que gérer ni queortalar. Si cambia la contraseña, caducan los retos en
 * curso, que es lo correcto.
 */
function captchaSecret() {
  if (!ADMIN_PASSWORD) return null;
  return crypto.createHmac("sha256", ADMIN_PASSWORD).update(CAPTCHA_SECRET_TAG).digest();
}

function captchaSign(secret, nonce, iat, bits) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${CAPTCHA_PREFIX}:${nonce}:${iat}:${bits}`)
    .digest("hex");
}

function zeroBits(hex, bits) {
  const nibbles = Math.floor(bits / 4);
  const rem = bits % 4;
  if (!hex.startsWith("0".repeat(nibbles))) return false;
  if (rem === 0) return true;
  return (Number.parseInt(hex[nibbles] ?? "f", 16) >> (4 - rem)) === 0;
}

/**
 * Verifica el reto y lo gasta. Devolver `true` consume el nonce aunque luego
 * las credenciales salgan mal: si no, una sola solucion podria servir para
 * muchos intentos de contraseña.
 */
function captchaOk(raw) {
  const secret = captchaSecret();
  if (!secret || !raw || typeof raw !== "object") return false;
  const nonce = String(raw.nonce ?? "");
  const iat = Number(raw.iat);
  const bits = Number(raw.bits);
  const counter = String(raw.counter ?? "");
  const sig = String(raw.sig ?? "");
  if (!/^[0-9a-f]{32}$/.test(nonce)) return false;
  if (!Number.isSafeInteger(iat) || iat <= 0) return false;
  if (bits !== CAPTCHA_BITS) return false;
  // base36 corto: topping el numero de intentos no da trabajo extra a nadie
  if (!/^[0-9a-z]{1,10}$/.test(counter)) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const age = Date.now() - iat;
  if (age < -CAPTCHA_SKEW_MS || age > CAPTCHA_TTL_MS) return false;
  const expect = Buffer.from(captchaSign(secret, nonce, iat, bits), "hex");
  const got = Buffer.from(sig, "hex");
  if (expect.length !== got.length || !crypto.timingSafeEqual(expect, got)) return false;

  const now = Date.now();
  for (const [key, exp] of captchaUsed) {
    if (exp < now) captchaUsed.delete(key);
  }
  if (captchaUsed.has(nonce)) return false;
  const digest = crypto
    .createHash("sha256")
    .update(`${CAPTCHA_PREFIX}:${nonce}:${counter}`)
    .digest("hex");
  if (!zeroBits(digest, CAPTCHA_BITS)) return false;
  if (captchaUsed.size >= CAPTCHA_USED_MAX) {
    captchaUsed.delete(captchaUsed.keys().next().value);
  }
  captchaUsed.set(nonce, iat + CAPTCHA_TTL_MS);
  return true;
}

function socketsForIp(ip) {
  let n = 0;
  for (const client of wss.clients) {
    if (client.clientIp === ip) n += 1;
  }
  return n;
}

function rpubsForIp(ip) {
  const set = new Set();
  for (const [ws, info] of live) {
    if (ws.clientIp === ip && info.rpub) set.add(info.rpub);
  }
  return set;
}

function loadBlocks() {
  try {
    const raw = JSON.parse(fs.readFileSync(BLOCKS_PATH, "utf8"));
    return {
      users: Array.isArray(raw.users) ? raw.users.filter((x) => typeof x === "string") : [],
      comments: Array.isArray(raw.comments) ? raw.comments.filter((x) => typeof x === "string") : [],
    };
  } catch {
    return { users: [], comments: [] };
  }
}

function saveBlocks(blocks) {
  fs.mkdirSync(path.dirname(BLOCKS_PATH), { recursive: true });
  fs.writeFileSync(BLOCKS_PATH, JSON.stringify(blocks, null, 2));
}

let staffBlocks = loadBlocks();

/*
 * Codigos de beta. Se guardan en claro a proposito: el admin tiene que poder
 * volver a leerlos y copiarlos para reenviarlos, y el fichero vive en data/
 * junto a los bloqueos, que tambien van en claro. Si alguna vez hay que
 * revocar de verdad, se borra la fila; no hay nada que "rotar" en el sitio.
 */
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I, O, 0 ni 1
const INVITE_MAX = 500;
const INVITE_MAX_BATCH = 20;
const INVITE_NOTE_MAX = 80;

function loadInvites() {
  try {
    const raw = JSON.parse(fs.readFileSync(INVITES_PATH, "utf8"));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.invites) ? raw.invites : [];
    return list
      .filter((item) => item && typeof item.code === "string" && item.code)
      .slice(0, INVITE_MAX)
      .map((item) => ({
        id: typeof item.id === "string" && item.id ? item.id : crypto.randomBytes(4).toString("hex"),
        code: item.code,
        note: typeof item.note === "string" ? item.note.slice(0, INVITE_NOTE_MAX) : "",
        disabled: item.disabled === true,
        created: Number(item.created) || Date.now(),
        uses: Number(item.uses) || 0,
        lastUsed: Number(item.lastUsed) || 0,
      }));
  } catch {
    return [];
  }
}

function saveInvites() {
  fs.mkdirSync(path.dirname(INVITES_PATH), { recursive: true });
  fs.writeFileSync(INVITES_PATH, JSON.stringify({ invites }, null, 2));
}

let invites = loadInvites();

function newInviteCode() {
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
    if (i % 5 === 4 && i !== bytes.length - 1) out += "-";
  }
  return out;
}

/**
 * La beta se considera cerrada si hay un codigo en el entorno o si existe
 * alguna fila, aunque este deshabilitada: deshabilitar todos no abre la puerta
 * por accidente, hace falta borrarlos del todo.
 */
function betaRequired() {
  return Boolean(BETA_INVITE) || invites.length > 0;
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function brandMeta() {
  try {
    const raw = JSON.parse(fs.readFileSync(BRAND_META_PATH, "utf8"));
    if (!raw || typeof raw.file !== "string" || typeof raw.mime !== "string") return null;
    // `file` lo escribe el propio relay, pero que sea un nombre pelado evita que
    // un meta.json manipulado saque ficheros de fuera del directorio de marca.
    if (!/^[A-Za-z0-9._-]+$/.test(raw.file) || raw.file.includes("..")) return null;
    if (!fs.existsSync(path.join(BRAND_DIR, raw.file))) return null;
    return { file: raw.file, mime: raw.mime, updated: Number(raw.updated) || 0 };
  } catch {
    return null;
  }
}

function brandInfo() {
  const meta = brandMeta();
  if (!meta) return { logo: false };
  return { logo: true, mime: meta.mime, updated: meta.updated };
}

function looksLikeImage(mime, buf) {
  if (mime === "image/png") return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
  if (mime === "image/jpeg") return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  if (mime === "image/gif") return buf.slice(0, 3).toString("ascii") === "GIF";
  if (mime === "image/webp") {
    return buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function readLimited(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > max) {
        failed = true;
        reject(new TooLarge("too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

class TooLarge extends Error {}

function readBody(req, max) {
  return readLimited(req, max).then((buf) => {
    try {
      return JSON.parse(buf.toString("utf8") || "{}");
    } catch {
      return {};
    }
  });
}

function json(res, status, body, opts = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
  // /admin-api/* nunca lleva Access-Control-Allow-Origin. El token va en una
  // cabecera y no en una cookie, asi que un sitio hostil no puede obtenerlo;
  // declarar estas rutas como legibles desde cualquier origen no aporta nada.
  if (opts.cors !== false) {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

/**
 * Deja pasar las rutas de administracion solo si no hay Origin o si es uno
 * conocido. Es defensa en profundidad: el token en cabecera ya impide el
 * CSRF, pero si alguien llegara a ponerlo en una cookie, esto lo para.
 */
function adminOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (ADMIN_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    // Mismo origen: el panel vive en el mismo dominio que sirve el relay, asi
    // que no deberia hacer falta declarar ADMIN_ORIGINS para su propio dominio.
    // (El chequeo de Origin es defensa en profundidad anti-CSRF; el mismo
    // origen nunca es CSRF, y el token va en cabecera, no en cookie.)
    const requestHost = String(req.headers.host || "").toLowerCase();
    return Boolean(requestHost) && parsed.host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function bearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(\S+)/i.exec(h);
  return m ? m[1] : "";
}

function validSession(token) {
  const row = sessions.get(token);
  if (!row || row.exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function broadcastModeration() {
  // Solo un aviso. La lista completa ya no sale del relay: decir quien esta
  // moderado es informacion del staff, no del cliente, y cada cliente solo
  // necesita saber si los items que ya tiene estan bloqueados.
  const msg = { type: "moderation-changed" };
  for (const ws of live.keys()) send(ws, msg);
}

async function onHttp(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "OPTIONS") {
    // Las rutas de admin no negocian CORS: el panel es del mismo origen. El
    // resto de rutas publicas si, para que un cliente de otro origen pueda leer.
    json(res, 204, {}, url.pathname.startsWith("/admin-api/") ? { cors: false } : {});
    return;
  }
  if (req.method === "POST" && url.pathname === "/moderation/check") {
    // Consulta por lotes: devuelve solo los items de la consulta que estan
    // bloqueados, nunca la lista completa. El rate limit evita convertirlo en
    // un oraculo de pertenencia para barrer el roster entero.
    if (tooMany(`modcheck:${clientIp(req)}`, MOD_CHECK_MAX_CALLS, 60_000)) {
      json(res, 429, { error: "rate" });
      return;
    }
    const body = await readBody(req, BODY_MOD_MAX);
    const pick = (value) =>
      (Array.isArray(value) ? value : [])
        .filter((item) => typeof item === "string" && item.length > 0)
        .slice(0, MOD_CHECK_MAX);
    const users = new Set(staffBlocks.users);
    const comments = new Set(staffBlocks.comments);
    json(res, 200, {
      users: pick(body.rpubs).filter((item) => users.has(item)),
      comments: pick(body.sigs).filter((item) => comments.has(item)),
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/beta") {
    json(res, 200, {
      required: betaRequired(),
      total: invites.length,
      enabled: invites.filter((item) => !item.disabled).length,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/beta/check") {
    if (tooMany(`beta:${clientIp(req)}`, BETA_MAX_ATTEMPTS, BETA_WINDOW_MS)) {
      json(res, 429, { error: "rate" });
      return;
    }
    const body = await readBody(req, BODY_TINY_MAX);
    if (!inviteOk(body.invite)) {
      json(res, 403, { error: "invite_bad" });
      return;
    }
    json(res, 200, { ok: true, required: betaRequired() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin-path") {
    // Publico a proposito: el cliente necesita la ruta para saber donde esta el
    // panel, y no se puede pedir el token antes de llegar al panel. O sea: la
    // ruta nunca fue secreta (ya va dentro del bundle), esto no la filtra mas.
    json(res, 200, { path: ADMIN_PATH });
    return;
  }
  if (req.method === "GET" && url.pathname === "/brand") {
    json(res, 200, brandInfo());
    return;
  }
  if (req.method === "GET" && url.pathname === "/brand/logo") {
    const meta = brandMeta();
    if (!meta) {
      res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      res.end();
      return;
    }
    const bytes = fs.readFileSync(path.join(BRAND_DIR, meta.file));
    res.writeHead(200, {
      "Content-Type": meta.mime,
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    res.end(bytes);
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin-api/captcha") {
    if (!ADMIN_USER || !ADMIN_PASSWORD) {
      json(res, 503, { error: "admin_not_configured" }, { cors: false });
      return;
    }
    // Sin esta comprobacion, un sitio hostil podia pedir retos en bucle con la
    // IP del admin victima y agotarle el cupo (60/min), dejandole sin login.
    if (!adminOriginOk(req)) {
      json(res, 403, { error: "origin" }, { cors: false });
      return;
    }
    // Emitir es barato, pero no gratis: sin tope, este GET se puede usar para
    // quemarle CPU al relay requesting Challenges en bucle.
    if (tooMany(`captcha:${clientIp(req)}`, CAPTCHA_ISSUES_MAX, CAPTCHA_ISSUES_WINDOW_MS)) {
      json(res, 429, { error: "rate" }, { cors: false });
      return;
    }
    const secret = captchaSecret();
    const nonce = crypto.randomBytes(16).toString("hex");
    const iat = Date.now();
    json(
      res,
      200,
      { nonce, iat, bits: CAPTCHA_BITS, sig: captchaSign(secret, nonce, iat, CAPTCHA_BITS) },
      { cors: false },
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/admin-api/login") {
    if (!ADMIN_USER || !ADMIN_PASSWORD) {
      json(res, 503, { error: "admin_not_configured" }, { cors: false });
      return;
    }
    if (!adminOriginOk(req)) {
      json(res, 403, { error: "origin" }, { cors: false });
      return;
    }
    const body = await readBody(req, BODY_TINY_MAX);
    // El reto va antes que las credenciales a proposito: es lo que hace que
    // cada intento cueste CPU aunque venga de una IP nueva, y lo que hace
    // inutilizable la rotacion de IP contra el limite de intentos.
    if (!captchaOk(body.captcha)) {
      json(res, 400, { error: "captcha" }, { cors: false });
      return;
    }
    const user = String(body.user || "");
    const password = String(body.password || "");
    const userBuf = Buffer.from(user);
    const passBuf = Buffer.from(password);
    const expectUser = Buffer.from(ADMIN_USER);
    const expectPass = Buffer.from(ADMIN_PASSWORD);
    const userOk = userBuf.length === expectUser.length && crypto.timingSafeEqual(userBuf, expectUser);
    const passOk = passBuf.length === expectPass.length && crypto.timingSafeEqual(passBuf, expectPass);
    if (!userOk || !passOk) {
      // Solo cuentan los fallos, y un acierto limpia el contador: asi el admin
      // legitimo no se bloquea a si mismo por reintentar, pero un attacker que
      // no tenga la contrasena se queda sin intentos. El relay escucha en
      // 0.0.0.0, asi que esto es alcanzable desde la LAN.
      if (tooMany(`admin-login:${clientIp(req)}`, LOGIN_MAX_FAILS, LOGIN_WINDOW_MS)) {
        json(res, 429, { error: "rate" }, { cors: false });
        return;
      }
      json(res, 401, { error: "credenciales" }, { cors: false });
      return;
    }
    hits.delete(`admin-login:${clientIp(req)}`);
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { exp: Date.now() + SESSION_MS });
    json(res, 200, { token, user: ADMIN_USER }, { cors: false });
    return;
  }
  if (url.pathname.startsWith("/admin-api/")) {
    if (!adminOriginOk(req)) {
      json(res, 403, { error: "origin" }, { cors: false });
      return;
    }
    if (!validSession(bearer(req))) {
      json(res, 401, { error: "sesion" }, { cors: false });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin-api/session") {
      json(res, 200, { user: ADMIN_USER, live: snapshot() }, { cors: false });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin-api/blocks") {
      json(res, 200, staffBlocks, { cors: false });
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin-api/blocks") {
      const body = await readBody(req, BODY_ADMIN_MAX);
      const kind = body.kind === "comment" ? "comment" : "user";
      const id = String(body.id || "").trim();
      if (!id) {
        json(res, 400, { error: "id" }, { cors: false });
        return;
      }
      if (kind === "user") staffBlocks.users = unique([...staffBlocks.users, id]);
      else staffBlocks.comments = unique([...staffBlocks.comments, id]);
      saveBlocks(staffBlocks);
      broadcastModeration();
      json(res, 200, staffBlocks, { cors: false });
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/admin-api/blocks") {
      const body = await readBody(req, BODY_ADMIN_MAX);
      const kind = body.kind === "comment" ? "comment" : "user";
      const id = String(body.id || "").trim();
      if (kind === "user") staffBlocks.users = staffBlocks.users.filter((x) => x !== id);
      else staffBlocks.comments = staffBlocks.comments.filter((x) => x !== id);
      saveBlocks(staffBlocks);
      broadcastModeration();
      json(res, 200, staffBlocks, { cors: false });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin-api/invites") {
      json(res, 200, { invites, required: betaRequired() }, { cors: false });
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin-api/invites") {
      const body = await readBody(req, BODY_ADMIN_MAX);
      const note = String(body.note || "").trim().slice(0, INVITE_NOTE_MAX);
      const wanted = Number(body.count);
      const count = Number.isInteger(wanted) && wanted > 1 ? Math.min(wanted, INVITE_MAX_BATCH) : 1;
      if (invites.length + count > INVITE_MAX) {
        json(res, 400, { error: "too_many" }, { cors: false });
        return;
      }
      const created = [];
      for (let i = 0; i < count; i += 1) {
        const invite = {
          id: crypto.randomBytes(4).toString("hex"),
          code: newInviteCode(),
          note,
          disabled: false,
          created: Date.now(),
          uses: 0,
          lastUsed: 0,
        };
        invites.push(invite);
        created.push(invite);
      }
      saveInvites();
      json(res, 200, { invites, required: betaRequired(), created }, { cors: false });
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin-api/invites/toggle") {
      const body = await readBody(req, BODY_ADMIN_MAX);
      const id = String(body.id || "").trim();
      const invite = invites.find((item) => item.id === id);
      if (!invite) {
        json(res, 404, { error: "not_found" }, { cors: false });
        return;
      }
      invite.disabled = body.disabled !== false;
      saveInvites();
      json(res, 200, { invites, required: betaRequired() }, { cors: false });
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/admin-api/invites") {
      const body = await readBody(req, BODY_ADMIN_MAX);
      const id = String(body.id || "").trim();
      invites = invites.filter((item) => item.id !== id);
      saveInvites();
      json(res, 200, { invites, required: betaRequired() }, { cors: false });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin-api/admin-path") {
      json(res, 200, { path: ADMIN_PATH }, { cors: false });
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin-api/admin-path") {
      const body = await readBody(req, BODY_TINY_MAX);
      const next = parseAdminPath(body.path);
      if (!next) {
        json(res, 400, { error: "bad_path" }, { cors: false });
        return;
      }
      saveAdminPath(next);
      ADMIN_PATH = next;
      console.log(`ruta de admin cambiada a /${next}`);
      json(res, 200, { path: ADMIN_PATH }, { cors: false });
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin-api/logo") {
      let raw;
      try {
        raw = await readLimited(req, LOGO_JSON_MAX);
      } catch {
        json(res, 413, { error: "too_large" }, { cors: false });
        return;
      }
      let body;
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        json(res, 400, { error: "json" }, { cors: false });
        return;
      }
      const mime = String(body.mime || "").toLowerCase();
      const ext = LOGO_TYPES[mime];
      if (!ext) {
        json(res, 400, { error: "tipo" }, { cors: false });
        return;
      }
      let bytes;
      try {
        bytes = Buffer.from(String(body.data || ""), "base64");
      } catch {
        json(res, 400, { error: "datos" }, { cors: false });
        return;
      }
      if (!bytes.length || bytes.length > LOGO_MAX_BYTES || !looksLikeImage(mime, bytes)) {
        json(res, 400, { error: "tamano" }, { cors: false });
        return;
      }
      fs.mkdirSync(BRAND_DIR, { recursive: true });
      for (const name of fs.readdirSync(BRAND_DIR)) {
        fs.unlinkSync(path.join(BRAND_DIR, name));
      }
      const file = `logo${ext}`;
      fs.writeFileSync(path.join(BRAND_DIR, file), bytes);
      const meta = { file, mime, updated: Date.now() };
      fs.writeFileSync(BRAND_META_PATH, JSON.stringify(meta));
      json(res, 200, { logo: true, mime, updated: meta.updated }, { cors: false });
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/admin-api/logo") {
      fs.rmSync(BRAND_DIR, { recursive: true, force: true });
      json(res, 200, { logo: false }, { cors: false });
      return;
    }
    json(res, 404, { error: "ruta" }, { cors: false });
    return;
  }
  res.writeHead(404);
  res.end();
}

const httpServer = http.createServer((req, res) => {
  void onHttp(req, res).catch((error) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof TooLarge) {
      // Se responde 413 y, una vez enviada, se corta el socket para no seguir
      // leyendo un cuerpo enorme que ya se descarto.
      res.on("finish", () => {
        try {
          req.destroy();
        } catch {
          // ignore
        }
      });
      json(res, 413, { error: "too_large" }, { cors: false });
      return;
    }
    json(res, 500, { error: "server" }, { cors: false });
  });
});
const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 20 * 1024 * 1024,
  perMessageDeflate: false,
});

function slim(info) {
  return { rpub: info.rpub, name: info.name || "", interests: info.interests || [] };
}

function snapshot(exceptRpub) {
  const peers = [];
  for (const info of byRpub.keys()) {
    if (info === exceptRpub) continue;
    const ws = byRpub.get(info);
    const row = ws ? live.get(ws) : null;
    if (row) peers.push(slim(row));
  }
  return peers;
}

function pushRoster() {
  for (const [client, info] of live) {
    if (!info?.rpub || client.readyState !== client.OPEN) continue;
    send(client, { type: "peers", peers: snapshot(info.rpub) });
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastRaw(raw, exceptWs) {
  for (const client of live.keys()) {
    if (client === exceptWs || client.readyState !== client.OPEN) continue;
    client.send(raw);
  }
}

function findByRpub(rpub) {
  const ws = byRpub.get(rpub);
  if (!ws) return null;
  if (live.get(ws)?.rpub !== rpub) {
    byRpub.delete(rpub);
    return null;
  }
  return ws;
}

function bindSocket(ws, info) {
  const old = byRpub.get(info.rpub);
  if (old && old !== ws) {
    live.delete(old);
    try {
      old.close();
    } catch {
      // ignore
    }
  }
  // Un socket solo sirve a una identidad. Si quedara una entrada rancia de un
  // rpub anterior, al reconectar ese rpub el buscale y echaría este socket.
  for (const [rpub, owner] of byRpub) {
    if (owner === ws && rpub !== info.rpub) byRpub.delete(rpub);
  }
  live.set(ws, info);
  byRpub.set(info.rpub, ws);
}

function boxFor(boxes, to) {
  let box = boxes.get(to);
  if (!box) {
    box = { list: [], bytes: 0, t: Date.now() };
    boxes.set(to, box);
  }
  return box;
}

function holdFor(to, envelope) {
  if (!to || !envelope || typeof envelope !== "object") return;
  if (envelope.type === "presence") return;
  let raw;
  try {
    raw = JSON.stringify(envelope);
  } catch {
    return;
  }
  if (raw.length > MAILBOX_BYTES) return;
  const box = boxFor(mailbox, to);
  if (envelope.sig && box.list.some((item) => item && item.sig === envelope.sig)) return;
  box.list.push(envelope);
  box.bytes += raw.length;
  while (box.list.length > MAILBOX_MAX || box.bytes > MAILBOX_BYTES * MAILBOX_MAX) {
    const dropped = box.list.shift();
    if (dropped) box.bytes -= JSON.stringify(dropped).length;
  }
  box.t = Date.now();
}

function drainMailbox(rpub) {
  const box = mailbox.get(rpub);
  mailbox.delete(rpub);
  return box?.list ?? [];
}

function holdBlob(to, chunk) {
  if (!to || !chunk || typeof chunk.hash !== "string") return;
  let size = 0;
  try {
    size = JSON.stringify(chunk).length;
  } catch {
    return;
  }
  if (size > BLOBBOX_BYTES) return;
  const box = boxFor(blobbox, to);
  box.list.push(chunk);
  box.bytes += size;
  while (box.list.length > BLOBBOX_MAX || box.bytes > BLOBBOX_BYTES) {
    const dropped = box.list.shift();
    if (dropped) box.bytes -= JSON.stringify(dropped).length;
  }
  box.t = Date.now();
}

function drainBlobs(rpub) {
  const box = blobbox.get(rpub);
  blobbox.delete(rpub);
  return box?.list ?? [];
}

/** Vacia buzones caducados para que la RAM del relay no dependa de quien no vuelve. */
function sweepBoxes() {
  const now = Date.now();
  for (const boxes of [mailbox, blobbox]) {
    for (const [rpub, box] of boxes) {
      if (now - box.t > BOX_TTL_MS) boxes.delete(rpub);
    }
  }
}

function removeSocket(ws) {
  const info = live.get(ws);
  live.delete(ws);
  if (!info) return;
  if (byRpub.get(info.rpub) === ws) byRpub.delete(info.rpub);
  if (!byRpub.has(info.rpub)) {
    broadcastRaw(JSON.stringify({ type: "leave", rpub: info.rpub }), ws);
  }
}

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.clientIp = clientIp(req);
  if (socketsForIp(ws.clientIp) > MAX_IP_SOCKETS) {
    try {
      ws.close();
    } catch {
      // ignore
    }
    return;
  }
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  issueChallenge(ws);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    const known = live.get(ws);
    // Cada tipo tiene su cupos. `pic` y `need-blob` estaban exentos del limite
    // general: `need-blob` se difunde a todos los peers pidiendo que reenvien el
    // blob, asi que sin tope un atacante lo usaba de amplificador de imagenes.
    if (known) {
      const [max, windowMs] = MESSAGE_LIMITS[msg.type] ?? MESSAGE_LIMITS.default;
      if (tooMany(`msg:${known.rpub}:${msg.type}`, max, windowMs)) return;
    }

    if (msg.type === "hello" && typeof msg.rpub === "string") {
      const already = live.get(ws);
      // Una conexion = una identidad. Si el socket ya esta sirviendo a otro
      // rpub, re-vincularlo dejaba entradas ranciadas en byRpub y hacia que
      // `previous?.name` metiera en el roster un nombre que el titular nunca
      // firmo. Para cambiar de identidad hay que reconectar.
      if (already && already.rpub !== msg.rpub) {
        send(ws, { type: "error", error: "rpub_switch" });
        issueChallenge(ws);
        return;
      }
      if (!already) {
        if (tooMany(`hello:${msg.rpub}`, 60, 60_000)) {
          send(ws, { type: "error", error: "hello_rate" });
          issueChallenge(ws);
          return;
        }
        if (tooMany(`hello-ip:${ws.clientIp}`, 240, 60_000)) {
          send(ws, { type: "error", error: "hello_rate" });
          issueChallenge(ws);
          return;
        }
      }
      if (!powOk(msg.rpub, msg.pow)) {
        send(ws, { type: "error", error: "pow" });
        issueChallenge(ws);
        return;
      }
      if (!helloAuthOk(msg, ws)) {
        send(ws, { type: "error", error: "auth" });
        issueChallenge(ws);
        return;
      }
      ws.nonce = null;
      // La beta cerrada exige un codigo vigente para listarse y conectar. Se
      // comprueba aqui (servidor), no solo en el cliente, para que un codigo
      // revocado no sirva para entrar.
      if (!inviteValid(msg.invite)) {
        send(ws, { type: "error", error: "invite" });
        issueChallenge(ws);
        return;
      }
      const ipKeys = rpubsForIp(ws.clientIp);
      if (!already && !ipKeys.has(msg.rpub) && ipKeys.size >= MAX_IP_RPUBS) {
        send(ws, { type: "error", error: "hello_rate" });
        issueChallenge(ws);
        return;
      }
      const previousWs = byRpub.get(msg.rpub);
      const previous = previousWs ? live.get(previousWs) : undefined;
      const first = !previous || previousWs !== ws;
      // Solo lo que el titular firmo. Sin fallback a `previous`: cualquier
      // nombre aqui es o esta firmado o esta vacio.
      const name = typeof msg.name === "string" ? msg.name.slice(0, HELLO_NAME_MAX) : "";
      const interests = Array.isArray(msg.interests)
        ? msg.interests.filter((x) => typeof x === "string").slice(0, HELLO_INTERESTS_MAX)
        : [];
      bindSocket(ws, { rpub: msg.rpub, name, interests });
      send(ws, { type: "hello-ok", rpub: msg.rpub });
      issueChallenge(ws);
      if (first) {
        broadcastRaw(JSON.stringify({ type: "join", peer: slim(live.get(ws)) }), ws);
      }
      pushRoster();
      send(ws, { type: "moderation-changed" });
      const pending = drainMailbox(msg.rpub);
      if (pending.length) send(ws, { type: "held", envelopes: pending });
      const blobs = drainBlobs(msg.rpub);
      for (const chunk of blobs) send(ws, chunk.type === "pic" ? chunk : { type: "blob", ...chunk });
      return;
    }

    if (msg.type === "pic" && typeof msg.hash === "string" && typeof msg.to === "string" && typeof msg.data === "string") {
      const from = live.get(ws);
      if (!from) return;
      const payload = {
        type: "pic",
        hash: msg.hash,
        mime: typeof msg.mime === "string" ? msg.mime : "image/jpeg",
        data: msg.data,
      };
      const target = findByRpub(msg.to);
      if (target) send(target, payload);
      else if (msg.data.length <= 12_000_000) holdBlob(msg.to, payload);
      return;
    }

    if (msg.type === "blob" && typeof msg.hash === "string" && typeof msg.to === "string") {
      const from = live.get(ws);
      if (!from) return;
      const chunk = {
        hash: msg.hash,
        mime: typeof msg.mime === "string" ? msg.mime : "image/jpeg",
        tier: msg.tier === "hq" ? "hq" : "mq",
        i: msg.i,
        n: msg.n,
        size: msg.size,
        data: msg.data,
      };
      const target = findByRpub(msg.to);
      if (target) send(target, { type: "blob", ...chunk });
      else holdBlob(msg.to, chunk);
      return;
    }

    if (msg.type === "need-blob" && typeof msg.hash === "string") {
      const from = live.get(ws);
      if (!from) return;
      const payload = { type: "need-blob", hash: msg.hash, from: from.rpub };
      for (const [other, info] of live) {
        if (other === ws || info.rpub === from.rpub) continue;
        send(other, payload);
      }
      return;
    }

    if (msg.type === "hold" && typeof msg.to === "string" && msg.envelope) {
      const from = live.get(ws);
      if (!from) return;
      if (tooMany(`hold:${from.rpub}`, 30, 60_000)) return;
      const target = findByRpub(msg.to);
      if (target) {
        send(target, { type: "held", envelopes: [msg.envelope] });
      } else {
        holdFor(msg.to, msg.envelope);
      }
      return;
    }

    if (msg.type === "scan" || msg.type === "ping") {
      issueChallenge(ws);
      const info = live.get(ws);
      if (!info) return;
      send(ws, { type: "peers", peers: snapshot(info.rpub) });
      return;
    }

    if (msg.type === "signal" && typeof msg.to === "string" && msg.payload) {
      const from = live.get(ws);
      if (!from) return;
      const target = findByRpub(msg.to);
      if (!target) return;
      send(target, { type: "signal", from: from.rpub, payload: msg.payload });
    }
  });

  ws.on("close", () => removeSocket(ws));
  ws.on("error", () => removeSocket(ws));
});

const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const [key, row] of hits) {
    if (row.reset < now) hits.delete(key);
  }
  sweepBoxes();
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 8000);
heartbeat.unref?.();

httpServer.listen(PORT, HOST, () => {
  console.log(`MagicRita signal (RAM only, no store) ws://${HOST}:${PORT}`);
  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    console.warn(`Define ADMIN_USER y ADMIN_PASSWORD en .env para el panel /${ADMIN_PATH}`);
  } else {
    console.log(`Admin panel: http://localhost:5173/${ADMIN_PATH}`);
  }
});
