// app.js — the catalogue: search and list published plugins.

const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const search = document.getElementById("search");

let timer = null;
search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 180); });

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
       <a class="btn" href="/api/plugins/${encodeURIComponent(p.id)}/download" download>Download</a>
       <span class="muted small">${p.params} param${p.params === 1 ? "" : "s"}</span>
     </div>`;
  el.querySelector(".card-name").textContent = p.name;
  el.querySelector(".card-desc").textContent = p.explanation || "";
  return el;
}

async function load() {
  const q = search.value.trim();
  let rows = [];
  try { rows = await (await fetch("/api/plugins?q=" + encodeURIComponent(q))).json(); }
  catch { grid.innerHTML = ""; empty.hidden = false; empty.textContent = "Catalogue server unreachable."; return; }

  grid.innerHTML = "";
  empty.hidden = rows.length > 0;
  if (!rows.length && q) { empty.hidden = false; empty.textContent = "No plugins match “" + q + "”."; }
  for (const p of rows) grid.appendChild(card(p));
}

load();
