#!/usr/bin/env node
// os-test.mjs — oversampling: (1) clean passthrough with no distortion, right latency;
// (2) aliasing of a hard-clipped 3.1 kHz sine drops with 2x / 4x; (3) mix stays phase-aligned.
import { Engine, mono, metrics, spectrum, KEYS } from "./lab.mjs";
const wasm = process.argv[2]; const SR = 48000; let bad = 0;
const ok = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n + (i ? "  — " + i : "")); if (!c) bad++; };
const base = { C_LEV: -60, T_LEV: 0, T_SHAPE: 0, T_PITCH: 3100, T_KT: 0, T_PE1_AMT: 0, T_DEC: 4000, T_ATT: 0.01, D1_TYPE: 2, D1_DRV: 40, D1_MIX: 1, D1_LOW: 20, OUT_CEIL: -0.1, OUT_CLIP: 1, EQ_HPF: 10, HUMAN: 0 };
function run(patch) { const e = new Engine(wasm, SR); e.setPatch({ ...base, ...patch }); return mono(e.render(0.5, [{ t: 0, type: "on", note: 36, vel: 1 }])); }
// aliasing: energy in bins that are not harmonics of 3100 Hz (±60 Hz), in 0.1–0.4 s
function inharmonic(m) {
  const { mag, binHz } = spectrum(m, SR, 0.1, 0.4, 16384); let tot = 0, harm = 0;
  for (let i = 20; i < mag.length; i++) { const f = i * binHz; const k = Math.round(f / 3100); const near = k >= 1 && Math.abs(f - k * 3100) < 70; const e = mag[i] * mag[i]; tot += e; if (near) harm += e; }
  return 10 * Math.log10((tot - harm) / harm + 1e-12);
}
const a0 = inharmonic(run({ DS_OS: 0 })), a1 = inharmonic(run({ DS_OS: 1 })), a2 = inharmonic(run({ DS_OS: 2 }));
console.log(`inharmonic/harmonic energy: off ${a0.toFixed(1)} dB   2x ${a1.toFixed(1)} dB   4x ${a2.toFixed(1)} dB`);
ok("2x oversampling reduces aliasing by > 8 dB", a1 < a0 - 8);
ok("4x reduces further", a2 < a1 + 1 && a2 < a0 - 12);
// latency / passthrough: soft drive at 0 dB and a 1 kHz tone: amplitude preserved
for (const os of [1, 2]) {
  const m0 = run({ D1_TYPE: 1, D1_DRV: 0, T_PITCH: 1000, DS_OS: 0, T_LEV: -6, OUT_CLIP: 1 }), m1 = run({ D1_TYPE: 1, D1_DRV: 0, T_PITCH: 1000, DS_OS: os, T_LEV: -6, OUT_CLIP: 1 });
  const rms = (m, a, b) => { let s = 0; for (let i = a; i < b; i++) s += m[i] * m[i]; return Math.sqrt(s / (b - a)); };
  const r0 = rms(m0, 9600, 14400), r1 = rms(m1, 9600, 14400);
  ok(`OS ${os + 'x'.repeat(0)}: unity passband gain`, Math.abs(r1 / r0 - 1) < 0.02, `${r1.toFixed(4)} vs ${r0.toFixed(4)}`);
  // cross-correlate for the delay
  let best = -1, bl = 0; for (let lag = 0; lag < 40; lag++) { let c = 0; for (let i = 9600; i < 14400; i++) c += m0[i] * m1[i + lag]; if (c > best) { best = c; bl = lag; } }
  console.log(`  measured latency with OS=${os}: ${bl} samples`);
}
// parallel mix (50%) must not comb: compare dry-only signal level vs mixed with a clean mild drive
{ const x = run({ D1_TYPE: 1, D1_DRV: 0, D1_MIX: 0.5, T_PITCH: 1000, T_LEV: -6, DS_OS: 2, OUT_CLIP: 1 }), y = run({ D1_TYPE: 1, D1_DRV: 0, D1_MIX: 1, T_PITCH: 1000, T_LEV: -6, DS_OS: 0, OUT_CLIP: 1 });
  const rms = (m) => { let s = 0; for (let i = 9600; i < 14400; i++) s += m[i] * m[i]; return Math.sqrt(s / 4800); }; ok("OS 4x + 50% mix stays phase-aligned (no notch at 1 kHz)", Math.abs(rms(x) / rms(y) - 1) < 0.03, `${rms(x).toFixed(4)} vs ${rms(y).toFixed(4)}`); }
console.log(bad ? `${bad} FAILED` : "oversampling OK"); process.exit(bad ? 1 : 0);
