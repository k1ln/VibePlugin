// =====================================================================
//  behavior-test.mjs — synth-specific behavior assertions for Analog Poly
//  (Prophet-5 Rev 4 model). Usage: node behavior-test.mjs <plugin.wasm>
//
//  Checks (all measurable):
//   1. Unison chord memory: shipped chord (root+5th+oct) sounds a 5th on a
//      single key; capturing a held chord replaces it.
//   2. VINTAGE knob: two voices on the same pitch beat against each other
//      at Vintage=1 but stay phase-locked at Vintage=4.
//   3. FILTER REV switch: Rev 1/2 vs Rev 3 produce measurably different
//      audio and a different brightness (spectral tilt).
//   4. WHEEL-MOD routing: mod wheel → Filter causes amplitude fluctuation;
//      mod wheel → Freq A causes pitch fluctuation (zero-crossing spread).
//   5. RELEASE switch: off → tail collapses fast, on → knob release rings.
//   6. Unison detune: stacked voices beat harder at detune 8 than 0.
// =====================================================================
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = process.argv[2];
if (!wasmPath) { console.error("usage: node behavior-test.mjs <plugin.wasm>"); process.exit(2); }

const SR = 48000, BLOCK = 256, STRIDE = 8192;
const spec = JSON.parse(readFileSync(join(here, "spec.json"), "utf8"));
const byName = {}; for (const p of spec.params) byName[p.name] = p.index;

const mod = new WebAssembly.Module(readFileSync(wasmPath));
const inst = new WebAssembly.Instance(mod, { env: { abort(){ throw new Error("abort"); }, seed: () => 0 } });
const ex = inst.exports;
const f32 = () => new Float32Array(ex.memory.buffer);

function setParams(overrides) {
  const m = f32(); const pp = ex.getParamsPtr() >>> 2;
  for (let i = 0; i < 64; i++) m[pp + i] = 0;
  for (const p of spec.params) m[pp + p.index] = p.default;
  for (const k in overrides) m[pp + byName[k]] = overrides[k];
}

// events: [{t, on:[id,hz,vel]}, {t, off:id}, {t, set:{Name:val}}]
function render(seconds, overrides, events) {
  ex.init(SR, STRIDE, 2);
  setParams(overrides);
  const total = Math.round(SR * seconds);
  const out = new Float32Array(total);
  const evs = [...events].sort((a, b) => a.t - b.t);
  let e = 0;
  const outP = ex.getOutputPtr() >>> 2, pp = ex.getParamsPtr() >>> 2;
  for (let pos = 0; pos < total; pos += BLOCK) {
    const n = Math.min(BLOCK, total - pos);
    const tNow = pos / SR;
    while (e < evs.length && evs[e].t <= tNow) {
      const ev = evs[e++];
      if (ev.on) ex.noteOn(ev.on[0], ev.on[1], ev.on[2] ?? 0.9);
      if (ev.off !== undefined) ex.noteOff(ev.off);
      if (ev.set) { const m = f32(); for (const k in ev.set) m[pp + byName[k]] = ev.set[k]; }
    }
    ex.process(n);
    const m = f32();
    for (let i = 0; i < n; i++) out[pos + i] = m[outP + i];
  }
  return out;
}

