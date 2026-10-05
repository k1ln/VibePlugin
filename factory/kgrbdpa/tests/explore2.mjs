import { Engine, metrics, pitch, zcFreq, slice, tone, db, fftMag, WASM } from "./lab.mjs";
import { SRC_IDX } from "../params.mjs";
const SR = 48000, e = new Engine(WASM, SR);
const base = { MIX_O1: 0.6, MIX_O2: 0, CUTOFF: 1, RESO: 0, ENV_AMT: 0, VCA_MODE: 2, KBD_TRK: 1, DRIFT: 0, VOLUME: 1 };
const idx = (k) => SRC_IDX[k];
// envelope timing via probe of +ENV OUT
function envTrace(vals, gateOn = 1.0, total = 3) {
  e.reset(SR); e.setPatch({ ...base, ...vals });
  return e.render(total, [{ t: 0.1, type: "on", note: 60 }, { t: 0.1 + gateOn, type: "off", note: 60 }], { probe: idx("ENVP"), block: 4 });
}
function tcross(p, level, from = 0, rising = true) { for (let i = from; i < p.length; i++) if (rising ? p[i] >= level : p[i] <= level) return i / SR; return -1; }
for (const [a, name] of [[0, "min"], [0.5, "mid"], [1, "max"]]) {
  const b = envTrace({ ATK: a, DEC: 0.3, SUS: 0.5, REL: 0.3 }, 12, 14);
  const p = b.probe; const t0 = 0.1; const tpk = tcross(p, 7.9, 0);   // reaches (almost) 8V
  console.log(`attack knob ${name}: rise to 8V takes ${(tpk - t0).toFixed(4)} s  (expected ${(0.0008 * 10000 ** a).toFixed(4)})`);
}
{ const b = envTrace({ ATK: 0, DEC: 0.5, SUS: 0.4, REL: 0.5 }, 5, 12); const p = b.probe; const t0 = 0.1;
  const ts = tcross(p, 0.4 * 8 + 0.1, Math.floor((t0 + 0.01) * SR), false);
  console.log("decay knob .5: falls to sustain+0.1V after", (ts - t0).toFixed(3), "s (decay time", (0.002 * 6000 ** 0.5).toFixed(3), "s ≈99%)");
  console.log("sustain level during hold", p[Math.round(3 * SR)].toFixed(3), "(expect 3.2)");
  const trel = 0.1 + 5; const tr = tcross(p, 0.08, Math.round(trel * SR), false);
  console.log("release .5: to ~1% after", (tr - trel).toFixed(3), "s (release time", (0.002 * 6000 ** 0.5).toFixed(3), ")");
}
// LFO range & waves
for (const [r, nm] of [[0, "min"], [1, "max"]]) {
  e.reset(SR); e.setPatch({ ...base, MOD_RATE: r, MOD_WAVE: 3 });
  const b = e.render(r === 0 ? 30 : 0.5, [], { probe: idx("LFO"), block: 1 }); const x = b.probe;
  let c = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++;
  console.log(`LFO rate ${nm}: ${(c / (x.length / SR)).toFixed(3)} Hz (expect ${r === 0 ? 0.07 : 1300})`);
}
// glide types: measure time to reach pitch 12 st above
for (const ty of [0, 1, 2]) {
  e.reset(SR); e.setPatch({ ...base, GLIDE: 0.6, GL_TYPE: ty });
  const b = e.render(3, [{ t: 0, type: "on", note: 48 }, { t: 1, type: "on", note: 60 }], { probe: idx("KB"), block: 8 });
  const p = b.probe; let t = -1; for (let i = Math.round(1 * SR); i < p.length; i++) if (p[i] >= 0.0 - 0.01) { t = i / SR - 1; break; }
  console.log(["LCR", "LCT", "EXP"][ty], "glide 48→60 reaches 60 after", t.toFixed(3), "s");
}
// reverb: burst then decay
{
  e.reset(SR); e.setPatch({ ...base, VCA_MODE: 2, REV_MIX: 1, MIX_O1: 0, MIX_NZ: 0.6, VOLUME: 0.8 });
  const input = (i) => { const on = i < 0.05 * SR; return [on ? (Math.random() * 2 - 1) * 0.5 : 0, 0]; };
  e.setPatch({ ...base, REV_MIX: 1, MIX_O1: 0, MIX_NZ: 0, INST_LVL: 1, VOLUME: 0.8, VCA_MODE: 2 });
  const b = e.render(4, [], { input });
  const win = (t0, t1) => metrics(slice(b, SR, t0, t1)).rms;
  console.log("reverb burst 50ms: rms 0-0.05", db(win(0, 0.05)).toFixed(1), "| 0.1-0.2", db(win(0.1, 0.2)).toFixed(1), "| 0.5-0.6", db(win(0.5, 0.6)).toFixed(1), "| 1-1.1", db(win(1, 1.1)).toFixed(1), "| 2-2.1", db(win(2, 2.1)).toFixed(1), "| 3-3.1", db(win(3, 3.1)).toFixed(1), "peak", metrics(b).peak.toFixed(3));
}

// reverb steady state: continuous noise in; wet-only vs dry
{
  const noise = () => { let s = 12345; return (i) => { s = (s * 1664525 + 1013904223) >>> 0; return [(s / 4294967296 * 2 - 1) * 0.3, 0]; }; };
  for (const mix of [0, 0.5, 1]) {
    e.reset(SR); e.setPatch({ ...base, REV_MIX: mix, MIX_O1: 0, INST_LVL: 1, VOLUME: 0.7, VCA_MODE: 2 });
    const b = e.render(4, [], { input: noise() });
    console.log("reverb mix", mix, "steady rms", db(metrics(slice(b, SR, 1, 4)).rms).toFixed(1), "dBFS");
  }
}
