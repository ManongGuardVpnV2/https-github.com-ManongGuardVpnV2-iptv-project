// server.js (ESM)
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;

// Paths
const PUBLIC_DIR = path.join(__dirname, "public");
const CHANNELS_FILE = path.join(__dirname, "data", "channels.json");

// Session in memory
let sessions = {};
const SESSION_DURATION = 24 * 60 * 60 * 1000;

// Utilities
const now = () => Date.now();

function createSession() {
  const id = crypto.randomBytes(16).toString("hex");
  sessions[id] = now() + SESSION_DURATION;
  return id;
}

function validateSession(id) {
  return id && sessions[id] && sessions[id] > now();
}

function parseCookies(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return {};
  return cookie.split(";").map(c => c.trim()).reduce((acc, pair) => {
    const [k, v] = pair.split("=");
    acc[k] = decodeURIComponent(v || "");
    return acc;
  }, {});
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function serveFile(res, filePath, type) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": type });
  res.end(data);
}

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cookies = parseCookies(req);
  const sessionId = cookies.sessionId;

  // Login page
  if (url.pathname === "/" && req.method === "GET") {
    const loginHtml = `
      <!doctype html>
      <html><head><meta charset="utf-8"><title>Login</title></head>
      <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f3f4f6">
        <div style="padding:20px;background:#fff;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,0.1);width:360px;text-align:center">
          <h2>Access IPTV</h2>
          <form method="POST" action="/login">
            <input name="password" type="password" placeholder="Enter access code" style="padding:10px;width:100%;margin-bottom:10px;border:1px solid #ccc;border-radius:6px">
            <button type="submit" style="padding:10px;width:100%;border:none;border-radius:6px;background:#2563eb;color:white">Login</button>
          </form>
        </div>
      </body></html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(loginHtml);
  }

  // Handle login
  if (url.pathname === "/login" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const password = params.get("password");
      // simple hardcoded key, you can make it env var
      if (password === "iptv2025") {
        const sid = createSession();
        res.setHeader("Set-Cookie", `sessionId=${sid}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION / 1000}`);
        res.writeHead(302, { Location: "/iptv" });
        return res.end();
      } else {
        res.writeHead(302, { Location: "/?error=1" });
        return res.end();
      }
    });
    return;
  }

  // IPTV page
  if (url.pathname === "/iptv" && req.method === "GET") {
    if (!validateSession(sessionId)) {
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    const filePath = path.join(PUBLIC_DIR, "index.html");
    return serveFile(res, filePath, "text/html");
  }

  // Channels API
  if (url.pathname === "/channels" && req.method === "GET") {
    if (!validateSession(sessionId)) {
      return sendJSON(res, 401, { success: false, error: "Unauthorized" });
    }
    try {
      const data = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
      const safe = data.map(ch => ({
        name: ch.name,
        logo: ch.logo,
        manifestUri: ch.manifestUri,
        category: ch.category
      }));
      return sendJSON(res, 200, { success: true, channels: safe });
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: "File error" });
    }
  }

  // Serve static assets
  if (req.method === "GET") {
    const filePath = path.join(PUBLIC_DIR, url.pathname);
    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const types = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml"
      };
      return serveFile(res, filePath, types[ext] || "application/octet-stream");
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
