// fuzz.mjs — extreme random patches (every knob and switch random) at 22-192 kHz with random keys, CCs, bends and input audio:
// the output must stay finite and inside ±1. node tests/fuzz.mjs <wasm> [n]
import { Engine, P, rawToActual, metrics, WASM } from "./lab.mjs";
import { check, done } from "./t.mjs";
const N = +(process.argv.find((a) => /^\d+$/.test(a)) || 120);
let rnd = 0xD00B; const R = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
const rates = [22050, 32000, 44100, 48000, 88200, 96000, 192000];
let worst = 0, bad = 0, nan = 0; const failed = [];
for (let t = 0; t < N; t++) {
  const sr = rates[t % rates.length];
  const e = new Engine(WASM, sr);
  const v = {};
  for (const p of P) {
    if (p.direct) { const r = R(); v[p.key] = r < 0.2 ? p.min : r < 0.4 ? p.max : p.min + R() * (p.max - p.min); }
    else v[p.key] = rawToActual(p, Math.floor(R() * p.steps));
  }
  v.OUTVOL = 1;
  e.setPatch(v, R() < 0.5 ? 60 + R() * 140 : 0);
  const ev = [];
  for (let k = 0; k < 10; k++) { const tt = R() * 2.5; ev.push({ t: tt, type: "on", note: 36 + Math.floor(R() * 52), vel: R() }); if (R() < 0.7) ev.push({ t: tt + R() * 1.2, type: "off", note: 0 }); }
  for (let k = 0; k < 8; k++) ev.push({ t: R() * 3, type: "cc", num: [1, 33, 6, 101, 100, 120, 122, 123, 128, 64][Math.floor(R() * 10)], val: R() });
  if (R() < 0.3) ev.push({ t: R() * 3, type: "marker", id: -5 });
  const b = e.render(3, ev, { input: (i) => [R() < 0.5 ? 0 : (R() - 0.5), 0.2 * Math.sin(i * 0.01)], block: 64 + Math.floor(R() * 400) });
  const m = metrics(b);
  worst = Math.max(worst, m.peak);
  if (m.nan > 0) { nan++; failed.push(`#${t} sr ${sr}: ${m.nan} NaN`); }
  else if (m.peak > 1.0001) { bad++; failed.push(`#${t} sr ${sr}: peak ${m.peak}`); }
}
check(`${N} extreme random patches (7 sample rates 22-192 kHz, random keys / CCs / feedback / scales): no NaN or Inf`, nan === 0, failed.slice(0, 4).join("; "));
check(`… and the output never exceeds ±1 (worst peak ${worst.toFixed(4)})`, bad === 0, failed.slice(0, 4).join("; "));
done("fuzz");
