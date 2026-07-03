// =====================================================================
//  behavior-test.mjs — Additive (Kawai K5 model) behavior suite
//
//  Usage: node factory/plugins/additive/behavior-test.mjs [plugin.wasm]
//
//  Measurable assertions for the additive engine (spectral centroid and
//  per-harmonic magnitudes via Goertzel at k*f0):
//    1. Spectral TILT raises brightness (centroid up).
//    2. ODD/EVEN balance changes harmonic content (2nd harmonic level).
//    3. FORMANT peak moves energy to a harmonic band (centroid tracks it).
//    4. PROFILE selector changes timbre (saw vs organ harmonic structure).
//    5. Band envelopes make the spectrum evolve (early vs late centroid).
//    6. DDF cutoff sweep changes brightness (centroid up).
//    7. DDA envelope shapes amplitude (long vs short attack).
//    8. S1/S2 detune produces beating (amplitude wobble).
//    9. LFO -> pitch produces vibrato (pitch wobble).
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/additive.wasm";
const SR = 48000, STRIDE = 8192, BLOCK = 256;
const bytes = readFileSync(wasmPath);
const mod = new WebAssembly.Module(bytes);
const spec = JSON.parse(readFileSync(new URL("./spec.json", import.meta.url), "utf8")).params;

function makeInstance() {
  const inst = new WebAssembly.Instance(mod, { env: { abort() { throw new Error("abort"); }, seed: () => 0 } });
  inst.exports.init(SR, STRIDE, 2);
  return inst.exports;
}
function f32(ex) { return new Float32Array(ex.memory.buffer); }

// render mono (L), one held note id=1
function render(overrides, seconds, hz = 220) {
  const ex = makeInstance();
  const parPtr = ex.getParamsPtr() >>> 2;
  const outPtr = ex.getOutputPtr() >>> 2;
  const m0 = f32(ex);
  for (let i = 0; i < 64; i++) m0[parPtr + i] = 0;
  for (const p of spec) m0[parPtr + p.index] = p.default;
  for (const k in overrides) m0[parPtr + +k] = overrides[k];
  const total = Math.round(SR * seconds);
  const L = new Float32Array(total);
  let on = false;
  for (let pos = 0; pos < total; pos += BLOCK) {
    const n = Math.min(BLOCK, total - pos);
    if (!on) { ex.noteOn(1, hz, 0.9); on = true; }
    ex.process(n);
    const m = f32(ex);
    for (let i = 0; i < n; i++) L[pos + i] = m[outPtr + i];
  }
  return L;
}
function rms(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let s = 0; for (let i = a; i < b; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
function zcr(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let c = 0;
  for (let i = a + 1; i < b; i++) if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) c++;
  return c / Math.max(1e-6, (b - a) / SR);
}
// Goertzel magnitude at frequency f over [t0,t1)
function mag(buf, t0, t1, f) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  const w = 2 * Math.PI * f / SR, coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = a; i < b; i++) { const s0 = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / Math.max(1, b - a);
}
// spectral centroid in harmonic-number units over the first nH harmonics
function centroid(buf, t0, t1, f0, nH = 40) {
  let num = 0, den = 0;
  for (let h = 1; h <= nH; h++) { const m = mag(buf, t0, t1, h * f0); num += h * m; den += m; }
  return num / Math.max(1e-9, den);
}
function wobble(buf, t0, t1, win, metric) {
  const w = []; for (let t = t0; t + win < t1; t += win) w.push(metric(buf, t, t + win));
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  let v = 0; for (const x of w) v += (x - mean) ** 2;
  return Math.sqrt(v / w.length) / Math.max(1e-6, mean);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (cond) pass++; else fail++;
}

// CLEAN base: S1 only (balance 0), saw, all harmonics, no formant/LFO/mods,
// bands held near full (long decay), DDF open, DDA sustained. flags=0 (Twin,
// no keytrack). Steady harmonic tone for spectral measurement.
const B = {};
for (const p of spec) B[p.index] = p.default;
Object.assign(B, {
  0: 0, 1: 0, 2: 0, 3: 1, 4: 0, 5: 0, 6: 0,     // S1 saw, all harmonics, no formant
  7: 0, 8: 1, 9: 0, 10: 1, 11: 0, 12: 1,        // bands: fast attack, long decay (steady)
  13: 1, 14: 0, 15: 0, 16: 0, 17: 1,            // DDF wide open, no env
  18: 0, 19: 0, 20: 1, 21: 0.3,                 // DDA: instant, full sustain
  44: 0, 45: 0,                                 // Twin, balance -> S1 only
  46: 0, 47: 0, 48: 0, 49: 0, 50: 0,            // no coarse/detune/tune/porta/pitchEnv
  52: 0.35, 53: 0, 54: 0, 55: 0,                // LFO off
  56: 0, 57: 2, 58: 0, 59: 0, 60: 0, 61: 0.7,   // no keytrack/bend/wheels/AT
});
const F0 = 220;

