// tune-levels.mjs — normalise every preset's loudness: VCA Gain for coarse trims, PATCHLVL for the
// fine trim → presets.levels.json
//   node factory/kheverest/tests/tune-levels.mjs <wasm>
import { writeFileSync } from "node:fs";
import { Engine, metrics, mono } from "./lab.mjs";
import { BANK } from "../presets-bank.mjs";

const e = new Engine(process.argv[2]);
const SR = 48000, TARGET = 0.10;
const out = {};

function scenario(p) {
  const arp = p.set.ARP_ON, cat = p.cat;
  const chord = arp || ["Pad", "Keys", "Strings", "Brass", "FX"].includes(cat);
  const notes = chord ? [48, 55, 60] : [52];
  const ev = [];
  notes.forEach((n) => { ev.push({ t: 0.02, type: "on", note: n, vel: 0.8 }); ev.push({ t: cat === "Percussive" ? 0.05 : 2.0, type: "off", note: n }); });
  return { ev, dur: cat === "Percussive" ? 1.5 : 3.2 };
}
function measure(p, set) {
  const sc = scenario(p);
  e.reset(SR); e.setPatch(set, 120);
  const o = mono(e.render(sc.dur, sc.ev));
  const w = Math.round(0.4 * SR); let best = 0;
  for (let i = 0; i + w < o.length; i += 2400) { let s = 0; for (let j = 0; j < w; j++) s += o[i + j] * o[i + j]; best = Math.max(best, Math.sqrt(s / w)); }
  return { rms: best, peak: metrics(o).peak };
}

for (const p of BANK) {
  const base = { ...p.set }; delete base.PATCHLVL; delete base.VCAGAIN;
  let vca = 127, lvl = 64, m = measure(p, { ...base, VCAGAIN: vca, PATCHLVL: lvl });
  if (m.rms < 1e-4) console.log("SILENT?", p.name);
  for (let it = 0; it < 3; it++) {
    const r = TARGET / Math.max(m.rms, 1e-5);
    if (r < 0.7) { vca = Math.max(16, Math.min(127, Math.round(vca * r / 0.9))); lvl = 64; }
    else lvl = Math.max(0, Math.min(128, Math.round((64 + 64 * Math.log2(r * Math.pow(2, (lvl - 64) / 64))) / 2) * 2));
    m = measure(p, { ...base, VCAGAIN: vca, PATCHLVL: lvl });
  }
  if (m.peak > 0.9) lvl = Math.max(0, Math.round((lvl + 64 * Math.log2(0.9 / m.peak)) / 2) * 2);
  out[p.name] = { PATCHLVL: lvl, ...(vca !== 127 ? { VCAGAIN: vca } : {}) };
}
writeFileSync(new URL("../presets.levels.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
const vals = Object.values(out).map((v) => v.PATCHLVL);
console.log(`${vals.length} levels written; PATCHLVL ${Math.min(...vals)}..${Math.max(...vals)}; at limits: ${Object.entries(out).filter(([, v]) => v.PATCHLVL <= 0 || v.PATCHLVL >= 128).map(([k]) => k).join(", ") || "none"}`);
