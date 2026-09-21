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
const BLOCKS_PATH = path.join(ROOT, "..", "data", "admin-blocks.json");
const BRAND_DIR = path.join(ROOT, "..", "data", "brand");
const BRAND_META_PATH = path.join(BRAND_DIR, "meta.json");
const LOGO_MAX_BYTES = 1_000_000;
const LOGO_JSON_MAX = 1_400_000;
const LOGO_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

/** @type {Map<import('ws').WebSocket, { rpub: string, name: string, interests: string[] }>} */
const live = new Map();
/** @type {Map<string, import('ws').WebSocket>} */
const byRpub = new Map();
/** Buzón RAM: sobres firmados para quien aún no está conectado. Sin disco. */
/** @type {Map<string, object[]>} */
const mailbox = new Map();
/** @type {Map<string, object[]>} */
const blobbox = new Map();
const MAILBOX_MAX = 250;
const MAILBOX_BYTES = 24_000;
const BLOBBOX_MAX = 400;

const sessions = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const POW_BITS = 16;
const POW_PREFIX = "rita-pow-v1";
const MAX_IP_SOCKETS = 4;
const MAX_IP_RPUBS = 8;
const hits = new Map();

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "0.0.0.0";
}

function inviteOk(code) {
  if (!BETA_INVITE) return true;
  const got = crypto.createHash("sha256").update(String(code || "")).digest();
  const expect = crypto.createHash("sha256").update(BETA_INVITE).digest();
  return crypto.timingSafeEqual(got, expect);
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

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function brandMeta() {
  try {
    const raw = JSON.parse(fs.readFileSync(BRAND_META_PATH, "utf8"));
    if (!raw || typeof raw.file !== "string" || typeof raw.mime !== "string") return null;
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
  if (mime === "image/svg+xml") {
    return buf.slice(0, 512).toString("utf8").toLowerCase().includes("<svg");
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
        reject(new Error("too_large"));
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

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(body));
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
  const msg = { type: "moderation", users: staffBlocks.users, comments: staffBlocks.comments };
  for (const ws of live.keys()) send(ws, msg);
}

async function onHttp(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }
  if (req.method === "GET" && url.pathname === "/moderation/blocks") {
    json(res, 200, staffBlocks);
    return;
  }
  if (req.method === "GET" && url.pathname === "/beta") {
    json(res, 200, { required: Boolean(BETA_INVITE) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/beta/check") {
    const body = await readBody(req);
    if (!inviteOk(body.invite)) {
      json(res, 403, { error: "invite_bad" });
      return;
    }
    json(res, 200, { ok: true, required: Boolean(BETA_INVITE) });
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
    });
    res.end(bytes);
    return;
  }
  if (req.method === "POST" && url.pathname === "/admin-api/login") {
    if (!ADMIN_USER || !ADMIN_PASSWORD) {
      json(res, 503, { error: "admin_not_configured" });
      return;
    }
    const body = await readBody(req);
    const user = String(body.user || "");
    const password = String(body.password || "");
    const userBuf = Buffer.from(user);
    const passBuf = Buffer.from(password);
    const expectUser = Buffer.from(ADMIN_USER);
    const expectPass = Buffer.from(ADMIN_PASSWORD);
    const userOk = userBuf.length === expectUser.length && crypto.timingSafeEqual(userBuf, expectUser);
    const passOk = passBuf.length === expectPass.length && crypto.timingSafeEqual(passBuf, expectPass);
    if (!userOk || !passOk) {
      json(res, 401, { error: "credenciales" });
      return;
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { exp: Date.now() + SESSION_MS });
    json(res, 200, { token, user: ADMIN_USER });
    return;
  }
  if (url.pathname.startsWith("/admin-api/")) {
    if (!validSession(bearer(req))) {
      json(res, 401, { error: "sesion" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin-api/session") {
      json(res, 200, { user: ADMIN_USER, live: snapshot() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin-api/blocks") {
      json(res, 200, staffBlocks);
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin-api/blocks") {
      const body = await readBody(req);
      const kind = body.kind === "comment" ? "comment" : "user";
      const id = String(body.id || "").trim();
      if (!id) {
        json(res, 400, { error: "id" });
        return;
      }
      if (kind === "user") staffBlocks.users = unique([...staffBlocks.users, id]);
      else staffBlocks.comments = unique([...staffBlocks.comments, id]);
      saveBlocks(staffBlocks);
      broadcastModeration();
      json(res, 200, staffBlocks);
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/admin-api/blocks") {
      const body = await readBody(req);
      const kind = body.kind === "comment" ? "comment" : "user";
      const id = String(body.id || "").trim();
      if (kind === "user") staffBlocks.users = staffBlocks.users.filter((x) => x !== id);
      else staffBlocks.comments = staffBlocks.comments.filter((x) => x !== id);
      saveBlocks(staffBlocks);
      broadcastModeration();
      json(res, 200, staffBlocks);
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin-api/logo") {
      let raw;
      try {
        raw = await readLimited(req, LOGO_JSON_MAX);
      } catch {
        json(res, 413, { error: "too_large" });
        return;
      }
      let body;
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        json(res, 400, { error: "json" });
        return;
      }
      const mime = String(body.mime || "").toLowerCase();
      const ext = LOGO_TYPES[mime];
      if (!ext) {
        json(res, 400, { error: "tipo" });
        return;
      }
      let bytes;
      try {
        bytes = Buffer.from(String(body.data || ""), "base64");
      } catch {
        json(res, 400, { error: "datos" });
        return;
      }
      if (!bytes.length || bytes.length > LOGO_MAX_BYTES || !looksLikeImage(mime, bytes)) {
        json(res, 400, { error: "tamano" });
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
      json(res, 200, { logo: true, mime, updated: meta.updated });
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/admin-api/logo") {
      fs.rmSync(BRAND_DIR, { recursive: true, force: true });
      json(res, 200, { logo: false });
      return;
    }
    json(res, 404, { error: "ruta" });
    return;
  }
  res.writeHead(404);
  res.end();
}

const httpServer = http.createServer((req, res) => {
  void onHttp(req, res);
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
  live.set(ws, info);
  byRpub.set(info.rpub, ws);
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
  const list = mailbox.get(to) ?? [];
  if (envelope.sig && list.some((item) => item && item.sig === envelope.sig)) return;
  list.push(envelope);
  while (list.length > MAILBOX_MAX) list.shift();
  mailbox.set(to, list);
}

function drainMailbox(rpub) {
  const list = mailbox.get(rpub);
  if (!list?.length) return [];
  mailbox.delete(rpub);
  return list;
}

function holdBlob(to, chunk) {
  if (!to || !chunk || typeof chunk.hash !== "string") return;
  const list = blobbox.get(to) ?? [];
  list.push(chunk);
  while (list.length > BLOBBOX_MAX) list.shift();
  blobbox.set(to, list);
}

function drainBlobs(rpub) {
  const list = blobbox.get(rpub);
  if (!list?.length) return [];
  blobbox.delete(rpub);
  return list;
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

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    const known = live.get(ws);
    if (known && tooMany(`msg:${known.rpub}`, 80, 60_000)) return;

    if (msg.type === "hello" && typeof msg.rpub === "string") {
      if (tooMany(`hello:${ws.clientIp}`, 10, 60_000)) return;
      if (!powOk(msg.rpub, msg.pow)) return;
      if (!inviteOk(msg.invite)) return;
      const ipKeys = rpubsForIp(ws.clientIp);
      if (!ipKeys.has(msg.rpub) && ipKeys.size >= MAX_IP_RPUBS) return;
      const previousWs = byRpub.get(msg.rpub);
      const previous = previousWs ? live.get(previousWs) : undefined;
      const first = !previous || previousWs !== ws;
      bindSocket(ws, {
        rpub: msg.rpub,
        name: typeof msg.name === "string" && msg.name ? msg.name : previous?.name || "",
        interests: Array.isArray(msg.interests)
          ? msg.interests.filter((x) => typeof x === "string").slice(0, 12)
          : previous?.interests || [],
      });
      if (first) {
        send(ws, { type: "peers", peers: snapshot(msg.rpub) });
        broadcastRaw(JSON.stringify({ type: "join", peer: slim(live.get(ws)) }), ws);
      }
      send(ws, { type: "moderation", users: staffBlocks.users, comments: staffBlocks.comments });
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
      else if (msg.data.length <= 500_000) holdBlob(msg.to, payload);
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
      const pool = [];
      for (const [other, info] of live) {
        if (other !== ws && info.rpub !== from.rpub) pool.push(other);
      }
      for (let n = 0; n < 8 && pool.length; n++) {
        const i = Math.floor(Math.random() * pool.length);
        send(pool[i], { type: "need-blob", hash: msg.hash, from: from.rpub });
        pool[i] = pool[pool.length - 1];
        pool.pop();
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
    console.warn("Define ADMIN_USER y ADMIN_PASSWORD en .env para el panel /topogue");
  } else {
    console.log(`Admin panel: http://localhost:5173/topogue`);
  }
});
