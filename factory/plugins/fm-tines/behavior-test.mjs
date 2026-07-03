// =====================================================================
//  behavior-test.mjs — FM Tines (Yamaha DX7 model) behavior suite
//
//  Usage: node factory/plugins/fm-tines/behavior-test.mjs [plugin.wasm]
//
//  Measurable assertions for FM-specific behaviours:
//    1. Algorithm changes harmonic content (2-op stack vs additive differ).
//    2. Raising a modulator's OUTPUT LEVEL adds sidebands (more HF energy).
//    3. Operator RATIO changes pitch relationships (carrier ratio -> pitch).
//    4. FEEDBACK adds brightness/noise (harmonics increase).
//    5. LFO PMD produces vibrato (pitch wobble across windows).
//    6. LFO AMD produces tremolo (amplitude wobble across windows).
//    7. PITCH EG bends pitch on the attack (early pitch != late pitch).
//    8. A carrier's OUTPUT LEVEL controls its contribution (louder).
// =====================================================================
import { readFileSync } from "node:fs";

const wasmPath = process.argv[2] || "/tmp/fm-tines.wasm";
const SR = 48000, STRIDE = 8192, BLOCK = 256;
const bytes = readFileSync(wasmPath);
const mod = new WebAssembly.Module(bytes);
const spec = JSON.parse(readFileSync(new URL("./spec.json", import.meta.url), "utf8")).params;
const P = {}; for (const p of spec) P[p.name] = p.index;

function makeInstance() {
  const inst = new WebAssembly.Instance(mod, { env: { abort() { throw new Error("abort"); }, seed: () => 0 } });
  inst.exports.init(SR, STRIDE, 2);
  return inst.exports;
}
function f32(ex) { return new Float32Array(ex.memory.buffer); }

// render mono (L). one held note id=1.
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
  let noteOn = false;
  for (let pos = 0; pos < total; pos += BLOCK) {
    const n = Math.min(BLOCK, total - pos);
    if (!noteOn) { ex.noteOn(1, hz, 0.9); noteOn = true; }
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
// high-band energy above fc (one-pole HP) — a brightness proxy
function hiRms(buf, t0, t1, fc) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  const k = 1 / (1 + 2 * Math.PI * fc / SR);
  let x = 0, y = 0, s = 0;
  for (let i = a; i < b; i++) { const hp = k * (y + buf[i] - x); x = buf[i]; y = hp; s += hp * hp; }
  return Math.sqrt(s / Math.max(1, b - a));
}
function zcr(buf, t0, t1) {
  const a = Math.round(t0 * SR), b = Math.min(Math.round(t1 * SR), buf.length);
  let c = 0;
  for (let i = a + 1; i < b; i++) if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) c++;
  return c / Math.max(1e-6, (b - a) / SR);
}
function rmsDiff(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s / n); }
// wobble = std/mean of short-window measure (pass a windowed metric fn)
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

// A clean 2-operator patch: algorithm 1 (index 0), op2 -> op1 carrier.
// Op Mask = 3 (op1 + op2 only). Sustained, no LFO/pitch-EG/porta.
const TWO_OP = {
  [P["Algorithm"]]: 0, [P["Op Mask"]]: 3, [P["Switch Mask"]]: 0,
  [P["Feedback"]]: 0, [P["LFO PMD"]]: 0, [P["LFO AMD"]]: 0, [P["Pitch EG Amt"]]: 0,
  [P["Op1 Ratio"]]: 1, [P["Op1 Level"]]: 0.9, [P["Op1 Atk"]]: 0.01, [P["Op1 Dec"]]: 0.5, [P["Op1 Sus"]]: 0.9, [P["Op1 Detune"]]: 0,
  [P["Op2 Ratio"]]: 2, [P["Op2 Level"]]: 0.5, [P["Op2 Atk"]]: 0.01, [P["Op2 Dec"]]: 0.5, [P["Op2 Sus"]]: 0.9, [P["Op2 Detune"]]: 0,
};
// A single pure-sine carrier (op1 only), algorithm 32 (index 31, all carriers).
const ONE_OP = {
  [P["Algorithm"]]: 31, [P["Op Mask"]]: 1, [P["Switch Mask"]]: 0,
  [P["Feedback"]]: 0, [P["LFO PMD"]]: 0, [P["LFO AMD"]]: 0, [P["Pitch EG Amt"]]: 0,
  [P["Op1 Ratio"]]: 1, [P["Op1 Level"]]: 0.9, [P["Op1 Atk"]]: 0.01, [P["Op1 Dec"]]: 0.5, [P["Op1 Sus"]]: 0.9, [P["Op1 Detune"]]: 0,
};

// 1. ALGORITHM changes harmonic content
{
  const twoOp = render({ ...TWO_OP }, 1.2);                       // FM stack (rich)
  const additive = render({ ...TWO_OP, [P["Algorithm"]]: 31, [P["Op Mask"]]: 3 }, 1.2); // both carriers, no FM
  const hiFM = hiRms(twoOp, 0.3, 1.0, 2000);
  const hiAdd = hiRms(additive, 0.3, 1.0, 2000);
  check("Algorithm change alters harmonic content (FM stack brighter than additive)",
        hiFM > hiAdd * 1.5 && rmsDiff(twoOp, additive) > 0.02,
        `hi(FM) ${hiFM.toFixed(4)} vs hi(add) ${hiAdd.toFixed(4)}`);
}

// 2. Modulator OUTPUT LEVEL adds sidebands (more HF energy)
{
  const lo = render({ ...TWO_OP, [P["Op2 Level"]]: 0.05 }, 1.2);
  const hi = render({ ...TWO_OP, [P["Op2 Level"]]: 0.95 }, 1.2);
  const hiLo = hiRms(lo, 0.3, 1.0, 2500);
  const hiHi = hiRms(hi, 0.3, 1.0, 2500);
  check("Raising modulator level adds sidebands (more HF energy)",
        hiHi > hiLo * 2.0, `HF low-mod ${hiLo.toFixed(4)} -> high-mod ${hiHi.toFixed(4)}`);
}

