#!/usr/bin/env node
// fuzz.mjs — stability under extreme random patches: no NaN, output never
// beyond the ceiling, silent patches allowed, CPU time reported.
//   node fuzz.mjs <wasm> [count] [seed]
import { Engine, metrics, KEYS, P, actualToRaw, rawToActual } from "./lab.mjs";
const wasm = process.argv[2]; const N = +(process.argv[3] || 200);
let seed = +(process.argv[4] || 12345);
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const SRS = (process.env.SRS || "44100,48000,96000").split(",").map(Number);
let worst = { peak: 0 }, bad = 0, silent = 0, t0 = Date.now(), frames = 0;
for (let n = 0; n < N; n++) {
  const sr = SRS[n % 3];
  const e = new Engine(wasm, sr);
  const patch = {};
  const style = rnd();
  for (const p of P) {
    if (p.direct) { patch[p.key] = p.min + rnd() * (p.max - p.min); continue; }
    const r = rnd();
    // 35% extreme (min or max), 65% uniform in the raw step domain
    const raw = r < 0.17 ? 0 : r < 0.35 ? p.steps - 1 : Math.floor(rnd() * p.steps);
    patch[p.key] = rawToActual(p, raw);
  }
  // keep some patches audible: force a layer on
  if (style < 0.8) { patch.T_LEV = 0; }
  patch.OUT_CEIL = -0.5; if (rnd() < 0.5) patch.OUT_LEVEL = 0;
  e.setPatch(patch, 120);
  const ev = [];
  const hits = 1 + Math.floor(rnd() * 5);
  for (let h = 0; h < hits; h++) ev.push({ t: h * (0.05 + rnd() * 0.3), type: "on", note: 24 + Math.floor(rnd() * 60), vel: 0.05 + rnd() * 0.95 });
  if (rnd() < 0.3) ev.push({ t: 0.5, type: "cc", num: 128, val: rnd() * 2 - 1 });
  if (rnd() < 0.3) ev.push({ t: 0.6, type: "off", note: ev[0].note });
  const buf = e.render(1.5, ev, [64, 256, 480][n % 3]);
  frames += buf.length / 2;
  const m = metrics(buf);
  const ceil = Math.pow(10, patch.OUT_CEIL / 20);
  if (m.nan > 0 || m.peak > ceil + 1e-4) { bad++; console.log(`BAD #${n} sr=${sr}`, m, "ceil", ceil.toFixed(3)); }
  if (m.rms < 1e-5) silent++;
  if (m.peak > worst.peak) worst = { ...m, n };
}
const sec = (Date.now() - t0) / 1000;
console.log(`fuzz: ${N} patches, bad=${bad}, silent=${silent}, worst peak ${worst.peak.toFixed(3)}, ${(frames / 48000 / sec).toFixed(1)}x realtime`);
process.exit(bad ? 1 : 0);
