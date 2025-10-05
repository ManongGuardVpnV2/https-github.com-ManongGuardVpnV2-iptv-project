import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const CHANNELS_FILE = path.join(__dirname, "data", "channels.json");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Serve channels.json securely
  if (url.pathname === "/channels" && req.method === "GET") {
    if (!fs.existsSync(CHANNELS_FILE)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([]));
    }
    const raw = fs.readFileSync(CHANNELS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    // Remove sensitive fields (like clearKey)
    const safe = parsed.map(ch => {
      const { name, logo, manifestUri, category } = ch;
      return { name, logo, manifestUri, category };
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(safe));
  }

  // Serve static files (HTML, JS, CSS)
  let filePath = path.join(PUBLIC_DIR, req.url === "/" ? "index.html" : req.url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
    const mime = types[ext] || "application/octet-stream";
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime });
    return res.end(data);
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
