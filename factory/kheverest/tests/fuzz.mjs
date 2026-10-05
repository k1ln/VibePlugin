// fuzz.mjs — extreme random patches + random note streams: no NaN, bounded output, no trap.
import { Engine, P, rawToActual, metrics } from "./lab.mjs";
const wasm = process.argv[2], N = +(process.argv[3] || 200); let seed = +(process.argv[4] || 4242);
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const e = new Engine(wasm);
let worst = 0, bad = 0;
for (let n = 0; n < N; n++) {
  const sr = [22050, 44100, 48000, 96000, 192000][n % 5];
  e.reset(sr);
  const patch = {};
  for (const p of P) {
    if (p.direct) { patch[p.key] = p.min + rnd() * (p.max - p.min); continue; }
    // bias to extremes half of the time
    const r = rnd(); const raw = r < 0.2 ? 0 : r < 0.4 ? p.steps - 1 : Math.floor(rnd() * p.steps);
    patch[p.key] = rawToActual(p, raw);
  }
  patch.VOL = 0.75;
  const ev = [];
  for (let i = 0; i < 12; i++) { const t = rnd() * 1.2, note = 24 + Math.floor(rnd() * 80); ev.push({ t, type: "on", note, vel: 0.2 + rnd() * 0.8 }); ev.push({ t: t + 0.05 + rnd() * 0.6, type: "off", note }); }
  e.setPatch(patch, rnd() < 0.5 ? 0 : 60 + rnd() * 150);
  const out = e.render(1.8, ev, 64 + Math.floor(rnd() * 500));
  const m = metrics(out);
  worst = Math.max(worst, m.peak);
  if (m.nan || m.peak > 4 || Math.abs(m.dc) > 0.5) { bad++; console.log(`FAIL #${n} sr=${sr}`, m); }
}
console.log(`${N} patches, worst peak ${worst.toFixed(3)}, ${bad} failures`);
process.exit(bad ? 1 : 0);
