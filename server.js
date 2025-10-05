// server.js
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24h

let sessions = {}; // sessionId -> expiry

const PUBLIC_DIR = path.join(__dirname, "public");
const CHANNELS_FILE = path.join(__dirname, "data", "channels.json");

const now = () => Date.now();

// --- helpers ---
function createSession() {
  const id = crypto.randomBytes(16).toString("hex");
  sessions[id] = now() + SESSION_DURATION;
  return id;
}

function validateSession(id) {
  return id && sessions[id] && now() <= sessions[id];
}

function refreshSession(id) {
  if (!validateSession(id)) return false;
  sessions[id] = now() + SESSION_DURATION;
  return true;
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  return raw.split(";").map(s => s.trim()).reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return acc;
    const k = pair.slice(0, idx);
    const v = pair.slice(idx + 1);
    acc[k] = decodeURIComponent(v);
    return acc;
  }, {});
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html":"text/html",
    ".js":"application/javascript",
    ".css":"text/css",
    ".json":"application/json",
    ".png":"image/png",
    ".jpg":"image/jpeg",
    ".svg":"image/svg+xml"
  };
  const mime = types[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
  res.end(data);
}

// --- HTTP server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  const cookies = parseCookies(req);

  // --- API: create session token ---
  if (url.pathname === "/login" && method === "POST") {
    const sessionId = createSession();
    res.setHeader("Set-Cookie", `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION/1000}`);
    res.writeHead(302, { Location: "/iptv" });
    return res.end();
  }

  // --- API: fetch channels ---
  if (url.pathname === "/channels" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) return sendJSON(res, 401, { success: false, error: "Unauthorized" });

    if (!fs.existsSync(CHANNELS_FILE)) return sendJSON(res, 200, { success: true, channels: [] });
    try {
      const text = fs.readFileSync(CHANNELS_FILE, "utf8");
      const parsed = JSON.parse(text);
      // remove sensitive keys if needed
      const safe = parsed.map(ch => {
        const { name, logo, manifestUri, category } = ch;
        return { name, logo, manifestUri, category };
      });
      return sendJSON(res, 200, { success: true, channels: safe });
    } catch(e) {
      return sendJSON(res, 500, { success: false, error: "Channels file error" });
    }
  }

  // --- Serve IPTV page ---
  if (url.pathname === "/iptv" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) {
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    refreshSession(sid);
    const htmlPath = path.join(PUBLIC_DIR, "index.html");
    return serveStaticFile(res, htmlPath);
  }

  // --- Serve login page ---
  if ((url.pathname === "/" || url.pathname === "/index.html") && method === "GET") {
    const loginPath = path.join(PUBLIC_DIR, "index.html"); // your login page HTML
    return serveStaticFile(res, loginPath);
  }

  // --- Serve static files ---
  if (method === "GET") {
    const rel = url.pathname.replace(/^\/+/, "");
    if (!rel) { res.writeHead(404); return res.end("Not Found"); }
    const candidate = path.join(PUBLIC_DIR, rel);
    if (candidate.startsWith(PUBLIC_DIR) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return serveStaticFile(res, candidate);
    }
  }

  // default 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
