#!/usr/bin/env node
// quality.mjs <wasm> [--wav dir] [--sheet dir] — objective quality gate for every preset:
//   level / DC / NaN / tail, a per-category spectral fingerprint, and distinctness
//   (RMS dB distance of a 3-window × 16-band spectral map to the nearest other preset).
import { Engine, metrics, mono, decayTime, spectrum, writeWav, centroid } from "./lab.mjs";
import { PRESETS } from "../presets.mjs";
import { mkdirSync } from "node:fs";
const wasm = process.argv[2], SR = 48000;
const arg = (f) => { const i = process.argv.indexOf(f); return i < 0 ? null : process.argv[i + 1]; };
const wavDir = arg("--wav"); if (wavDir) mkdirSync(wavDir, { recursive: true });
const FIRST_NEW = +(arg("--first-new") || 52);
const EDGES = Array.from({ length: 17 }, (_, i) => 30 * Math.pow(18000 / 30, i / 16));
const winN = (t0, t1) => Math.min(32768, Math.max(1024, 2 ** Math.ceil(Math.log2((t1 - t0) * SR))));
function bands(m, t0, t1) {
  const { mag, binHz } = spectrum(m, SR, t0, t1, winN(t0, t1));
  const out = new Array(16).fill(0);
  for (let i = 1; i < mag.length; i++) { const f = i * binHz; if (f < EDGES[0] || f >= EDGES[16]) continue; let b = 0; while (b < 15 && f >= EDGES[b + 1]) b++; out[b] += mag[i] * mag[i]; }
  return out;
}
const tot = (a) => a.reduce((x, y) => x + y, 0) + 1e-18;
function frac(m, t0, t1, f0, f1) { const { mag, binHz } = spectrum(m, SR, t0, t1, winN(t0, t1)); let e = 0, t = 0; for (let i = 1; i < mag.length; i++) { const f = i * binHz, p = mag[i] * mag[i]; t += p; if (f >= f0 && f < f1) e += p; } return e / (t + 1e-18); }

