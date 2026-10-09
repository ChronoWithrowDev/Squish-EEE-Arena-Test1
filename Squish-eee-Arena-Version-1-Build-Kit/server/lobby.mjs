/**
 * SQUISH-EEE ARENA — shared LAN lobby + signalling server.
 *
 * Used in two places:
 *   • `node server.mjs`          — a plain Node process (dev / manual hosting)
 *   • `electron/main.cjs`        — embedded in the Windows desktop build, so the
 *                                  host player never has to launch anything else
 *
 * It also serves the built game over HTTP when `staticDir` is provided. That is
 * what lets the packaged desktop app point its window at `http://127.0.0.1:PORT`
 * instead of a `file://` URL — which in turn means the in-game lobby's default
 * server address is already correct with no configuration.
 *
 * Node built-ins only. Zero npm dependencies.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { networkInterfaces } from "node:os";

const ROOM_TTL = 30_000; // a peer that stops pinging for this long is dropped

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

/** IPv4 addresses other machines on this network can reach us on. */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolveBody) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolveBody(d ? JSON.parse(d) : {});
      } catch {
        resolveBody({});
      }
    });
    // never hang on a malformed request
    req.on("error", () => resolveBody({}));
  });
}

/**
 * Builds the lobby/signalling HTTP server.
 * @param {{ staticDir?: string, onLog?: (msg: string) => void }} opts
 */
