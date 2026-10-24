#!/usr/bin/env node
// preset-browser-demo.mjs
// =====================================================================
//  Try the in-plugin sound browser ("Pro browser") in a normal browser, no DAW.
//
//      node scripts/preset-browser-demo.mjs [--port 8765] [--fresh] [--bin <path>]
//      then open http://localhost:8765
//
//  What is real: the page loads the plugin's actual bridge shim (extracted from
//  src/BridgeShim.h) and ui/preset-browser.js, and every request goes to the plugin's
//  actual host-side code (src/PresetController.h) through tests/preset_bridge_cli.cpp.
//  What is faked: the synth itself — eight knob bars stand in for the sound, so you can
//  see a sound load, then randomise the knobs and save your own.
//
//  Your saved demo sounds persist (<app-data>/VibePlugin Demo/Demo Synth/presets.json);
//  --fresh wipes them first.
//
//  Build the bridge once:  cmake --build build --target vstai_preset_bridge
//  (needs -DVSTAI_BUILD_TESTS=ON or any configure of this repo; no WASM/plugin needed)
// =====================================================================
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg("--port", 8765);

function findBin() {
  const given = arg("--bin", "");
  if (given) return given;
  const name = process.platform === "win32" ? "vstai_preset_bridge.exe" : "vstai_preset_bridge";
  const roots = [REPO, ...readdirSync(REPO).filter((d) => d.startsWith("build")).map((d) => path.join(REPO, d))];
  for (const r of roots)
    for (const cfg of ["Release", "Debug", ""]) {
      const p = path.join(r, "vstai_preset_bridge_artefacts", cfg, name);
      if (existsSync(p)) return p;
    }
  return "";
}
const BIN = findBin();
if (!BIN) { console.error("vstai_preset_bridge not built. Run: cmake --build build --target vstai_preset_bridge"); process.exit(1); }

// ---- the real C++ host behind a line protocol, requests answered strictly in order -----
const child = spawn(BIN, [], { env: { ...process.env, VSTAI_DEMO_FRESH: process.argv.includes("--fresh") ? "1" : "0" }, stdio: ["pipe", "pipe", "inherit"] });
let buf = "", waiting = [];
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const w = waiting.shift(); if (w) w(line); }
});
let chain = Promise.resolve();
const ask = (line) => (chain = chain.then(() => new Promise((res) => { waiting.push(res); child.stdin.write(line + "\n"); })));

// ---- pieces of the real plugin ----------------------------------------------------------
const shim = (() => {
  const h = readFileSync(path.join(REPO, "src", "BridgeShim.h"), "utf8");
  const m = h.match(/kBridgeShim = R"JS\(([\s\S]*?)\)JS";/);
  if (!m) throw new Error("could not extract the bridge shim from BridgeShim.h");
  return m[1];
})();

// The script the plugin really injects: the pieces baked into src/PresetBrowserUi.h, joined.
const bakedUi = (() => {
  const h = readFileSync(path.join(REPO, "src", "PresetBrowserUi.h"), "utf8");
  const parts = [...h.matchAll(/R"PBUI\(([\s\S]*?)\)PBUI"/g)].map((m) => m[1]);
  if (!parts.length) throw new Error("could not extract the baked sound browser from PresetBrowserUi.h");
  return parts.join("");
})();
// Mirrors vstai::shim::withBridge: charset meta + restored values + shim + sound browser, right after <head>.
const withBridge = (html) => {
  const inject = '<meta charset="utf-8"><script>window.__vstaiRestored={};</script>' + shim + bakedUi;
  const i = html.search(/<head>/i);
  return i >= 0 ? html.slice(0, i + 6) + inject + html.slice(i + 6) : inject + html;
};