const rms = (b, from = 0, to = b.length) => {
  let s = 0; for (let i = from; i < to; i++) s += b[i] * b[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
function goertzel(buf, hz, from, to) {
  const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) { s0 = buf[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  const n = to - from;
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / n;
}
function windowedRmsSpread(buf, from, to, wins = 16) {
  const step = Math.floor((to - from) / wins); const vals = [];
  for (let w = 0; w < wins; w++) vals.push(rms(buf, from + w * step, from + (w + 1) * step));
  const mean = vals.reduce((a, b) => a + b) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return sd / Math.max(mean, 1e-9);
}
function zcrSpread(buf, from, to, wins = 12) {
  const step = Math.floor((to - from) / wins); const vals = [];
  for (let w = 0; w < wins; w++) {
    let z = 0;
    for (let i = from + w * step + 1; i < from + (w + 1) * step; i++)
      if ((buf[i] >= 0) !== (buf[i - 1] >= 0)) z++;
    vals.push(z);
  }
  const mean = vals.reduce((a, b) => a + b) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return sd / Math.max(mean, 1e-9);
}
function tilt(buf, from, to) { // high/low band energy ratio via one-pole HP proxy
  let lp = 0, hi = 0, lo = 0;
  const k = 2 * Math.PI * 700 / SR;
  for (let i = from; i < to; i++) { lp += (buf[i] - lp) * k; const h = buf[i] - lp; hi += h * h; lo += lp * lp; }
  return hi / Math.max(lo, 1e-12);
}

let passAll = true;
function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!cond) passAll = false;
}

const S = SR; // samples per second
// OscB Fine defaults to +0.12 st, whose ~1.5 Hz beat would pollute every
// fluctuation baseline — zero it (and other movement sources) for the tests.
const quiet = { "LFO Amount": 0, "Uni Detune": 0, "Vintage": 4, "Mix Noise": 0, "OscB Fine": 0 };

// ---- 1. chord memory --------------------------------------------------------
{
  const evs = [{ t: 0.02, on: [1, 220] }, { t: 1.9, off: 1 }];
  const off = render(2, { ...quiet, "Voice Mode": 0 }, evs);
  const chd = render(2, { ...quiet, "Voice Mode": 6 }, evs);
  const seg = [Math.floor(0.6 * S), Math.floor(1.6 * S)];
  const fifthOff = goertzel(off, 329.63, ...seg), fifthOn = goertzel(chd, 329.63, ...seg);
  check("chord memory: shipped root+5th+oct sounds the 5th",
    fifthOn > 8 * Math.max(fifthOff, 1e-7) && fifthOn > 1e-4,
    `E4 energy on=${fifthOn.toExponential(2)} off=${fifthOff.toExponential(2)}`);

  // capture: hold 220 + 277.18 (maj 3rd), flip to Chord, replay single key
  const evs2 = [
    { t: 0.02, on: [1, 220] }, { t: 0.02, on: [2, 277.18] },
    { t: 0.4, set: { "Voice Mode": 6 } },
    { t: 0.6, off: 1 }, { t: 0.62, off: 2 },
    { t: 1.0, on: [3, 220] }, { t: 2.4, off: 3 },
  ];
  const cap = render(2.5, { ...quiet, "Voice Mode": 0 }, evs2);
  const seg2 = [Math.floor(1.5 * S), Math.floor(2.3 * S)];
  const third = goertzel(cap, 277.18, ...seg2);
  const fifth = goertzel(cap, 329.63, ...seg2);
  check("chord memory: capturing a held chord replaces the shipped one",
    third > 5 * Math.max(fifth, 1e-7) && third > 1e-4,
    `C#4 energy=${third.toExponential(2)} vs E4=${fifth.toExponential(2)}`);
}

// ---- 2. vintage knob ---------------------------------------------------------
{
  const evs = [{ t: 0.02, on: [1, 220] }, { t: 0.03, on: [2, 220] }, { t: 2.9, off: 1 }, { t: 2.91, off: 2 }];
  const tight = render(3, { ...quiet, "Vintage": 4 }, evs);
  const loose = render(3, { ...quiet, "Vintage": 1 }, evs);
  const a = Math.floor(0.8 * S), b = Math.floor(2.8 * S);
  const spTight = windowedRmsSpread(tight, a, b), spLoose = windowedRmsSpread(loose, a, b);
  check("vintage: two voices on one pitch beat at Vintage=1, not at 4",
    spLoose > 3 * spTight && spLoose > 0.02,
    `rms spread loose=${spLoose.toFixed(4)} tight=${spTight.toFixed(4)}`);
}

// ---- 3. filter rev switch ------------------------------------------------------
{
  const evs = [{ t: 0.02, on: [1, 110] }, { t: 1.9, off: 1 }];
  const ov = { ...quiet, "Resonance": 0.7, "Cutoff": 0.4, "Env Amount": 0 };
  const ssm = render(2, { ...ov, "Filter Rev": 0 }, evs);
  const cem = render(2, { ...ov, "Filter Rev": 1 }, evs);
  const a = Math.floor(0.5 * S), b = Math.floor(1.8 * S);
  let d = 0; for (let i = a; i < b; i++) d += (ssm[i] - cem[i]) ** 2;
  const rel = Math.sqrt(d / (b - a)) / Math.max(rms(cem, a, b), 1e-9);
  // brightness: 8th harmonic relative to the 2nd — the SSM voicing's gentler
  // effective slope passes measurably more upper harmonics through
  const brS = goertzel(ssm, 880, a, b) / Math.max(goertzel(ssm, 220, a, b), 1e-9);
  const brC = goertzel(cem, 880, a, b) / Math.max(goertzel(cem, 220, a, b), 1e-9);
  check("filter rev: Rev 1/2 vs Rev 3 change the tone",
    rel > 0.1 && brS > 1.5 * brC,
    `rel Δ=${rel.toFixed(3)}, h8/h2 ssm=${brS.toFixed(4)} cem=${brC.toFixed(4)}`);
}

// ---- 4. wheel-mod routing --------------------------------------------------------
{
  const evs = [{ t: 0.02, on: [1, 220] }, { t: 2.9, off: 1 }];
  const base = { ...quiet, "LFO Freq": 0.55, "LFO Shape": 2, "Wheel Mix": 0 };
  const a = Math.floor(0.8 * S), b = Math.floor(2.8 * S);
  const fOff = render(3, { ...base, "Wheel Dest": 16, "Mod Wheel": 0 }, evs);
  const fOn = render(3, { ...base, "Wheel Dest": 16, "Mod Wheel": 1 }, evs);
  const wOff = windowedRmsSpread(fOff, a, b, 24), wOn = windowedRmsSpread(fOn, a, b, 24);
  check("wheel-mod: wheel → Filter pumps the tone",
    wOn > 4 * Math.max(wOff, 1e-4) && wOn > 0.05,
    `rms spread on=${wOn.toFixed(4)} off=${wOff.toFixed(4)}`);
  const pitchBase = { ...base, "Mix OscB": 0 }; // osc A alone → clean ZCR pitch proxy
  const pOff = render(3, { ...pitchBase, "Wheel Dest": 1, "Mod Wheel": 0 }, evs);
  const pOn = render(3, { ...pitchBase, "Wheel Dest": 1, "Mod Wheel": 1 }, evs);
  const zOff = zcrSpread(pOff, a, b), zOn = zcrSpread(pOn, a, b);
  check("wheel-mod: wheel → Freq A wobbles the pitch",
    zOn > 3 * Math.max(zOff, 1e-4) && zOn > 0.02,
    `zcr spread on=${zOn.toFixed(4)} off=${zOff.toFixed(4)}`);
}

// ---- 5. release switch --------------------------------------------------------------
{
  const evs = [{ t: 0.02, on: [1, 220] }, { t: 1.0, off: 1 }];
  const ov = { ...quiet, "AEnv Rel": 0.7, "FEnv Rel": 0.7 };
  const on = render(2.5, { ...ov, "Release Sw": 1 }, evs);
  const off = render(2.5, { ...ov, "Release Sw": 0 }, evs);
  const a = Math.floor(1.25 * S), b = Math.floor(1.9 * S);
  const tOn = rms(on, a, b), tOff = rms(off, a, b);
  check("release switch: off collapses the tail, on lets it ring",
    tOn > 10 * Math.max(tOff, 1e-7) && tOn > 0.005 && tOff < 0.002,
    `tail rms on=${tOn.toFixed(5)} off=${tOff.toFixed(5)}`);
}

// ---- 6. unison detune -----------------------------------------------------------------
{
  const evs = [{ t: 0.02, on: [1, 110] }, { t: 2.9, off: 1 }];
  const ov = { ...quiet, "Voice Mode": 5 }; // 5-voice unison, LO priority
  const d0 = render(3, { ...ov, "Uni Detune": 0 }, evs);
  const d8 = render(3, { ...ov, "Uni Detune": 8 }, evs);
  const a = Math.floor(0.8 * S), b = Math.floor(2.8 * S);
  const s0 = windowedRmsSpread(d0, a, b, 24), s8 = windowedRmsSpread(d8, a, b, 24);
  check("unison detune: detune 8 beats harder than 0",
    s8 > 2.5 * Math.max(s0, 1e-4) && s8 > 0.03,
    `rms spread det8=${s8.toFixed(4)} det0=${s0.toFixed(4)}`);
}

console.log(passAll ? "\nBEHAVIOR: ALL PASS ✅" : "\nBEHAVIOR: FAILURES ❌");
process.exit(passAll ? 0 : 1);
