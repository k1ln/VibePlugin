#!/usr/bin/env node
// gui-roundtrip.mjs — the GUI's own packing code (independent JS implementation) must produce byte-identical slot
// values to pack.mjs for every patch sheet and 25 random patches (cables included), and decode them back (the DAW
// automation / session-restore path) to the same logical values.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { P, SRC_IDX } from "../params.mjs";
import { L, slotDefaults, rawToActual, actualToRaw } from "../pack.mjs";
import { PRESETS } from "../presets.mjs";

const root = new URL("../../..", import.meta.url).pathname;
const gui = readFileSync(join(root, "factory/plugins/kgrbdpa/gui.html"), "utf8");
let seed = 424242;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const resolve = (set) => { const o = {}; for (const [k, v] of Object.entries(set)) o[k] = k.startsWith("PB_") && typeof v === "string" ? SRC_IDX[v] : v; return o; };
const patches = PRESETS.map((p) => resolve(p.set));
for (let n = 0; n < 25; n++) { const o = {}; for (const p of P) o[p.key] = p.direct ? p.min + rnd() * (p.max - p.min) : rawToActual(p, Math.floor(rnd() * p.steps)); patches.push(o); }
const full = patches.map((o) => { const f = {}; for (const p of P) f[p.key] = o[p.key] !== undefined ? o[p.key] : p.def; return f; });
const expectSlots = full.map((f) => slotDefaults(f));

const stub = `<script>window.__last={};window.vstai={onReady:function(f){setTimeout(f,0)},setParam:function(i,v){window.__last[i]=v},onParam:function(cb){window.__onParam=cb},onDisplay:function(){},noteOn:function(){},noteOff:function(){}};</script>`;
const test = `<pre id="qa"></pre><script>
setTimeout(function(){
  var PATCHES=${JSON.stringify(full)}, EXPECT=${JSON.stringify(expectSlots)}, out={enc:[],dec:[],err:[]};
  try {
    for (var n=0;n<PATCHES.length;n++){
      __kg.applyPatch(PATCHES[n]);
      var slots=[]; for (var s=0;s<__kg.NSLOT;s++) slots.push(window.__last[s]); out.enc.push({pushed:slots});
      __kg.applyPatch({});
      for (var s2=0;s2<__kg.NSLOT;s2++) window.__onParam(s2, EXPECT[n][s2]);
      out.dec.push(JSON.parse(JSON.stringify(__kg.V)));
    }
  } catch(e){ out.err.push(String(e&&e.stack||e)); }
  document.getElementById("qa").textContent=JSON.stringify(out);
},400);
</script>`;
const html = gui.replace("<body>", "<body>" + stub).replace("</body>", test + "</body>");
const dir = mkdtempSync(join(tmpdir(), "kg-gui-"));
writeFileSync(join(dir, "qa.html"), html);
const dom = execFileSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--virtual-time-budget=20000", "--dump-dom", "file://" + join(dir, "qa.html")],
  { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const m = dom.match(/<pre id="qa">([\s\S]*?)<\/pre>/);
if (!m) { console.log("no result from page"); process.exit(1); }
const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
let bad = 0;
if (out.err.length) { console.log("PAGE ERROR", out.err[0]); bad++; }
out.enc.forEach((e, n) => e.pushed.forEach((v, s) => { if (Math.abs(v - expectSlots[n][s]) > 1e-9) { if (bad++ < 10) console.log(`ENCODE patch ${n} slot ${s}: gui ${v} vs pack.mjs ${expectSlots[n][s]}`); } }));
out.dec.forEach((V, n) => { for (const p of P) { const want = p.direct ? full[n][p.key] : rawToActual(p, actualToRaw(p, full[n][p.key])); const got = V[p.key]; if (!(Math.abs(got - want) <= Math.max(1e-6, Math.abs(want) * 1e-6))) { if (bad++ < 10) console.log(`DECODE patch ${n} ${p.key}: gui ${got} want ${want}`); } } });
console.log(`gui round trip: ${out.enc.length} patches (${PRESETS.length} presets + ${out.enc.length - PRESETS.length} random), ${L.slots} slots each, ${bad} problems`);
process.exit(bad ? 1 : 0);