export function createLobbyServer({ staticDir, onLog } = {}) {
  const log = (m) => (onLog ? onLog(m) : console.log(m));

  const peers = new Map(); // peerId -> { room, name, kind, role, lastSeen, queue }
  const pollers = new Map(); // peerId -> { resolve, timer, room }

  const roleOf = (peerId) => (peerId === "host" ? "host" : "client");

  const presenceOf = (room) => {
    const out = [];
    for (const [id, p] of peers) {
      if (p.room !== room || Date.now() - p.lastSeen > ROOM_TTL) continue;
      out.push({ peer: id, name: p.name, kind: p.kind, role: p.role });
    }
    out.sort(
      (a, b) => (a.role === "host" ? -1 : 0) - (b.role === "host" ? -1 : 0) || a.peer.localeCompare(b.peer),
    );
    return out;
  };

  function kick(peerId) {
    const pol = pollers.get(peerId);
    if (!pol) return;
    clearTimeout(pol.timer);
    const p = peers.get(peerId);
    if (p && p.queue.length) {
      const msg = p.queue.shift();
      pol.resolve({ status: 200, body: JSON.stringify({ type: "msg", from: msg.from, data: msg.data }) });
    } else {
      pol.resolve({
        status: 200,
        body: JSON.stringify({ type: "presence", peers: presenceOf(pol.room) }),
      });
    }
    pollers.delete(peerId);
  }

  function announcePresence(room, exceptPeer) {
    const snap = JSON.stringify(presenceOf(room));
    for (const [id, p] of peers) {
      if (p.room !== room || id === exceptPeer || Date.now() - p.lastSeen > ROOM_TTL) continue;
      p.queue.push({ from: "lobby", data: { type: "presence", peers: JSON.parse(snap) } });
      kick(id);
    }
  }

  function enqueue(room, from, to, data) {
    const p = peers.get(to);
    if (p && p.room === room) p.queue.push({ from, data });
    kick(to);
  }

  // ------------------------------------------------------------ static files
  const staticRoot = staticDir ? resolve(staticDir) : null;

  async function serveStatic(req, res, url) {
    if (!staticRoot) return false;
    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      pathname = "/";
    }
    if (pathname === "/") pathname = "/index.html";

    // Normalising inside a leading "/" strips any ".." segments, so a request
    // can never escape the game directory.
    const safe = normalize(`/${pathname}`);
    const target = resolve(staticRoot, `.${safe}`);
    if (target !== staticRoot && !target.startsWith(staticRoot + sep)) {
      res.writeHead(403, CORS).end("Forbidden");
      return true;
    }

    let filePath = target;
    let info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) {
      // unknown routes fall back to the single-page bundle
      filePath = resolve(staticRoot, "index.html");
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      res.writeHead(404, CORS).end("Not found");
      return true;
    }

    try {
      const body = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": "no-cache",
        ...CORS,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500, CORS).end("Read error");
    }
    return true;
  }

  // ------------------------------------------------------------------ routes
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }

    // health/status endpoint (JSON, never the game page)
    if (req.method === "GET" && path === "/health") {
      const rooms = new Set();
      for (const p of peers) rooms.add(p.room);
      return json(res, 200, { ok: true, rooms: [...rooms], peers: peers.size });
    }

    if (req.method === "POST" && path === "/join") {
      const { room, peer, name, kind } = await readBody(req);
      if (!room || !peer) return json(res, 400, { ok: false, err: "room and peer required" });
      const existing = peers.get(peer);
      const fresh = !existing;
      peers.set(peer, {
        room,
        name: name || (peer === "host" ? "Host" : "Squishy"),
        kind: kind || "lion",
        role: roleOf(peer),
        lastSeen: Date.now(),
        queue: existing ? existing.queue : [],
      });
      if (fresh) announcePresence(room, peer);
      return json(res, 200, { ok: true, peers: presenceOf(room) });
    }

    if (req.method === "POST" && path === "/msg") {
      const { room, from, to, data } = await readBody(req);
      if (!room || !from || !data) return json(res, 400, { ok: false, err: "room, from and data required" });
      const sender = peers.get(from);
      if (sender) sender.lastSeen = Date.now();
      if (to === "*" || !to) {
        const snap = JSON.stringify(data);
        for (const [id, p] of peers) {
          if (p.room !== room || id === from || Date.now() - p.lastSeen > ROOM_TTL) continue;
          p.queue.push({ from, data: JSON.parse(snap) });
          kick(id);
        }
      } else {
        enqueue(room, from, to, data);
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/leave") {
      const { peer } = await readBody(req);
      const p = peers.get(peer);
      if (p) {
        const room = p.room;
        peers.delete(peer);
        announcePresence(room, peer);
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/poll") {
      const room = url.searchParams.get("room");
      const peer = url.searchParams.get("peer");
      if (!room || !peer) return json(res, 400, { ok: false, err: "room and peer required" });
      const p = peers.get(peer);
      if (!p) return json(res, 404, { ok: false, err: "unknown peer — join first" });
      p.lastSeen = Date.now();

      return new Promise((resolveRoute) => {
        if (p.queue.length) {
          const msg = p.queue.shift();
          json(res, 200, { type: "msg", from: msg.from, data: msg.data });
          return resolveRoute();
        }
        let settled = false;
        const finish = (out) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          json(res, 200, out);
          resolveRoute();
        };
        const timer = setTimeout(() => finish({ type: "presence", peers: presenceOf(room) }), 25_000);
        pollers.set(peer, { resolve: finish, timer, room });
      });
    }

    // everything else: the game itself
    if (await serveStatic(req, res, url)) return;

    json(res, 404, { ok: false, err: "not found" });
  });

  // drop dead peers so the lobby stays accurate
  const sweeper = setInterval(() => {
    let changed = false;
    for (const [id, p] of peers) {
      if (Date.now() - p.lastSeen > ROOM_TTL) {
        peers.delete(id);
        changed = true;
      }
    }
    if (changed) {
      const rooms = new Set([...peers.values()].map((p) => p.room));
      for (const r of rooms) announcePresence(r, null);
    }
  }, 5_000);
  sweeper.unref();

  server.on("close", () => {
    clearInterval(sweeper);
    for (const { resolve: r, timer } of pollers.values()) {
      clearTimeout(timer);
      r({ status: 503, body: JSON.stringify({ type: "presence", peers: [] }) });
    }
    pollers.clear();
    peers.clear();
    log("lobby server closed");
  });

  return server;
}
