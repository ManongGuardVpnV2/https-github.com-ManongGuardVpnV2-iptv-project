// server.js
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const CHANNELS_FILE = path.join(__dirname, "data", "channels.json");

// Serve static files
function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end("Not Found");
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = { ".html":"text/html", ".js":"application/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml" };
  const mime = types[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": mime });
  res.end(data);
}

// HTTP server
const server = http.createServer((req, res) => {
  const url = req.url;

  // Serve channels JSON
  if (url === "/channels") {
    if (!fs.existsSync(CHANNELS_FILE)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([]));
    }
    const text = fs.readFileSync(CHANNELS_FILE, "utf8");
    try {
      const parsed = JSON.parse(text);
      // remove sensitive fields
      const safe = parsed.map(ch => {
        const { name, logo, manifestUri, category } = ch;
        return { name, logo, manifestUri, category };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(safe));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: "Channels file error" }));
    }
  }

  // Serve static files from public
  let filePath = path.join(PUBLIC_DIR, url === "/" ? "index.html" : url);
  serveStatic(res, filePath);
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
