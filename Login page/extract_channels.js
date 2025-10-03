// extract_channels.js
// Usage: node extract_channels.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicHtml = path.join(__dirname, "public", "myiptv.html");
const outDir = path.join(__dirname, "data");
const outFile = path.join(outDir, "channels.json");

if (!fs.existsSync(publicHtml)) {
  console.error("public/myiptv.html not found. Put your file at public/myiptv.html");
  process.exit(1);
}

let html = fs.readFileSync(publicHtml, "utf8");

// Try to find JSON inside script tags using a few patterns:
// 1) var channels = [ ... ];
// 2) window.channels = [ ... ];
// 3) a bare large JSON array present somewhere <script> [ ... ] </script>
// We'll search for the first balanced array [] that parses as JSON.

function findFirstJsonArray(s) {
  // find first '[' and then attempt to parse until matching bracket
  const start = s.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; ++i) {
    const ch = s[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i+1);
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) return { json: parsed, start, end: i+1, text: candidate };
        } catch (e) {
          // ignore and continue searching for next '[' occurrence
        }
      }
    }
  }
  return null;
}

const found = findFirstJsonArray(html);
if (!found) {
  console.log("No JSON array found in public/myiptv.html. No changes made.");
  process.exit(0);
}

// Ensure data directory exists
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Write channels.json (pretty)
fs.writeFileSync(outFile, JSON.stringify(found.json, null, 2), "utf8");
console.log("Wrote", outFile);

// Remove the JSON snippet from HTML.
// We'll remove the particular slice and also remove enclosing <script> tags if present.
let newHtml = html.slice(0, found.start) + html.slice(found.end);

// Attempt to clean up leftover "var channels = " or similar tokens around start area
newHtml = newHtml.replace(/(var|let|const)\s+channels\s*=\s*;?/g, "");
newHtml = newHtml.replace(/window\.\w*channels\s*=\s*;?/g, "");

// Insert a small loader that will use the protected endpoint if window.protectedChannels not available.
// Place it before </body> if present.
const loader = `
<script>
  // placeholder loader: will use window.protectedChannels if server injected it,
  // otherwise will fetch /channels with credentials included.
  (function(){
    function handleProtectedChannels(payload){
      try{
        if(!payload) return;
        if(Array.isArray(payload)) return window.protectedChannels = payload;
        if(payload && payload.channels) return window.protectedChannels = payload.channels;
        if(payload.success && payload.channels) return window.protectedChannels = payload.channels;
      }catch(e){}
    }
    // if server injected channels already (rare), leave as-is
    if(window.protectedChannels) handleProtectedChannels(window.protectedChannels);
    else {
      fetch('/channels', { credentials: 'include', cache: 'no-store' })
        .then(r=>r.json()).then(j=>{ handleProtectedChannels(j); }).catch(()=>{});
    }
    // expose hook for server-injected script
    window.__onProtectedChannels = function(ch){ handleProtectedChannels(ch); };
  })();
</script>
`;

// Insert loader
if (newHtml.includes("</body>")) newHtml = newHtml.replace("</body>", loader + "</body>");
else newHtml += loader;

// Backup old file
fs.copyFileSync(publicHtml, publicHtml + ".bak." + Date.now());
fs.writeFileSync(publicHtml, newHtml, "utf8");
console.log("Updated public/myiptv.html (backup created). Done.");