// 3. Operator RATIO changes pitch relationships (carrier ratio -> pitch)
{
  const r1 = render({ ...ONE_OP, [P["Op1 Ratio"]]: 1 }, 0.8);
  const r2 = render({ ...ONE_OP, [P["Op1 Ratio"]]: 2 }, 0.8);
  const z1 = zcr(r1, 0.2, 0.7), z2 = zcr(r2, 0.2, 0.7);
  check("Carrier ratio 2.0 sounds an octave above ratio 1.0",
        z2 > z1 * 1.7 && z2 < z1 * 2.3, `zcr r=1 ${z1.toFixed(0)} -> r=2 ${z2.toFixed(0)}`);
}

// 4. FEEDBACK adds brightness/noise. Single self-feedback carrier (op6, algo 32).
{
  const base = {
    [P["Algorithm"]]: 31, [P["Op Mask"]]: 32, [P["Switch Mask"]]: 0,
    [P["LFO PMD"]]: 0, [P["LFO AMD"]]: 0, [P["Pitch EG Amt"]]: 0,
    [P["Op6 Ratio"]]: 1, [P["Op6 Level"]]: 0.95, [P["Op6 Atk"]]: 0.01, [P["Op6 Dec"]]: 0.5, [P["Op6 Sus"]]: 0.9, [P["Op6 Detune"]]: 0,
  };
  const fbOff = render({ ...base, [P["Feedback"]]: 0 }, 1.2);
  const fbOn = render({ ...base, [P["Feedback"]]: 7 }, 1.2);
  const hiOff = hiRms(fbOff, 0.3, 1.0, 1200);
  const hiOn = hiRms(fbOn, 0.3, 1.0, 1200);
  check("Feedback brightens the operator (adds harmonics)",
        hiOn > hiOff * 1.6, `HF fb=0 ${hiOff.toFixed(4)} -> fb=7 ${hiOn.toFixed(4)}`);
}

// 5. LFO PMD produces vibrato (pitch wobble across windows)
{
  const noVib = render({ ...ONE_OP, [P["LFO PMD"]]: 0, [P["P Mod Sens"]]: 7, [P["LFO Speed"]]: 0.5, [P["LFO Wave"]]: 4 }, 1.5);
  const vib   = render({ ...ONE_OP, [P["LFO PMD"]]: 0.9, [P["P Mod Sens"]]: 7, [P["LFO Speed"]]: 0.5, [P["LFO Wave"]]: 4 }, 1.5);
  const wNo = wobble(noVib, 0.2, 1.4, 0.06, zcr);
  const wV  = wobble(vib,   0.2, 1.4, 0.06, zcr);
  check("LFO PMD produces vibrato (pitch wobbles)", wV > wNo * 3 + 0.002,
        `pitch wobble off ${wNo.toFixed(4)} -> on ${wV.toFixed(4)}`);
}

// 6. LFO AMD produces tremolo (amplitude wobble across windows)
{
  const noTrem = render({ ...ONE_OP, [P["LFO AMD"]]: 0, [P["A Mod Sens"]]: 3, [P["LFO Speed"]]: 0.5, [P["LFO Wave"]]: 4 }, 1.5);
  const trem   = render({ ...ONE_OP, [P["LFO AMD"]]: 0.9, [P["A Mod Sens"]]: 3, [P["LFO Speed"]]: 0.5, [P["LFO Wave"]]: 4 }, 1.5);
  const wNo = wobble(noTrem, 0.2, 1.4, 0.03, rms);
  const wT  = wobble(trem,   0.2, 1.4, 0.03, rms);
  check("LFO AMD produces tremolo (amplitude wobbles)", wT > wNo * 3 + 0.01,
        `amp wobble off ${wNo.toFixed(4)} -> on ${wT.toFixed(4)}`);
}

// 7. PITCH EG bends pitch on the attack (early pitch above settled pitch)
{
  const flat = render({ ...ONE_OP, [P["Pitch EG Amt"]]: 0, [P["Pitch EG Rate"]]: 0.75 }, 1.4);
  const bent = render({ ...ONE_OP, [P["Pitch EG Amt"]]: 0.4, [P["Pitch EG Rate"]]: 0.75 }, 1.4);
  const earlyBent = zcr(bent, 0.02, 0.14), lateBent = zcr(bent, 0.9, 1.2);
  const earlyFlat = zcr(flat, 0.02, 0.14), lateFlat = zcr(flat, 0.9, 1.2);
  check("Pitch EG bends pitch on attack (starts sharp, settles)",
        earlyBent > lateBent * 1.3 && earlyBent > earlyFlat * 1.2,
        `bent early ${earlyBent.toFixed(0)} vs late ${lateBent.toFixed(0)} (flat early ${earlyFlat.toFixed(0)})`);
}

// 8. Carrier OUTPUT LEVEL controls its contribution (louder)
{
  const soft = render({ ...ONE_OP, [P["Op1 Level"]]: 0.25 }, 1.0);
  const loud = render({ ...ONE_OP, [P["Op1 Level"]]: 0.95 }, 1.0);
  const rSoft = rms(soft, 0.2, 0.8), rLoud = rms(loud, 0.2, 0.8);
  check("Carrier output level controls loudness", rLoud > rSoft * 1.8,
        `rms level=0.25 ${rSoft.toFixed(4)} -> level=0.95 ${rLoud.toFixed(4)}`);
}

console.log("─".repeat(52));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
