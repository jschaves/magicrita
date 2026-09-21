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
const BLOCKS_PATH = path.join(ROOT, "..", "data", "admin-blocks.json");

/** @type {Map<import('ws').WebSocket, { rpub: string, name: string, interests: string[] }>} */
const live = new Map();
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
    json(res, 404, { error: "ruta" });
    return;
  }
  res.writeHead(404);
  res.end();
}

const httpServer = http.createServer((req, res) => {
  void onHttp(req, res);
});
const wss = new WebSocketServer({ server: httpServer, maxPayload: 20 * 1024 * 1024 });

function snapshot() {
  const seen = new Set();
  const peers = [];
  for (const info of live.values()) {
    if (seen.has(info.rpub)) continue;
    seen.add(info.rpub);
    peers.push({
      rpub: info.rpub,
      name: info.name,
      interests: info.interests,
      avatar: info.avatar,
    });
  }
  return peers;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function pushRoster() {
  const peers = snapshot();
  for (const [ws, info] of live) {
    send(ws, { type: "peers", peers: peers.filter((p) => p.rpub !== info.rpub) });
  }
}

function findByRpub(rpub) {
  for (const [ws, info] of live) {
    if (info.rpub === rpub) return ws;
  }
  return null;
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
  const stillThere = [...live.values()].some((peer) => peer.rpub === info.rpub);
  if (!stillThere) {
    const raw = JSON.stringify({ type: "leave", rpub: info.rpub });
    for (const client of live.keys()) {
      if (client.readyState === client.OPEN) client.send(raw);
    }
    pushRoster();
  }
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
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

    if (msg.type === "hello" && typeof msg.rpub === "string") {
      for (const [other, info] of [...live]) {
        if (info.rpub === msg.rpub && other !== ws) {
          live.delete(other);
          try {
            other.close();
          } catch {
            // ignore
          }
        }
      }
      const incomingAvatar =
        typeof msg.avatar === "string" && msg.avatar.startsWith("data:image/") ? msg.avatar : "";
      const previous = [...live.values()].find((info) => info.rpub === msg.rpub);
      live.set(ws, {
        rpub: msg.rpub,
        name: typeof msg.name === "string" && msg.name ? msg.name : previous?.name || "",
        interests: Array.isArray(msg.interests) ? msg.interests.filter((x) => typeof x === "string") : previous?.interests || [],
        avatar: incomingAvatar || previous?.avatar || "",
      });
      pushRoster();
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
      for (const [other, info] of live) {
        if (other === ws || info.rpub === from.rpub) continue;
        send(other, { type: "need-blob", hash: msg.hash, from: from.rpub });
      }
      return;
    }

    if (msg.type === "hold" && typeof msg.to === "string" && msg.envelope) {
      const from = live.get(ws);
      if (!from) return;
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
      send(ws, { type: "peers", peers: snapshot().filter((p) => p.rpub !== info.rpub) });
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
