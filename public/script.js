// script.js

let channels = [];
let currentIndex = 0;

// --- Check session on page load ---
async function checkSession() {
  try {
    const res = await fetch("/check-session", { credentials: "include", cache: "no-store" });
    const data = await res.json();
    if (!data.success) {
      alert("Session expired or unauthorized. Redirecting to login.");
      location.href = "/";
      return false;
    }
    // Refresh session every 5 minutes
    setInterval(() => fetch("/refresh-session", { method: "POST", credentials: "include" }).catch(()=>{}), 5*60*1000);
    return true;
  } catch (err) {
    console.error("❌ Session check failed:", err);
    location.href = "/";
    return false;
  }
}

// --- Load channels from server ---
async function loadChannels() {
  try {
    const res = await fetch("/channels", { credentials: "include", cache: "no-store" });
    const data = await res.json();
    if (!data.success) {
      console.error("❌ Unauthorized or failed to fetch channels");
      return;
    }

    channels = data.channels;

    renderCategoryFilters();
    renderChannelRows();

    // Auto-play last saved channel or first channel
    const savedIndex = parseInt(localStorage.getItem("lastChannelIndex"));
    currentIndex = (!isNaN(savedIndex) && channels[savedIndex]) ? savedIndex : 0;
    const card = document.querySelector(`.channel[data-index="${currentIndex}"]`);
    flipChannel(card, currentIndex);

  } catch (err) {
    console.error("❌ Failed to load channels:", err);
  }
}

// --- Render category filters ---
function renderCategoryFilters() {
  const categories = [...new Set(channels.map(ch => ch.category))];
  const container = document.getElementById("categoryFilters");
  if (!container) return;
  container.innerHTML = "";
  categories.forEach(cat => {
    const btn = document.createElement("button");
    btn.innerText = cat;
    btn.addEventListener("click", () => filterByCategory(cat));
    container.appendChild(btn);
  });
}

// --- Filter channels by category ---
function filterByCategory(category) {
  const rows = document.querySelectorAll(".channel");
  rows.forEach((ch, idx) => {
    ch.style.display = channels[idx].category === category ? "" : "none";
  });
}

// --- Render channel rows ---
function renderChannelRows() {
  const container = document.getElementById("channelContainer");
  if (!container) return;
  container.innerHTML = "";
  channels.forEach((ch, idx) => {
    const div = document.createElement("div");
    div.className = "channel";
    div.dataset.index = idx;
    div.innerHTML = `
      <img src="${ch.logo}" alt="${ch.name}" />
      <p>${ch.name}</p>
    `;
    div.addEventListener("click", () => flipChannel(div, idx));
    container.appendChild(div);
  });
}

// --- Play / flip channel ---
function flipChannel(card, idx) {
  if (!card || !channels[idx]) return;
  currentIndex = idx;
  localStorage.setItem("lastChannelIndex", idx);
  // Update player source
  const player = document.getElementById("player");
  if (player) player.src = channels[idx].manifestUri;
  // Highlight active
  document.querySelectorAll(".channel").forEach(c => c.classList.remove("active"));
  card.classList.add("active");
}

// --- Devtools deterrent (optional) ---
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("keydown", e => {
  if (e.key === "F12" || (e.ctrlKey && e.shiftKey && ["I","J","C"].includes(e.key)) || (e.ctrlKey && e.key==="U")) e.preventDefault();
});
if (window.top !== window.self) try { window.top.location = window.self.location; } catch(e){}

// --- Initialize ---
(async function init() {
  const ok = await checkSession();
  if (!ok) return;
  await loadChannels();
})();