const rows = [];
for (const [idx, pr] of PRESETS.entries()) {
  const long = pr.set.RV_DEC > 2 || pr.set.T_DEC > 2000 || pr.set.M_DEC > 2000 || pr.set.X_DEC > 1500 || pr.set.N_DEC > 1500;
  const sec = long ? 8 : 4;
  const e = new Engine(wasm, SR); e.setPatch(pr.set, 120);
  const buf = e.render(sec, [{ t: 0, type: "on", note: 36, vel: 0.95 }]);
  const m = mono(buf), met = metrics(buf);
  if (wavDir) writeWav(`${wavDir}/${String(idx).padStart(3, "0")}_${pr.name.replace(/[^A-Za-z0-9]+/g, "_")}.wav`, buf, SR);
  const w = [[0, 0.03], [0.03, 0.15], [0.15, 0.6]].map(([a, b]) => bands(m, a, b));
  const totAll = tot(w.flat());
  const vec = w.flat().map((x) => 10 * Math.log10(x / totAll + 1e-9));
  const issues = [];
  if (met.nan) issues.push("NaN");
  if (met.peak < 0.3 || met.peak > 0.97) issues.push(`peak ${met.peak.toFixed(2)}`);
  if (Math.abs(met.dc) > 0.01) issues.push(`dc ${met.dc.toFixed(3)}`);
  if (met.rms < 0.003) issues.push(`rms ${met.rms.toFixed(3)} too quiet`);
  const tailRms = Math.sqrt(m.slice(-Math.round(SR * 0.25)).reduce((s, v) => s + v * v, 0) / (SR * 0.25));
  if (tailRms > met.peak * 0.003) issues.push("tail still ringing at end");
  const nm = pr.name;
  switch (pr.cat) {
    case "Kick": { const f = frac(m, 0.08, 0.5, 20, 260); if (f < 0.5 && !/Scream|Terror|Stack|Industrial|Crush|Click|Minimal|Boxing/.test(nm)) issues.push(`kick low-band ${f.toFixed(2)}`); break; }
    case "Snare": { const hi = frac(m, 0, 0.15, 2000, 24000); if (hi < 0.25 && !/Rim|Side|Snap|Brush/.test(nm)) issues.push(`snare noise band ${hi.toFixed(2)}`); break; }
    case "Clap": { const mid = frac(m, 0, 0.3, 500, 12000); if (mid < 0.8) issues.push(`clap mid band ${mid.toFixed(2)}`); break; }
    case "Hat": { const hi = frac(m, 0, 0.1, /Shaker|Maracas|Cabasa|Guiro/.test(nm) ? 1500 : 3500, 24000); if (hi < 0.8) issues.push(`hat HF share ${hi.toFixed(2)}`); break; }
    case "Cymbal": { if (!/Gong|Tam/.test(nm)) { const hi = frac(m, 0, 0.5, 1500, 24000); if (hi < 0.55) issues.push(`cymbal HF share ${hi.toFixed(2)}`); } break; }
    case "Tom": { const lo = frac(m, 0.02, 0.3, 20, 1500); if (lo < 0.55 && !/Slap|Timbale|Bongo/.test(nm)) issues.push(`tom body ${lo.toFixed(2)}`); break; }
  }
  // stereo balance, velocity response, other notes, rapid retriggering
  { let l = 0, r = 0; for (let i = 0; i < buf.length; i += 2) { l += buf[i] ** 2; r += buf[i + 1] ** 2; }
    const bal = 10 * Math.log10((l + 1e-12) / (r + 1e-12)); if (Math.abs(bal) > 4) issues.push(`L/R imbalance ${bal.toFixed(1)} dB`); }
  const lvl = (note, vel, hits = 1) => { const e2 = new Engine(wasm, SR); e2.setPatch(pr.set, 140); const ev = []; for (let h = 0; h < hits; h++) ev.push({ t: h * 0.107, type: "on", note, vel }); const b2 = e2.render(1.2 + hits * 0.1, ev); const r = metrics(b2); r.cen = centroid(mono(b2), SR, 0, 0.2); return r; };
  { const soft = lvl(36, 0.3), loud = lvl(36, 1.0);
    const dyn = loud.rms / Math.max(soft.rms, 1e-9), tim = Math.abs(Math.log(loud.cen / Math.max(soft.cen, 1)));
    if (soft.rms < 0.0005) issues.push("silent at low velocity");
    else if (dyn < 1.25 && tim < 0.08) issues.push(`velocity has no audible effect (level ${dyn.toFixed(2)}x, timbre ${(tim * 100).toFixed(0)}%)`); }
  for (const n of [28, 48, 60]) { const q2 = lvl(n, 0.9); if (q2.nan || q2.peak > 0.99 || q2.rms < 0.0005) { issues.push(`note ${n}: peak ${q2.peak.toFixed(2)} rms ${q2.rms.toFixed(4)}`); break; } }
  { const q3 = lvl(36, 0.9, 8); if (q3.nan || q3.peak > 0.99 || Math.abs(q3.dc) > 0.01) issues.push("rapid retrigger unstable"); }
  rows.push({ idx, name: nm, cat: pr.cat, vec, issues, met, dec: decayTime(m, SR, 40), cen: 0 });
}
// distinctness
const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);
for (const r of rows) { let best = 1e9, who = ""; for (const o of rows) { if (o === r) continue; const d = dist(r.vec, o.vec) + Math.abs(Math.log(r.dec / o.dec)) * 2.5; if (d < best) { best = d; who = o.name; } } r.near = best; r.nearName = who; }
let fail = 0;
const TH = +(arg("--distinct") || 3.2);
for (const r of rows) {
  const issues = [...r.issues]; if (r.idx >= FIRST_NEW && r.near < TH) issues.push(`too similar to "${r.nearName}" (${r.near.toFixed(1)})`);
  if (r.idx >= FIRST_NEW || process.argv.includes("--all")) {
    if (issues.length) { fail++; console.log(`FAIL ${String(r.idx).padStart(3)} ${r.cat.padEnd(10)} ${r.name.padEnd(26)} ${issues.join("; ")}`); }
    else if (process.argv.includes("--verbose")) console.log(`ok   ${String(r.idx).padStart(3)} ${r.cat.padEnd(10)} ${r.name.padEnd(26)} peak ${r.met.peak.toFixed(2)} dec ${r.dec.toFixed(2)}s near ${r.near.toFixed(1)} (${r.nearName})`);
  }
}
const nn = rows.filter((r) => r.idx >= FIRST_NEW).map((r) => r.near).sort((a, b) => a - b);
console.log(`\n${rows.length} presets (${rows.length - FIRST_NEW} new), ${fail} failing; nearest-neighbour distance median ${nn[nn.length >> 1]?.toFixed(1)} min ${nn[0]?.toFixed(1)}`);
process.exit(fail ? 1 : 0);
