#!/usr/bin/env node
// pitch-check.mjs — measure the fundamental a synth wasm produces for a note.
//   node factory/tools/pitch-check.mjs <plugin.wasm> [--freq 440] [--set "0=1,5=0.3"] [--secs 0.8]
// Uses an autocorrelation with parabolic interpolation (first strong peak).
import { readFileSync } from "node:fs";
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const freq = +opt("--freq", 440), secs = +opt("--secs", 0.8), sets = opt("--set", "");
const { instance } = await WebAssembly.instantiate(readFileSync(a[0]), { env: { abort() {} } });
const e = instance.exports;
e.init(48000, 256, 2);
const m = new Float32Array(e.memory.buffer);
const P = e.getParamsPtr() / 4, O = e.getOutputPtr() / 4;
for (const kv of sets.split(",").filter(Boolean)) { const [k, v] = kv.split("="); m[P + +k] = +v; }
e.noteOn(1, freq, 0.9);
const out = [];
for (let b = 0; b < Math.ceil(secs * 48000 / 256); b++) { e.process(256); for (let i = 0; i < 256; i++) out.push(m[O + i]); }
const from = Math.min(12000, out.length - 6000), len = 3000, c = [];
let e0 = 0; for (let i = 0; i < len; i++) e0 += out[from + i] ** 2;
let best = 0;
for (let L = 30; L < 1500; L++) { let s = 0, e1 = 0; for (let i = 0; i < len; i++) { s += out[from + i] * out[from + i + L]; e1 += out[from + i + L] ** 2; } c[L] = s / Math.sqrt((e0 * e1) || 1); if (c[L] > best) best = c[L]; }
let hz = 0;
for (let L = 31; L < 1499; L++) if (c[L] >= 0.9 * best && c[L] >= c[L - 1] && c[L] >= c[L + 1]) { const d = c[L - 1] - 2 * c[L] + c[L + 1]; hz = 48000 / (L + (d ? (c[L - 1] - c[L + 1]) / (2 * d) : 0)); break; }
let pk = 0, ss = 0; for (const v of out.slice(from)) { pk = Math.max(pk, Math.abs(v)); ss += v * v; }
console.log(`freq ${freq} Hz -> measured ${hz.toFixed(1)} Hz  (ratio ${(hz / freq).toFixed(3)})  peak ${pk.toFixed(3)} rms ${Math.sqrt(ss / (out.length - from)).toFixed(4)}  periodicity ${best.toFixed(2)}`);
