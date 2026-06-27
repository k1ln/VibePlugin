// app.js — the static gallery: list + search published synths/effects.
// Reads a prebuilt catalogue (data/index.json) — no server. The build script
// scripts/build-gallery.mjs regenerates index.json from the committed .vstai files.

const grid   = document.getElementById("grid");
const empty  = document.getElementById("empty");
const search = document.getElementById("search");

let all = [];   // full catalogue, filtered client-side

function card(p) {
  const el = document.createElement("div");
  el.className = "card";
  const badge = p.isInstrument ? '<span class="badge synth">SYNTH</span>'
                               : '<span class="badge fx">EFFECT</span>';
  el.innerHTML =
    `<div class="card-head"><span class="card-name"></span>${badge}</div>
     <p class="card-desc"></p>
     <div class="card-actions">
       <a class="btn accent" href="play.html?id=${encodeURIComponent(p.id)}">▶ Play</a>
       <a class="btn" href="data/${encodeURIComponent(p.id)}.vstai" download="${encodeURIComponent(p.id)}.vstai">Download</a>
       <span class="muted small">${p.params} param${p.params === 1 ? "" : "s"}</span>
     </div>`;
  el.querySelector(".card-name").textContent = p.name;
  el.querySelector(".card-desc").textContent = p.explanation || "";
  return el;
}

function render() {
  const q = search.value.trim().toLowerCase();
  const rows = q
    ? all.filter((r) => r.name.toLowerCase().includes(q) ||
                        (r.explanation || "").toLowerCase().includes(q))
    : all;

  grid.innerHTML = "";
  empty.hidden = rows.length > 0;
  if (!rows.length) empty.textContent = q ? `No results for “${search.value.trim()}”.`
                                          : "Nothing published yet.";
  for (const p of rows) grid.appendChild(card(p));
}

search.addEventListener("input", render);

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
})();
