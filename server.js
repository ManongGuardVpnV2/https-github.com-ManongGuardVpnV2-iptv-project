// server.js
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const TOKEN_DURATION = 60 * 60 * 1000;       // 1 hour
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL = 30 * 60 * 1000;      // cleanup interval

// in-memory stores
let tokens = {};   // token -> expiry
let sessions = {}; // sessionId -> expiry
let usedTokens = new Set();

// paths
const PUBLIC_DIR = path.join(__dirname, "public");
const CHANNELS_FILE = path.join(__dirname, "data", "channels.json");

// --- helpers ---
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
  const types = { ".html":"text/html", ".js":"application/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml" };
  const mime = types[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
  res.end(data);
}

// cleanup expired tokens/sessions
setInterval(() => {
  const t = now();
  for (const k in tokens) if (tokens[k] < t) delete tokens[k];
  for (const k in sessions) if (sessions[k] < t) delete sessions[k];
  usedTokens = new Set([...usedTokens].filter(x => x in tokens));
}, CLEANUP_INTERVAL);

// --- HTTP server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  const cookies = parseCookies(req);

  // --- Generate token ---
  if (url.pathname === "/generate-token" && method === "GET") {
    const t = createToken();
    return sendJSON(res, 200, { token: t.token, expiry: t.expiry });
  }

  // --- Validate token ---
  if (url.pathname === "/validate-token" && method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      let token = null;
      const ctype = (req.headers["content-type"] || "").split(";")[0];
      try {
        if (ctype === "application/json") {
          token = JSON.parse(body || "{}").token;
        } else if (ctype === "application/x-www-form-urlencoded") {
          token = new URLSearchParams(body || "").get("token");
        }
      } catch(e){ token = null; }

      if (!validateToken(token)) {
        if (ctype === "application/x-www-form-urlencoded") {
          res.writeHead(302, { Location: "/?error=invalid" });
          return res.end();
        }
        return sendJSON(res, 400, { success: false, error: "Invalid or expired token" });
      }

      useToken(token);
      const { sessionId, expiry } = createSession();

      const isSecure = (process.env.NODE_ENV === "production") || (req.headers["x-forwarded-proto"] === "https");
      const secureFlag = isSecure ? "Secure; " : "";
      const cookie = `sessionId=${encodeURIComponent(sessionId)}; HttpOnly; ${secureFlag}SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_DURATION/1000)}`;
      res.setHeader("Set-Cookie", cookie);

      if (ctype === "application/x-www-form-urlencoded") {
        res.writeHead(302, { Location: "/iptv" });
        return res.end();
      }
      return sendJSON(res, 200, { success: true, expiry });
    });
    return;
  }

  // --- Check session ---
  if (url.pathname === "/check-session" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) return sendJSON(res, 401, { success: false });
    return sendJSON(res, 200, { success: true, expiry: sessions[sid] });
  }

  // --- Refresh session ---
  if (url.pathname === "/refresh-session" && method === "POST") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) return sendJSON(res, 400, { success: false });
    refreshSession(sid);
    return sendJSON(res, 200, { success: true });
  }

  // --- Protected channels ---
  if (url.pathname === "/channels" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) return sendJSON(res, 401, { success: false, error: "Unauthorized" });

    if (!fs.existsSync(CHANNELS_FILE) || !fs.statSync(CHANNELS_FILE).isFile()) {
      return sendJSON(res, 500, { success: false, error: "Channels file missing" });
    }

    try {
      const text = fs.readFileSync(CHANNELS_FILE, "utf8");
      const parsed = JSON.parse(text);
      const safe = parsed.map(ch => ({
        name: ch.name,
        logo: ch.logo,
        manifestUri: ch.manifestUri,
        category: ch.category
      }));
      return sendJSON(res, 200, { success: true, channels: safe });
    } catch(e){
      return sendJSON(res, 500, { success: false, error: "Error parsing channels" });
    }
  }

  // --- Serve IPTV page ---
  if (url.pathname === "/iptv" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) { res.writeHead(302, { Location: "/" }); return res.end(); }

    const htmlPath = path.join(PUBLIC_DIR, "index.html");
    if (!fs.existsSync(htmlPath) || !fs.statSync(htmlPath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("index.html not found");
    }

    let html = fs.readFileSync(htmlPath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    return res.end(html);
  }

  // --- Serve static files ---
  if (method === "GET") {
    const rel = url.pathname.replace(/^\/+/, "");
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
