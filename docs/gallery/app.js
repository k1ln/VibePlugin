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
let kind = "all";      // all | synth | effect
let cat = null;        // one category name, or null for every category

// index.json rows carry `category` + `categoryOrder` (see scripts/build-gallery.mjs).
// Older rows without them fall into a single per-kind "Other" bucket.
const catOf = (p) => p.category || (p.isInstrument ? "Other Synths" : "Other Effects");
const kindOf = (p) => (p.isInstrument ? "synth" : "effect");
const catRank = (p) => (p.isInstrument ? 0 : 1000) + (p.categoryOrder == null ? 999 : p.categoryOrder);

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

// Kind tabs + one chip per category, with counts. Chips follow the kind tab and the
// search box, so a chip never leads to an empty list.
function renderFilters(inKind) {
  const tabs = document.getElementById("kindTabs"), chips = document.getElementById("catChips");
  tabs.innerHTML = ""; chips.innerHTML = "";
  for (const [k, label] of [["all", "All"], ["synth", "Synths"], ["effect", "Effects"]]) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tab" + (kind === k ? " active" : ""); b.textContent = label;
    b.addEventListener("click", () => { kind = k; cat = null; render(); });
    tabs.appendChild(b);
  }
  const counts = new Map();
  for (const p of inKind) {
    const c = catOf(p), e = counts.get(c) || { n: 0, rank: catRank(p) };
    e.n++; counts.set(c, e);
  }
  const chip = (label, n, on, fn) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip" + (on ? " active" : "");
    b.innerHTML = `<span></span><i>${n}</i>`; b.firstChild.textContent = label;
    b.addEventListener("click", fn); chips.appendChild(b);
  };
  chip("All", inKind.length, cat === null, () => { cat = null; render(); });
  for (const [c, e] of [...counts].sort((a, b) => a[1].rank - b[1].rank))
    chip(c, e.n, cat === c, () => { cat = cat === c ? null : c; render(); });
}

function render() {
  const q = search.value.trim().toLowerCase();
  const matches = q
    ? all.filter((r) => r.name.toLowerCase().includes(q) || (r.explanation || "").toLowerCase().includes(q))
    : all;
  const inKind = matches.filter((r) => kind === "all" || kindOf(r) === kind);
  if (cat && !inKind.some((r) => catOf(r) === cat)) cat = null;
  renderFilters(inKind);
  const rows = inKind.filter((r) => !cat || catOf(r) === cat);

  grid.innerHTML = "";
  empty.hidden = rows.length > 0;
  if (!rows.length) empty.textContent = q ? `No results for “${search.value.trim()}”.` : "Nothing published yet.";
  // grouped under a heading per category, in the catalogue's display order
  const groups = new Map();
  for (const p of rows) { const c = catOf(p); if (!groups.has(c)) groups.set(c, { rank: catRank(p), items: [] }); groups.get(c).items.push(p); }
  for (const [c, g] of [...groups].sort((a, b) => a[1].rank - b[1].rank)) {
    const h = document.createElement("h3");
    h.className = "group-head"; h.textContent = c;
    const n = document.createElement("span"); n.textContent = g.items.length; h.appendChild(n);
    grid.appendChild(h);
    for (const p of g.items) grid.appendChild(row(p));
  }
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
