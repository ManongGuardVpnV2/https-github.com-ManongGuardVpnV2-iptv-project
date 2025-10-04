// server.js (ESM)
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

// in-memory stores (use Redis for production)
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

// cleanup periodically
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

  // --- API: generate token ---
  if (url.pathname === "/generate-token" && method === "GET") {
    const t = createToken();
    return sendJSON(res, 200, { token: t.token, expiry: t.expiry });
  }

  // --- API: validate token (accept JSON or form POST) ---
  if (url.pathname === "/validate-token" && method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      let token = null;
      const ctype = (req.headers["content-type"] || "").split(";")[0];
      try {
        if (ctype === "application/json") {
          const j = JSON.parse(body || "{}");
          token = j.token;
        } else if (ctype === "application/x-www-form-urlencoded") {
          const p = new URLSearchParams(body || "");
          token = p.get("token");
        } else {
          try { token = JSON.parse(body || "{}").token; } catch(e) { token = null; }
        }
      } catch (e) {
        token = null;
      }

      if (!validateToken(token)) {
        // if coming from form post, redirect back
        if (ctype === "application/x-www-form-urlencoded") {
          res.writeHead(302, { Location: "/?error=invalid" });
          return res.end();
        }
        return sendJSON(res, 400, { success: false, error: "Invalid or expired token" });
      }

      useToken(token);
      const { sessionId, expiry } = createSession();

      // cookie flags: Secure only in production or if request had X-Forwarded-Proto https
      const isSecure = (process.env.NODE_ENV === "production") || (req.headers["x-forwarded-proto"] === "https");
      const secureFlag = isSecure ? "Secure; " : "";

      const cookie = `sessionId=${encodeURIComponent(sessionId)}; HttpOnly; ${secureFlag}SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_DURATION/1000)}`;
      res.setHeader("Set-Cookie", cookie);

      // if form POST, redirect to /iptv so browser navigates and accepts cookie
      if (ctype === "application/x-www-form-urlencoded") {
        res.writeHead(302, { Location: "/iptv" });
        return res.end();
      }
      return sendJSON(res, 200, { success: true, expiry });
    });
    return;
  }

  // --- API: check-session ---
  if (url.pathname === "/check-session" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) return sendJSON(res, 401, { success: false });
    return sendJSON(res, 200, { success: true, expiry: sessions[sid] });
  }

  // --- API: refresh-session ---
  if (url.pathname === "/refresh-session" && method === "POST") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) return sendJSON(res, 400, { success: false });
    refreshSession(sid);
    return sendJSON(res, 200, { success: true });
  }

  // --- API: protected channels (reads from data/channels.json only) ---
  if (url.pathname === "/channels" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) return sendJSON(res, 401, { success: false, error: "Unauthorized" });

    if (!fs.existsSync(CHANNELS_FILE)) return sendJSON(res, 200, { success: true, channels: [] });
    try {
      const text = fs.readFileSync(CHANNELS_FILE, "utf8");
      const parsed = JSON.parse(text);
      // IMPORTANT: you may want to remove sensitive fields before sending (e.g., clearKey)
      const safe = parsed.map(ch => {
        const { name, logo, manifestUri, category } = ch;
        return { name, logo, manifestUri, category };
      });
      return sendJSON(res, 200, { success: true, channels: safe });
    } catch (e) {
      return sendJSON(res, 500, { success: false, error: "Channels file error" });
    }
  }

  // --- Serve /iptv (inject countdown bar only) ---
  if (url.pathname === "/iptv" && method === "GET") {
    const sid = cookies.sessionId;
    if (!validateSession(sid)) {
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    const htmlPath = path.join(PUBLIC_DIR, "myiptv.html");
    if (!fs.existsSync(htmlPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("myiptv.html not found");
    }
    let html = fs.readFileSync(htmlPath, "utf8");

    // inject small countdown bar & client script (no channels JSON embedded)
    const barId = "sbar_" + crypto.randomBytes(3).toString("hex");
    const inject = `
<div id="${barId}" style="position:fixed;bottom:0;left:0;width:100%;height:40px;background:linear-gradient(90deg,#1E40AF,#3B82F6);color:white;display:flex;align-items:center;justify-content:center;font-family:monospace;font-weight:700;z-index:2147483647;">Loading session...</div>
<script>
(function(){
  const bar=document.getElementById("${barId}");
  function goLogin(){ location.href='/'; }
  fetch('/check-session',{cache:'no-store',credentials:'include'}).then(r=>r.json()).then(j=>{
    if(!j.success){ goLogin(); return; }
    let expiry=j.expiry;
    setInterval(()=>{ fetch('/refresh-session',{method:'POST',credentials:'include'}).catch(()=>{}); },5*60*1000);
    setInterval(()=>{ const d=expiry-Date.now(); if(d<=0){ try{ alert('Session expired'); }catch(e){} goLogin(); return;} const h=Math.floor((d/3600000)%24), m=Math.floor((d/60000)%60), s=Math.floor((d/1000)%60); bar.innerText='Session expires in: '+h+'h '+m+'m '+s+'s'; },1000);
  }).catch(goLogin);

  // basic devtools deterrents
  document.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('keydown',e=>{ if(e.key==='F12' || (e.ctrlKey&&e.shiftKey&&['I','J','C'].includes(e.key)) || (e.ctrlKey&&e.key==='U')) e.preventDefault(); });
  if(window.top!==window.self){ try{ window.top.location = window.self.location; }catch(e){ goLogin(); } }
})();
</script>
`;
    if (html.includes("</body>")) html = html.replace("</body>", inject + "</body>");
    else html += inject;

    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    return res.end(html);
  }

  // --- Serve login page (root) ---
  if ((url.pathname === "/" || url.pathname === "/login") && method === "GET") {
    const loginHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title></head><body style="font-family:Arial,Helvetica,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f3f4f6">
<div style="width:360px;background:#fff;padding:20px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,0.08)">
  <h2 style="margin:0 0 12px">Access IPTV</h2>
  <button id="gen" style="width:100%;padding:10px;margin-bottom:8px;background:#059669;color:#fff;border:none;border-radius:6px">Generate Token</button>
  <form id="f" method="POST" action="/validate-token" style="display:flex;flex-direction:column;gap:8px">
    <input name="token" id="token" type="password" placeholder="Paste token" style="padding:10px;border-radius:6px;border:1px solid #ccc"/>
    <button type="submit" style="padding:10px;border-radius:6px;border:none;background:#2563eb;color:#fff">Login</button>
  </form>
  <p id="msg" style="color:#666;margin-top:8px;height:18px"></p>
</div>
<script>
document.getElementById('gen').addEventListener('click', async function(){
  try{
    const r = await fetch('/generate-token', { method:'GET', credentials:'include' });
    const j = await r.json();
    if (j.token) { document.getElementById('token').value = j.token; document.getElementById('msg').innerText='Token generated'; try{ await navigator.clipboard.writeText(j.token);}catch(e){} }
    else document.getElementById('msg').innerText='Failed';
  } catch(e){ document.getElementById('msg').innerText='Error'; }
});
</script>
</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    return res.end(loginHtml);
  }

  // --- Serve static files from public (only) ---
  if (method === "GET") {
    // sanitize path; disallow ../
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
