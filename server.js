import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 10000;

// Paths
const PUBLIC = path.join(__dirname, "public");
const CHANNELS = path.join(__dirname, "data", "channels.json");

let sessions = {};
const DURATION = 24 * 60 * 60 * 1000; // 1 day

function newSession() {
  const id = crypto.randomBytes(16).toString("hex");
  sessions[id] = Date.now() + DURATION;
  return id;
}
function validSession(id) {
  return id && sessions[id] && sessions[id] > Date.now();
}
function cookies(req) {
  const c = req.headers.cookie || "";
  return Object.fromEntries(
    c.split(";").filter(Boolean).map(x => {
      const [k, v] = x.trim().split("=");
      return [k, decodeURIComponent(v)];
    })
  );
}
function send(res, code, type, body) {
  res.writeHead(code, { "Content-Type": type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cookie = cookies(req);

  // --- LOGIN PAGE ---
  if (url.pathname === "/" && req.method === "GET") {
    const html = `
    <html><head><meta charset="utf-8"><title>Login</title></head>
    <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f3f4f6">
      <form method="POST" action="/login" style="background:#fff;padding:20px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,0.1)">
        <h2>IPTV Access</h2>
        <input name="password" type="password" placeholder="Access Code" style="width:100%;padding:10px;margin:10px 0;border:1px solid #ccc;border-radius:6px">
        <button type="submit" style="width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:6px">Login</button>
      </form>
    </body></html>`;
    return send(res, 200, "text/html", html);
  }

  // --- LOGIN ACTION ---
  if (url.pathname === "/login" && req.method === "POST") {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const password = new URLSearchParams(body).get("password");
      if (password === "iptv2025") {
        const sid = newSession();
        res.setHeader("Set-Cookie", `session=${sid}; HttpOnly; Path=/; Max-Age=${DURATION / 1000}`);
        res.writeHead(302, { Location: "/iptv" });
        res.end();
      } else {
        res.writeHead(302, { Location: "/?error=1" });
        res.end();
      }
    });
    return;
  }

  // --- IPTV PAGE ---
  if (url.pathname === "/iptv") {
    if (!validSession(cookie.session)) {
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    const file = path.join(PUBLIC, "index.html");
    return send(res, 200, "text/html", fs.readFileSync(file));
  }

  // --- CHANNELS API ---
  if (url.pathname === "/channels") {
    if (!validSession(cookie.session)) {
      return send(res, 401, "application/json", JSON.stringify({ success: false, error: "Unauthorized" }));
    }
    const json = JSON.parse(fs.readFileSync(CHANNELS, "utf8"));
    const safe = json.map(({ name, logo, manifestUri, category }) => ({
      name,
      logo,
      manifestUri,
      category
    }));
    return send(res, 200, "application/json", JSON.stringify({ success: true, channels: safe }));
  }

  // --- STATIC FILES ---
  const filePath = path.join(PUBLIC, url.pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".png": "image/png",
      ".jpg": "image/jpeg"
    };
    return send(res, 200, types[ext] || "application/octet-stream", fs.readFileSync(filePath));
  }

  send(res, 404, "text/plain", "Not found");
});

server.listen(PORT, () => console.log(`✅ IPTV Server running on port ${PORT}`));
