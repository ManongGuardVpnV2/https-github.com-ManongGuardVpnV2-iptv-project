// server.js (ESM)
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;
const TOKEN_DURATION = 60 * 60 * 1000;
const SESSION_DURATION = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL = 30 * 60 * 1000;

let tokens = {};
let sessions = {};
let usedTokens = new Set();

const PUBLIC_DIR = path.join(__dirname, "public");
const CHANNELS_FILE = path.join(__dirname, "data", "channels.json");

const now = () => Date.now();

function createToken() {
  const token = crypto.randomBytes(8).toString("hex");
  tokens[token] = now() + TOKEN_DURATION;
  return { token, expiry: tokens[token] };
}

function validateToken(t) {
  return Boolean(t && tokens[t] && now() <= tokens[t] && !usedTokens.has(t));
}

function useToken(t) { usedTokens.add(t); delete tokens[t]; }

function createSession() {
  const id = crypto.randomBytes(16).toString("hex");
  sessions[id] = now() + SESSION_DURATION;
  return { sessionId: id, expiry: sessions[id] };
}

function validateSession(id) {
  return Boolean(id && sessions[id] && now() <= sessions[id]);
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  return Object.fromEntries(raw.split(";").map(s => s.trim().split("=")));
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = { ".html":"text/html", ".js":"application/javascript", ".css":"text/css", ".png":"image/png", ".jpg":"image/jpeg" };
  res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
  fs.createReadStream(filePath).pipe(res);
}

setInterval(() => {
  const t = now();
  for (const k in tokens) if (tokens[k] < t) delete tokens[k];
  for (const k in sessions) if (sessions[k] < t) delete sessions[k];
}, CLEANUP_INTERVAL);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  const cookies = parseCookies(req);

  if (url.pathname === "/generate-token" && method === "GET") {
    return sendJSON(res, 200, createToken());
  }

  if (url.pathname === "/validate-token" && method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const token = new URLSearchParams(body).get("token");
      if (!validateToken(token)) {
        res.writeHead(302, { Location: "/?error=invalid" });
        return res.end();
      }
      useToken(token);
      const { sessionId } = createSession();
      res.setHeader("Set-Cookie", `sessionId=${sessionId}; HttpOnly; Path=/`);
      res.writeHead(302, { Location: "/iptv" });
      res.end();
    });
    return;
  }

  if (url.pathname === "/channels" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) return sendJSON(res, 401, { success: false, error: "Unauthorized" });
    if (!fs.existsSync(CHANNELS_FILE)) return sendJSON(res, 200, { success: true, channels: [] });
    const channels = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
    return sendJSON(res, 200, { success: true, channels });
  }

  if (url.pathname === "/" && method === "GET") {
    return serveStaticFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  if (url.pathname === "/iptv" && method === "GET") {
    if (!validateSession(cookies.sessionId)) {
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    return serveStaticFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  const filePath = path.join(PUBLIC_DIR, url.pathname);
  if (fs.existsSync(filePath)) return serveStaticFile(res, filePath);

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
