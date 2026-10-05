// fuzz.mjs — extreme random patches (every knob, switch and CABLE random, loops included) at 22-192 kHz:
// the output must stay finite and inside ±1. node tests/fuzz.mjs <wasm> [n]
import { Engine, P, rawToActual, metrics, WASM } from "./lab.mjs";
import { check, done } from "./t.mjs";
const N = +(process.argv.find((a) => /^\d+$/.test(a)) || 120);
let rnd = 0xC0FFEE; const R = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
const rates = [22050, 32000, 44100, 48000, 88200, 96000, 192000];
let worst = 0, bad = 0, nan = 0; const failed = [];
for (let t = 0; t < N; t++) {
  const sr = rates[t % rates.length];
  const e = new Engine(WASM, sr);
  const v = {};
  for (const p of P) {
    if (p.direct) { const r = R(); v[p.key] = r < 0.2 ? p.min : r < 0.4 ? p.max : p.min + R() * (p.max - p.min); }
    else if (p.key.startsWith("PB_")) v[p.key] = R() < 0.55 ? 0 : 1 + Math.floor(R() * 18);
    else v[p.key] = rawToActual(p, Math.floor(R() * p.steps));
  }
  v.VOLUME = 1;
  e.setPatch(v, R() < 0.5 ? 60 + R() * 140 : 0);
  const ev = [{ t: 0, type: "transport", playing: 1, ppq: R() * 8, bpm: 80 + R() * 100 }];
  for (let k = 0; k < 8; k++) { const tt = R() * 2.5; ev.push({ t: tt, type: "on", note: 24 + Math.floor(R() * 80), vel: R() }); if (R() < 0.7) ev.push({ t: tt + R() * 1.2, type: "off", note: 0 }); }
  for (let k = 0; k < 6; k++) ev.push({ t: R() * 3, type: "cc", num: [1, 3, 5, 8, 12, 73, 69, 74, 91, 92, 93, 94, 103, 85, 89, 107, 108, 119, 90, 128][Math.floor(R() * 20)], val: R() });
  if (R() < 0.3) ev.push({ t: R() * 3, type: "marker", id: -2 - Math.floor(R() * 3) });
  const b = e.render(3, ev, { input: (i) => [R() < 0.5 ? 0 : (R() - 0.5), 0.2 * Math.sin(i * 0.01)], block: 64 + Math.floor(R() * 400) });
  const m = metrics(b);
  worst = Math.max(worst, m.peak);
  if (m.nan > 0) { nan++; failed.push(`#${t} sr ${sr}: ${m.nan} NaN`); }
  else if (m.peak > 1.0001) { bad++; failed.push(`#${t} sr ${sr}: peak ${m.peak}`); }
}
check(`${N} extreme random patches (7 sample rates 22-192 kHz, random cables/loops/CCs/arp/seq): no NaN or Inf`, nan === 0, failed.slice(0, 4).join("; "));
check(`… and the output never exceeds ±1 (worst peak ${worst.toFixed(4)})`, bad === 0, failed.slice(0, 4).join("; "));
done("fuzz");