const PARAMS = ["Cutoff", "Resonance", "Attack", "Decay", "Sustain", "Release", "Drive", "Volume"];
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Demo Synth — sound browser</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;background:#0e1319;color:#dfe5ec;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .plugin{max-width:760px;margin:36px auto;padding:22px 26px;background:#141a22;border:1px solid #232d39;border-radius:12px}
  h1{margin:0 0 4px;font-size:20px;letter-spacing:.06em}.sub{color:#8a95a5;margin-bottom:18px}
  .bar{display:flex;gap:8px;align-items:center;margin-bottom:22px}
  button{font:inherit;color:inherit;background:#1d242d;border:1px solid #2c3541;border-radius:6px;padding:7px 14px;cursor:pointer}
  button:hover{background:#26303b}#soundBtn{background:#6fd8bd;color:#06231c;border-color:#6fd8bd;font-weight:600}
  #name{flex:1;color:#6fd8bd;font-weight:600}
  .knobs{display:grid;grid-template-columns:repeat(8,1fr);gap:14px;height:150px}
  .k{display:flex;flex-direction:column;align-items:center;gap:6px}.k .t{flex:1;width:14px;background:#0b1016;border-radius:7px;position:relative;overflow:hidden}
  .k .f{position:absolute;left:0;right:0;bottom:0;background:#6fd8bd;transition:height .2s}.k small{color:#8a95a5;font-size:11px}.k b{font-size:11px;font-weight:400}
  .note{margin-top:20px;color:#8a95a5;font-size:12px}
</style></head><body>
<div class="plugin">
  <h1>DEMO SYNTH</h1><div class="sub">A stand-in for a generated plugin. The sound browser is the real one.</div>
  <div class="bar"><button id="prev" title="Previous sound">‹</button><div id="name">—</div><button id="next" title="Next sound">›</button>
    <button id="saveBtn">Save</button><button id="soundBtn">☰ Sounds</button><button id="rand">Randomise knobs</button></div>
  <div class="knobs">${PARAMS.map((p, i) => `<div class="k"><div class="t"><div class="f" id="f${i}" style="height:0%"></div></div><b id="v${i}">0.00</b><small>${p}</small></div>`).join("")}</div>
  <div class="note">Load a sound, nudge the knobs with <i>Randomise</i>, then press <b>Save</b>. Your sounds are kept between runs.</div>
</div>
${shim}
<script>
  // The page's own key handler (like a generated GUI's typing piano): the browser must keep it from seeing keys typed into its fields.
  window.__keydowns = 0; document.addEventListener('keydown', function(){ window.__keydowns++; });
  async function knobs(){ try { return await (await fetch('/demo/knobs')).json(); } catch(e){ return null; } }
  async function refresh(){ var k = await knobs(); if(!k) return; k.forEach(function(v,i){ document.getElementById('f'+i).style.height=(v*100)+'%'; document.getElementById('v'+i).textContent=v.toFixed(2); }); }
  setInterval(refresh, 250); refresh();
  document.getElementById('soundBtn').onclick = function(){ vstai.toggleBrowser(); };
  document.getElementById('saveBtn').onclick = function(){ vstai.saveSound(); };
  document.getElementById('prev').onclick = function(){ vstai.prevPreset(); };
  document.getElementById('next').onclick = function(){ vstai.nextPreset(); };
  document.getElementById('rand').onclick = function(){ fetch('/demo/randomize'); };
  function showName(d){ var n=''; d.entries.forEach(function(e){ if(e.id===d.current) n=e.name; }); document.getElementById('name').textContent = n || '—'; }
  window.addEventListener('load', function(){ vstai.presets.onChange(showName); vstai.presets.list(); });
</script>
<script src="/preset-browser.js"></script>
</body></html>`;

const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (code, type, body) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
  try {
    if (u.pathname === "/") return send(200, "text/html;charset=utf-8", page);
    // A real design kit / generated GUI with the plugin's real injection:  /gui/<name>  (ui/designs/<name>.html or "standard")
    if (u.pathname.startsWith("/gui/")) {
      const name = path.basename(u.pathname.slice(5));
      const file = name === "standard" ? path.join(REPO, "ui", "standard.html") : path.join(REPO, "ui", "designs", name + ".html");
      if (!existsSync(file)) return send(404, "text/plain", "no such design");
      return send(200, "text/html;charset=utf-8", withBridge(readFileSync(file, "utf8")));
    }
    if (u.pathname === "/designs.json") return send(200, "application/json", JSON.stringify([...readdirSync(path.join(REPO, "ui", "designs")).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)), "standard"]));
    if (u.pathname === "/preset-browser.js") return send(200, "text/javascript;charset=utf-8", readFileSync(path.join(REPO, "ui", "preset-browser.js")));
    if (u.pathname === "/__vstai/ping") return send(200, "text/plain", "ok");
    if (u.pathname.startsWith("/__vstai/presets/")) return send(200, "application/json;charset=utf-8", await ask(req.url.split("?")[0]));
    if (u.pathname.startsWith("/__vstai/")) return send(200, "text/plain", "ok");
    if (u.pathname === "/demo/knobs") return send(200, "application/json", await ask("__knobs"));
    if (u.pathname === "/demo/revealed") return send(200, "text/plain", await ask("__revealed"));
    if (u.pathname === "/demo/set") { await ask(`__set ${+u.searchParams.get("i")} ${+u.searchParams.get("v")}`); return send(200, "text/plain", "ok"); }
    if (u.pathname === "/demo/randomize") { for (let i = 0; i < 8; i++) await ask(`__set ${i} ${Math.random().toFixed(3)}`); return send(200, "text/plain", "ok"); }
    send(404, "text/plain", "not found");
  } catch (e) { send(500, "text/plain", String(e)); }
});
server.listen(PORT, () => console.log(`Sound browser demo: http://localhost:${PORT}   (Ctrl+C to stop)`));
process.on("SIGINT", () => { child.stdin.write("__quit\n"); process.exit(0); });
export { server };
