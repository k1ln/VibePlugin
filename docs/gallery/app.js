// app.js — the gallery: a searchable list (left) + a live player (right).
// Clicking an item loads it into the player pane and starts audio. Reads a
// prebuilt catalogue (data/index.json) — no server.

const grid   = document.getElementById("grid");
const empty  = document.getElementById("empty");
const search = document.getElementById("search");
const frame  = document.getElementById("playerFrame");
const hint   = document.getElementById("playerHint");

let all = [];
let currentId = null;

function row(p) {
  const el = document.createElement("button");
  el.className = "row";
  el.dataset.id = p.id;
  const badge = p.isInstrument ? '<span class="badge synth">SYNTH</span>'
                               : '<span class="badge fx">EFFECT</span>';
  el.innerHTML =
    `<div class="row-head"><span class="row-name"></span>${badge}</div>
     <p class="row-desc"></p>
     <div class="row-foot">
       <span class="muted small">${p.params} param${p.params === 1 ? "" : "s"}</span>
       <a class="row-dl" href="data/${encodeURIComponent(p.id)}.vstai" download="${p.id}.vstai" title="Download .vstai">↓ .vstai</a>
     </div>`;
  el.querySelector(".row-name").textContent = p.name;
  el.querySelector(".row-desc").textContent = p.explanation || "";
  el.querySelector(".row-dl").addEventListener("click", (e) => e.stopPropagation());
  el.addEventListener("click", () => select(p.id, true));
  return el;
}

function select(id, autostart) {
  currentId = id;
  hint.hidden = true;
  frame.src = "play.html?id=" + encodeURIComponent(id) + "&embed=1" + (autostart ? "&autostart=1" : "");
  for (const b of grid.querySelectorAll(".row")) b.classList.toggle("active", b.dataset.id === id);
}

function render() {
  const q = search.value.trim().toLowerCase();
  const rows = q
    ? all.filter((r) => r.name.toLowerCase().includes(q) || (r.explanation || "").toLowerCase().includes(q))
    : all;

  grid.innerHTML = "";
  empty.hidden = rows.length > 0;
  if (!rows.length) empty.textContent = q ? `No results for “${search.value.trim()}”.` : "Nothing published yet.";
  for (const p of rows) grid.appendChild(row(p));
  // keep the active highlight after a re-filter
  if (currentId) for (const b of grid.querySelectorAll(".row")) b.classList.toggle("active", b.dataset.id === currentId);
}

search.addEventListener("input", render);

// forward computer-key play to the player iframe when the gallery (not the search
// box) has focus — so A–K / Z–X reach the synth wherever you clicked.
function forwardKey(type) {
  return (e) => {
    if (document.activeElement === search) return;
    const w = frame.contentWindow;
    if (w) w.postMessage({ __vstai: 1, type, key: e.key, repeat: e.repeat }, "*");
  };
}
window.addEventListener("keydown", forwardKey("keydown"));
window.addEventListener("keyup", forwardKey("keyup"));

(async function load() {
  try {
    all = await (await fetch("data/index.json", { cache: "no-cache" })).json();
    if (!Array.isArray(all)) all = [];
  } catch {
    all = [];
    empty.hidden = false;
    empty.textContent = "Could not load the catalogue (data/index.json).";
    return;
  }
  render();
  // preload the first plugin so the player pane isn't empty (audio resumes on the
  // first click/keypress; selecting any item afterwards starts it immediately).
  if (all.length) select(all[0].id, true);
})();