// 1. TILT raises brightness
{
  const dark = render({ ...B, 1: -0.8 }, 1.0);
  const bright = render({ ...B, 1: 0.8 }, 1.0);
  const cd = centroid(dark, 0.3, 0.9, F0), cb = centroid(bright, 0.3, 0.9, F0);
  check("Spectral tilt raises brightness (centroid up)", cb > cd * 1.4,
    `centroid dark ${cd.toFixed(2)} -> bright ${cb.toFixed(2)}`);
}
// 2. ODD/EVEN changes harmonic content (2nd harmonic vs fundamental)
{
  const odd = render({ ...B, 2: 1.0 }, 1.0);   // odd emphasis -> even suppressed
  const even = render({ ...B, 2: -1.0 }, 1.0); // even emphasis -> odd suppressed
  const rOdd = mag(odd, 0.3, 0.9, 2 * F0) / Math.max(1e-9, mag(odd, 0.3, 0.9, F0));
  const rEven = mag(even, 0.3, 0.9, 2 * F0) / Math.max(1e-9, mag(even, 0.3, 0.9, F0));
  check("Odd/Even balance changes harmonic content (2nd-harmonic ratio)", rEven > rOdd * 3,
    `mag2/mag1 odd ${rOdd.toFixed(3)} -> even ${rEven.toFixed(3)}`);
}
// 3. FORMANT peak moves energy to a harmonic band
{
  const lo = render({ ...B, 6: 0.9, 5: 0.15, 4: 0.05 }, 1.0); // peak ~ harmonic 4
  const hi = render({ ...B, 6: 0.9, 5: 0.15, 4: 0.6 }, 1.0);  // peak ~ harmonic 39
  const cl = centroid(lo, 0.3, 0.9, F0), ch = centroid(hi, 0.3, 0.9, F0);
  check("Formant peak moves energy to a frequency band (centroid tracks peak)", ch > cl * 1.5,
    `centroid formLo ${cl.toFixed(2)} -> formHi ${ch.toFixed(2)}`);
}
// 4. PROFILE changes timbre (saw has strong 3rd harmonic; organ = octaves only)
{
  const saw = render({ ...B, 0: 0 }, 1.0);
  const organ = render({ ...B, 0: 4 }, 1.0);
  const r3saw = mag(saw, 0.3, 0.9, 3 * F0) / Math.max(1e-9, mag(saw, 0.3, 0.9, F0));
  const r3org = mag(organ, 0.3, 0.9, 3 * F0) / Math.max(1e-9, mag(organ, 0.3, 0.9, F0));
  check("Profile selector changes timbre (saw 3rd-harmonic >> organ 3rd)", r3saw > r3org * 3,
    `mag3/mag1 saw ${r3saw.toFixed(3)} vs organ ${r3org.toFixed(3)}`);
}
// 5. Band envelopes evolve the spectrum (fast high-band decay darkens over time)
{
  const ev = render({ ...B, 1: 0.5, 11: 0, 12: 0.6, 8: 1, 10: 1 }, 1.4); // hi band decays over ~0.25s
  const early = centroid(ev, 0.0, 0.06, F0), late = centroid(ev, 1.0, 1.3, F0);
  check("Band envelopes make the spectrum evolve (early brighter than late)", early > late * 1.15,
    `centroid early ${early.toFixed(2)} -> late ${late.toFixed(2)}`);
}
// 6. DDF cutoff sweep changes brightness
{
  const closed = render({ ...B, 13: 0.15 }, 1.0);
  const open = render({ ...B, 13: 1.0 }, 1.0);
  const cc = centroid(closed, 0.3, 0.9, F0), co = centroid(open, 0.3, 0.9, F0);
  check("DDF cutoff sweep changes brightness (centroid up)", co > cc * 1.5,
    `centroid closed ${cc.toFixed(2)} -> open ${co.toFixed(2)}`);
}
// 7. DDA envelope shapes amplitude (long attack starts quiet)
{
  const shortA = render({ ...B, 18: 0 }, 0.6);
  const longA = render({ ...B, 18: 0.55 }, 0.6);   // envTime(0.55) ~ 0.18s
  const eShort = rms(shortA, 0.0, 0.03), eLong = rms(longA, 0.0, 0.03);
  check("DDA envelope shapes amplitude (short attack louder at onset)", eShort > eLong * 3,
    `onset rms short ${eShort.toFixed(4)} vs long ${eLong.toFixed(4)}`);
}
// 8. S1/S2 detune produces beating (amplitude wobble)
{
  // make S2 identical to S1 (saw, steady bands, open DDF, sustained DDA) so the
  // ONLY difference is detune -> any wobble is beating, not env mismatch.
  const twin = { ...B, 45: 0.5,
    22: 0, 23: 0, 24: 0, 25: 1, 26: 0, 27: 0, 28: 0,          // S2 saw, no formant
    29: 0, 30: 1, 31: 0, 32: 1, 33: 0, 34: 1,                 // S2 bands steady
    35: 1, 36: 0, 37: 0, 38: 0, 39: 1,                        // S2 DDF open
    40: 0, 41: 0, 42: 1, 43: 0.3 };                           // S2 DDA sustained
  const steady = render({ ...twin, 47: 0.0 }, 1.8);  // both S at unison
  const beat = render({ ...twin, 47: 0.4 }, 1.8);    // ~20 cent detune
  const wS = wobble(steady, 0.4, 1.6, 0.05, rms), wB = wobble(beat, 0.4, 1.6, 0.05, rms);
  check("S1/S2 detune produces beating (amplitude wobble)", wB > wS * 2 + 0.01,
    `amp wobble unison ${wS.toFixed(4)} -> detuned ${wB.toFixed(4)}`);
}
// 9. LFO -> pitch produces vibrato (pitch wobble)
{
  const noVib = render({ ...B, 54: 0, 55: 1, 52: 0.5 }, 1.5);
  const vib = render({ ...B, 54: 0.8, 55: 1, 52: 0.5 }, 1.5);
  const wN = wobble(noVib, 0.2, 1.4, 0.05, zcr), wV = wobble(vib, 0.2, 1.4, 0.05, zcr);
  check("LFO -> pitch produces vibrato (pitch wobbles)", wV > wN * 3 + 0.002,
    `pitch wobble off ${wN.toFixed(4)} -> on ${wV.toFixed(4)}`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
