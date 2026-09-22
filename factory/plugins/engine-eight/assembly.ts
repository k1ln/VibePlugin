// =====================================================================
//  ENGINE EIGHT — a macro-oscillator voice with eight selectable digital
//  synthesis engines, all played through the same three macro controls:
//  Harmonics, Timbre and Morph (each engine maps them to something that
//  makes sense for its own algorithm — see the per-engine comments below
//  and README.md). One voice, monophonic with glide, shared ADSR, a
//  post-engine resonant low-pass, an LFO you can route to pitch / cutoff
//  / timbre, and a Width control that spreads the mono core into stereo
//  via a short cross-feed delay. Inspired by the "one oscillator, many
//  algorithms" idea behind modern macro-oscillator Eurorack modules —
//  an original implementation, no code or samples borrowed.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const TAU: f32 = 6.2831853;
const PI: f32 = 3.14159265;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// ---- panel params -----------------------------------------------------
const P_ENG:     i32 = 0;   // 0..7 engine select
const P_HARM:    i32 = 1;   // harmonics macro
const P_TIMB:    i32 = 2;   // timbre macro
const P_MORPH:   i32 = 3;   // morph macro
const P_OCT:     i32 = 4;   // +-24 semitones
const P_GLIDE:   i32 = 5;
const P_ATK:     i32 = 6;
const P_DEC:     i32 = 7;
const P_SUS:     i32 = 8;
const P_REL:     i32 = 9;
const P_CUT:     i32 = 10;
const P_RES:     i32 = 11;
const P_ENVA:    i32 = 12;  // filter env amount
const P_LFORATE: i32 = 13;
const P_LFOAMT:  i32 = 14;
const P_LFODEST: i32 = 15; // 0 pitch, 1 cutoff, 2 timbre
const P_LEVEL:   i32 = 16;
const P_PAN:     i32 = 17;
const P_WIDTH:   i32 = 18;
const P_VELSENS: i32 = 19;
const NUM_PARAMS: i32 = 20;

// ---- shared helpers -----------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function clampi(x: i32, lo: i32, hi: i32): i32 { return x < lo ? lo : (x > hi ? hi : x); }

let rngState: i32 = 0x2a3b4c;
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

// chord ratio table: 8 chords x 4 voices, semitone offsets from the root
const CHORD: StaticArray<f32> = StaticArray.fromArray<f32>([
  0.0, 0.0, 0.0, 0.0,     // unison
  0.0, 12.0, 0.0, 12.0,   // octaves
  0.0, 7.0, 12.0, 19.0,   // power + fifth
  0.0, 4.0, 7.0, 12.0,    // major
  0.0, 3.0, 7.0, 12.0,    // minor
  0.0, 5.0, 7.0, 12.0,    // sus4
  0.0, 4.0, 7.0, 11.0,    // major 7
  0.0, 4.0, 7.0, 14.0,    // add9
]);

// vowel formant tables (F1,F2,F3 Hz + relative amps) for A E I O U — same
// data set as the Vowel Filter plugin's proven formant bank.
const F1: StaticArray<f32> = StaticArray.fromArray<f32>([ 800.0, 400.0, 350.0, 450.0, 325.0 ]);
const F2: StaticArray<f32> = StaticArray.fromArray<f32>([ 1150.0, 1700.0, 2000.0, 800.0, 700.0 ]);
const F3: StaticArray<f32> = StaticArray.fromArray<f32>([ 2900.0, 2600.0, 2800.0, 2830.0, 2530.0 ]);
const A1: StaticArray<f32> = StaticArray.fromArray<f32>([ 1.0, 1.0, 1.0, 1.0, 1.0 ]);
const A2: StaticArray<f32> = StaticArray.fromArray<f32>([ 0.63, 0.5, 0.35, 0.4, 0.2 ]);
const A3: StaticArray<f32> = StaticArray.fromArray<f32>([ 0.28, 0.25, 0.25, 0.25, 0.18 ]);
@inline function lerpTable(t: StaticArray<f32>, p: f32): f32 {
  const i0: i32 = i32(p);
  let i1: i32 = i0 + 1; if (i1 > 4) i1 = 4;
  const frac: f32 = p - f32(i0);
  const a: f32 = t[i0]; const b: f32 = t[i1];
  return f32(a + (b - a) * frac);
}

// classic metallic-hihat oscillator ratios (6 square oscillators, 808/909-style)
const HH_RATIOS: StaticArray<f32> = StaticArray.fromArray<f32>([ 1.0, 1.342, 1.489, 1.783, 2.0, 2.253 ]);

// ---- voice / envelope state ---------------------------------------------
let sampleRate: f32 = 48000.0;
let curFreq: f32 = 220.0;
let tgtFreq: f32 = 220.0;
let noteHeld: i32 = -1;
let gate: i32 = 0;
let envSt: i32 = 0;   // 0 idle,1 atk,2 dec,3 sus,4 rel
let env: f32 = 0.0;
let vel: f32 = 1.0;

let lfoPh: f32 = 0.0;

// engine 0: virtual analog
let ph1: f32 = 0.0; let ph2: f32 = 0.0; let ph3: f32 = 0.0; let phSub: f32 = 0.0;
// engine 1: wavefolder
let phFold: f32 = 0.0;
// engine 2: chord / string-machine
let phC0: f32 = 0.0; let phC1: f32 = 0.0; let phC2: f32 = 0.0; let phC3: f32 = 0.0;
// engine 3: speech / formant
let phExc: f32 = 0.0;
let sb1: f32 = 0.0; let sl1: f32 = 0.0; let sb2: f32 = 0.0; let sl2: f32 = 0.0; let sb3: f32 = 0.0; let sl3: f32 = 0.0;
// engine 4: granular
const GRAINS: i32 = 8;
const gPh:  StaticArray<f32> = new StaticArray<f32>(GRAINS);
const gPos: StaticArray<f32> = new StaticArray<f32>(GRAINS);
const gInc: StaticArray<f32> = new StaticArray<f32>(GRAINS);
const gFreq: StaticArray<f32> = new StaticArray<f32>(GRAINS);
const gActive: StaticArray<i32> = new StaticArray<i32>(GRAINS);
let gSpawnAcc: f32 = 0.0;
let gNext: i32 = 0;
// engine 5: modal pluck (Karplus-Strong, damped + dispersive)
const KSMAX: i32 = 4096;
const ksBuf: StaticArray<f32> = new StaticArray<f32>(KSMAX);
let ksWrite: i32 = 0;
let ksLoopLen: i32 = 200;
let ksLP: f32 = 0.0;
let ksAP: f32 = 0.0;
// engine 6: filtered noise / particle
const NRES: i32 = 4;
const nb: StaticArray<f32> = new StaticArray<f32>(NRES);
const nl: StaticArray<f32> = new StaticArray<f32>(NRES);
let dustTimer: f32 = 0.0;
// engine 7: percussion (kick/snare/hihat/clap)
let percAge: f32 = 0.0;
let kickPh: f32 = 0.0;
let snarePh: f32 = 0.0;
const hhPh: StaticArray<f32> = new StaticArray<f32>(6);
let hhHP: f32 = 0.0;
let clapTimer: f32 = 0.0;
let clapBurstIdx: i32 = 0;

// shared ladder filter state (4 one-pole tanh stages, quasar-style)
let z0: f32 = 0.0; let z1: f32 = 0.0; let z2: f32 = 0.0; let z3: f32 = 0.0;

// width: short cross-feed ring buffer for stereo spread
const WBUF: i32 = 64;
const widthBuf: StaticArray<f32> = new StaticArray<f32>(WBUF);
let widthIdx: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  curFreq = 220.0; tgtFreq = 220.0; noteHeld = -1; gate = 0; envSt = 0; env = 0.0; vel = 1.0;
  lfoPh = 0.0;
  ph1 = 0.0; ph2 = 0.0; ph3 = 0.0; phSub = 0.0;
  phFold = 0.0;
  phC0 = 0.0; phC1 = 0.0; phC2 = 0.0; phC3 = 0.0;
  phExc = 0.0; sb1 = 0.0; sl1 = 0.0; sb2 = 0.0; sl2 = 0.0; sb3 = 0.0; sl3 = 0.0;
  for (let k = 0; k < GRAINS; k++) { gPh[k] = 0.0; gPos[k] = 1.0; gInc[k] = 0.0; gFreq[k] = 220.0; gActive[k] = 0; }
  gSpawnAcc = 0.0; gNext = 0;
  for (let k = 0; k < KSMAX; k++) ksBuf[k] = 0.0;
  ksWrite = 0; ksLoopLen = 200; ksLP = 0.0; ksAP = 0.0;
  for (let k = 0; k < NRES; k++) { nb[k] = 0.0; nl[k] = 0.0; }
  dustTimer = 0.0;
  percAge = 0.0; kickPh = 0.0; snarePh = 0.0;
  for (let k = 0; k < 6; k++) hhPh[k] = 0.0;
  hhHP = 0.0; clapTimer = 0.0; clapBurstIdx = 0;
  z0 = 0.0; z1 = 0.0; z2 = 0.0; z3 = 0.0;
  for (let k = 0; k < WBUF; k++) widthBuf[k] = 0.0;
  widthIdx = 0;

  params[P_ENG] = 0.0; params[P_HARM] = 0.4; params[P_TIMB] = 0.4; params[P_MORPH] = 0.2;
  params[P_OCT] = 0.5; params[P_GLIDE] = 0.1;
  params[P_ATK] = 0.03; params[P_DEC] = 0.4; params[P_SUS] = 0.65; params[P_REL] = 0.3;
  params[P_CUT] = 0.7; params[P_RES] = 0.2; params[P_ENVA] = 0.3;
  params[P_LFORATE] = 0.3; params[P_LFOAMT] = 0.0; params[P_LFODEST] = 0.0;
  params[P_LEVEL] = 0.8; params[P_PAN] = 0.5; params[P_WIDTH] = 0.3; params[P_VELSENS] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

export function noteOn(id: i32, f: f32, v: f32): void {
  tgtFreq = f > 0.0 ? f : 220.0;
  if (noteHeld < 0) curFreq = tgtFreq;
  noteHeld = id; gate = 1; envSt = 1; vel = v > 0.0 ? v : 0.9;

  // percussion one-shot reset (harmless if engine 7 isn't selected)
  percAge = 0.0; kickPh = 0.0; snarePh = 0.0; clapTimer = 0.0; clapBurstIdx = 0; hhHP = 0.0;
  for (let k = 0; k < 6; k++) hhPh[k] = 0.0;

  // Karplus-Strong burst refill (harmless if engine 5 isn't selected)
  const semisTrig: f32 = (params[P_OCT] - 0.5) * 48.0;
  const freqTrig: f32 = tgtFreq * f32(Mathf.pow(2.0, semisTrig / 12.0));
  const per: f32 = sampleRate / (freqTrig > 20.0 ? freqTrig : 20.0);
  let ilen: i32 = i32(per + 0.5);
  if (ilen < 4) ilen = 4;
  if (ilen > KSMAX - 2) ilen = KSMAX - 2;
  for (let k = 0; k < ilen; k++) ksBuf[k] = rnd() * (0.55 + 0.45 * vel);
  ksWrite = 0;
  ksLoopLen = ilen;
}
export function noteOff(id: i32): void {
  if (id == noteHeld) { gate = 0; envSt = 4; noteHeld = -1; }
}

// ---- engine 0: virtual analog -------------------------------------------
@inline function engineVA(freq: f32, harm: f32, timb: f32, morph: f32): f32 {
  const detune: f32 = timb * timb * 0.06;
  ph1 += freq / sampleRate; if (ph1 >= 1.0) ph1 -= 1.0;
  ph2 += freq * (1.0 + detune) / sampleRate; if (ph2 >= 1.0) ph2 -= 1.0;
  ph3 += freq * (1.0 - detune) / sampleRate; if (ph3 >= 1.0) ph3 -= 1.0;
  phSub += (freq * 0.5) / sampleRate; if (phSub >= 1.0) phSub -= 1.0;

  const pw: f32 = 0.5 - harm * 0.4;
  const saw1: f32 = ph1 * 2.0 - 1.0;
  const pul1: f32 = ph1 < pw ? 1.0 : -1.0;
  const o1: f32 = saw1 * (1.0 - harm) + pul1 * harm;
  const unison: f32 = (ph2 * 2.0 - 1.0 + ph3 * 2.0 - 1.0) * 0.5;
  const sub: f32 = f32(Mathf.sin(phSub * TAU));
  return f32((o1 * (1.0 - morph * 0.4) + unison * morph * 0.7 + sub * morph * 0.35) * 0.8);
}

// ---- engine 1: wavefolder -----------------------------------------------
@inline function wavefold(x: f32): f32 {
  let v: f32 = x;
  for (let k = 0; k < 5; k++) {
    if (v > 1.0) v = 2.0 - v;
    else if (v < -1.0) v = -2.0 - v;
    else break;
  }
  return v;
}
@inline function engineFold(freq: f32, harm: f32, timb: f32, morph: f32): f32 {
  phFold += freq / sampleRate; if (phFold >= 1.0) phFold -= 1.0;
  const core: f32 = f32(Mathf.sin(phFold * TAU));
  const asym: f32 = (timb - 0.5) * 1.2;
  const amount1: f32 = 1.0 + harm * 9.0;
  const folded1: f32 = wavefold(core * amount1 + asym);
  const amount2: f32 = 1.0 + harm * 16.0;
  const folded2: f32 = wavefold(folded1 * (1.0 + amount2 * 0.4) + asym * 0.5);
  return folded1 * (1.0 - morph) + folded2 * morph;
}

// ---- engine 2: chord / string-machine wavetable -------------------------
@inline function engineChord(freq: f32, harm: f32, timb: f32, morph: f32): f32 {
  const idx: i32 = clampi(i32(harm * 7.999), 0, 7);
  const base: i32 = idx * 4;
  const spread: f32 = morph * 0.01;
  const f0: f32 = freq * f32(Mathf.pow(2.0, CHORD[base + 0] / 12.0)) * (1.0 - 1.5 * spread);
  const f1: f32 = freq * f32(Mathf.pow(2.0, CHORD[base + 1] / 12.0)) * (1.0 - 0.5 * spread);
  const f2: f32 = freq * f32(Mathf.pow(2.0, CHORD[base + 2] / 12.0)) * (1.0 + 0.5 * spread);
  const f3: f32 = freq * f32(Mathf.pow(2.0, CHORD[base + 3] / 12.0)) * (1.0 + 1.5 * spread);
  phC0 += f0 / sampleRate; if (phC0 >= 1.0) phC0 -= 1.0;
  phC1 += f1 / sampleRate; if (phC1 >= 1.0) phC1 -= 1.0;
  phC2 += f2 / sampleRate; if (phC2 >= 1.0) phC2 -= 1.0;
  phC3 += f3 / sampleRate; if (phC3 >= 1.0) phC3 -= 1.0;
  const pw: f32 = 0.5 - timb * 0.4;
  const v0: f32 = (phC0 * 2.0 - 1.0) * (1.0 - timb) + (phC0 < pw ? 1.0 : -1.0) * timb;
  const v1: f32 = (phC1 * 2.0 - 1.0) * (1.0 - timb) + (phC1 < pw ? 1.0 : -1.0) * timb;
  const v2: f32 = (phC2 * 2.0 - 1.0) * (1.0 - timb) + (phC2 < pw ? 1.0 : -1.0) * timb;
  const v3: f32 = (phC3 * 2.0 - 1.0) * (1.0 - timb) + (phC3 < pw ? 1.0 : -1.0) * timb;
  return f32((v0 + v1 + v2 + v3) * 0.24);
}

// ---- engine 3: speech / formant ------------------------------------------
@inline function engineSpeech(freq: f32, harm: f32, timb: f32, morph: f32): f32 {
  phExc += freq / sampleRate; if (phExc >= 1.0) phExc -= 1.0;
  const puls: f32 = phExc < 0.15 ? 1.0 : -0.176;
  const exc: f32 = puls * (1.0 - timb) + rnd() * timb;

  const vpos: f32 = clampf(harm * 4.0, 0.0, 4.0);
  const nyq: f32 = sampleRate * 0.45;
  const trackScale: f32 = 1.0 + morph * (freq / 220.0 - 1.0);
  const f1: f32 = clampf(lerpTable(F1, vpos) * trackScale, 20.0, nyq);
  const f2: f32 = clampf(lerpTable(F2, vpos) * trackScale, 20.0, nyq);
  const f3: f32 = clampf(lerpTable(F3, vpos) * trackScale, 20.0, nyq);
  const am1: f32 = lerpTable(A1, vpos); const am2: f32 = lerpTable(A2, vpos); const am3: f32 = lerpTable(A3, vpos);
  const g1: f32 = f32(2.0 * Mathf.sin(PI * f1 / sampleRate));
  const g2: f32 = f32(2.0 * Mathf.sin(PI * f2 / sampleRate));
  const g3: f32 = f32(2.0 * Mathf.sin(PI * f3 / sampleRate));
  const q: f32 = 0.35;

  const hp1: f32 = exc - sl1 - q * sb1; sb1 = f32(sb1 + g1 * hp1); sl1 = f32(sl1 + g1 * sb1);
  const hp2: f32 = exc - sl2 - q * sb2; sb2 = f32(sb2 + g2 * hp2); sl2 = f32(sl2 + g2 * sb2);
  const hp3: f32 = exc - sl3 - q * sb3; sb3 = f32(sb3 + g3 * hp3); sl3 = f32(sl3 + g3 * sb3);

  let wet: f32 = f32((sb1 * am1 + sb2 * am2 + sb3 * am3) * 0.55);
  if (wet > 1.3) wet = 1.3; else if (wet < -1.3) wet = -1.3;
  return wet;
}

// ---- engine 4: granular ---------------------------------------------------
@inline function engineGranular(freq: f32, harm: f32, timb: f32, morph: f32): f32 {
  const rateHz: f32 = 3.0 + harm * 45.0;
  gSpawnAcc += rateHz / sampleRate;
  if (gSpawnAcc >= 1.0) {
    gSpawnAcc -= 1.0;
    const slot: i32 = gNext; gNext = (gNext + 1) % GRAINS;
    const offOct: f32 = rnd() * morph * 2.0;
    gFreq[slot] = freq * f32(Mathf.pow(2.0, offOct));
    const durSec: f32 = 0.02 + (1.0 - harm) * 0.16;
    gInc[slot] = 1.0 / (durSec * sampleRate);
    gPos[slot] = 0.0; gPh[slot] = 0.0; gActive[slot] = 1;
  }
  let sum: f32 = 0.0;
  for (let k = 0; k < GRAINS; k++) {
    if (gActive[k] == 0) continue;
    gPos[k] += gInc[k];
    if (gPos[k] >= 1.0) { gActive[k] = 0; continue; }
    gPh[k] += gFreq[k] / sampleRate; if (gPh[k] >= 1.0) gPh[k] -= 1.0;
    const sine: f32 = f32(Mathf.sin(gPh[k] * TAU));
    const saw: f32 = gPh[k] * 2.0 - 1.0;
    let wf: f32;
    if (timb < 0.5) { const t2: f32 = timb * 2.0; wf = sine * (1.0 - t2) + saw * t2; }
    else { const t2: f32 = (timb - 0.5) * 2.0; wf = saw * (1.0 - t2) + rnd() * t2; }
    const win: f32 = f32(Mathf.sin(PI * gPos[k]));
    sum += wf * win;
  }
  return sum * 0.35;
}

// ---- engine 5: modal pluck (damped + dispersive Karplus-Strong) ---------
// A single circular buffer of exactly ksLoopLen samples (set at noteOn from
// the trigger pitch — pitch is fixed for the life of the note, a deliberate
// v1 simplification; a *fractional*, continuously-retuned delay line is the
// textbook approach for glide/vibrato but is easy to get subtly wrong, so
// this trades that off for a version that's simple to reason about and
// verified to actually ring). Each sample: read the oldest value (the one
// about to be overwritten), damp/disperse it, write it back to the same
// slot, advance one step. decayCoef is a per-SAMPLE coefficient derived
// (once per block, in process()) from a decay TIME in seconds.
@inline function engineModal(harm: f32, timb: f32, decayCoef: f32): f32 {
  const pos: i32 = ksWrite;
  const raw: f32 = ksBuf[pos];

  const damp: f32 = 0.15 + (1.0 - harm) * 0.78;
  ksLP = f32(ksLP + (raw - ksLP) * (1.0 - damp));
  const apCoef: f32 = -0.5 + timb * 0.85;
  const apOut: f32 = f32(-apCoef * ksLP + ksAP);
  ksAP = f32(ksLP + apCoef * apOut);
  let looped: f32 = f32(ksLP * (1.0 - timb * 0.6) + apOut * (timb * 0.6));
  looped = f32(looped * decayCoef);
  ksBuf[pos] = looped;
  ksWrite = pos + 1; if (ksWrite >= ksLoopLen) ksWrite = 0;
  return raw;
}

// ---- engine 6: filtered noise / particle ---------------------------------
@inline function engineNoise(freq: f32, harm: f32, timb: f32, morph: f32): f32 {
  dustTimer -= 1.0;
  let imp: f32 = 0.0;
  const dustRate: f32 = 4.0 + harm * 30.0;
  if (dustTimer <= 0.0) {
    imp = rnd();
    dustTimer = (sampleRate / (dustRate > 1.0 ? dustRate : 1.0)) * (0.4 + (rnd() * 0.5 + 0.5) * 1.2);
  }
  const white: f32 = rnd();
  const src: f32 = white * (1.0 - morph) + imp * morph;

  const q: f32 = 0.55 - timb * 0.5;
  const nyq: f32 = sampleRate * 0.45;
  const spread: f32 = 1.0 + harm * 3.0;
  let sum: f32 = 0.0;
  for (let k = 0; k < NRES; k++) {
    const mult: f32 = 1.0 + f32(k) * spread;
    const fc: f32 = clampf(freq * mult, 20.0, nyq);
    const g: f32 = f32(2.0 * Mathf.sin(PI * fc / sampleRate));
    const hp: f32 = src - nl[k] - q * nb[k];
    nb[k] = f32(nb[k] + g * hp);
    nl[k] = f32(nl[k] + g * nb[k]);
    sum += nb[k] * (1.0 / (1.0 + f32(k) * 0.6));
  }
  let wet: f32 = sum * 0.5;
  if (wet > 1.3) wet = 1.3; else if (wet < -1.3) wet = -1.3;
  return wet;
}

// ---- engine 7: percussion (kick / snare / hihat / clap) ------------------
@inline function enginePerc(freq: f32, harm: f32, timb: f32, morph: f32): f32 {
  percAge += 1.0 / sampleRate;
  const zone: i32 = clampi(i32(harm * 3.999), 0, 3);
  let out: f32 = 0.0;
  if (zone == 0) {
    const pdrop: f32 = f32(Mathf.exp(-percAge * (6.0 + timb * 18.0)));
    const kf: f32 = freq * (1.0 + pdrop * 2.5);
    kickPh += kf / sampleRate; if (kickPh >= 1.0) kickPh -= 1.0;
    const amp: f32 = f32(Mathf.exp(-percAge * (1.5 + (1.0 - morph) * 7.0)));
    const click: f32 = percAge < 0.002 ? rnd() * (1.0 - percAge / 0.002) : 0.0;
    out = f32(Mathf.sin(kickPh * TAU)) * amp + click * 0.5;
  } else if (zone == 1) {
    snarePh += (freq * 1.6) / sampleRate; if (snarePh >= 1.0) snarePh -= 1.0;
    const tone: f32 = f32(Mathf.sin(snarePh * TAU));
    const noiseAmp: f32 = f32(Mathf.exp(-percAge * (3.0 + (1.0 - morph) * 10.0)));
    const toneAmp: f32 = f32(Mathf.exp(-percAge * (6.0 + (1.0 - morph) * 14.0)));
    out = tone * toneAmp * (1.0 - timb) + rnd() * noiseAmp * (0.5 + timb * 0.5);
  } else if (zone == 2) {
    let hsum: f32 = 0.0;
    for (let k = 0; k < 6; k++) {
      hhPh[k] += (freq * 2.0 * HH_RATIOS[k]) / sampleRate;
      if (hhPh[k] >= 1.0) hhPh[k] -= 1.0;
      hsum += hhPh[k] < 0.5 ? 1.0 : -1.0;
    }
    hsum = hsum / 6.0;
    hhHP = f32(hhHP + (hsum - hhHP) * 0.3);
    const hp: f32 = hsum - hhHP;
    const amp: f32 = f32(Mathf.exp(-percAge * (8.0 + (1.0 - morph) * 40.0 + timb * 20.0)));
    out = hp * amp * 2.5;
  } else {
    clapTimer += 1.0 / sampleRate;
    let burstGate: f32 = 0.0;
    const bt: f32 = clapTimer - f32(clapBurstIdx) * 0.012;
    if (bt >= 0.0 && bt < 0.008 && clapBurstIdx < 3) burstGate = 1.0;
    else if (clapBurstIdx < 3 && bt >= 0.008) clapBurstIdx += 1;
    const tailAmp: f32 = f32(Mathf.exp(-percAge * (2.0 + (1.0 - morph) * 8.0)));
    out = rnd() * (burstGate * 0.9 + tailAmp * 0.4) * (0.5 + timb * 0.5);
  }
  return out;
}

// ---- main process ---------------------------------------------------------
export function process(n: i32): void {
  const eng: i32 = clampi(i32(params[P_ENG] + 0.5), 0, 7);
  const harm: f32 = clampf(params[P_HARM], 0.0, 1.0);
  const timb: f32 = clampf(params[P_TIMB], 0.0, 1.0);
  const morph: f32 = clampf(params[P_MORPH], 0.0, 1.0);
  const oct: f32 = clampf(params[P_OCT], 0.0, 1.0);
  const glideN: f32 = clampf(params[P_GLIDE], 0.0, 1.0);
  const atkN: f32 = clampf(params[P_ATK], 0.0, 1.0);
  const decN: f32 = clampf(params[P_DEC], 0.0, 1.0);
  const susN: f32 = clampf(params[P_SUS], 0.0, 1.0);
  const relN: f32 = clampf(params[P_REL], 0.0, 1.0);
  const cutN: f32 = clampf(params[P_CUT], 0.0, 1.0);
  const resN: f32 = clampf(params[P_RES], 0.0, 1.0);
  const envAN: f32 = clampf(params[P_ENVA], 0.0, 1.0);
  const lfoRateN: f32 = clampf(params[P_LFORATE], 0.0, 1.0);
  const lfoAmtN: f32 = clampf(params[P_LFOAMT], 0.0, 1.0);
  const lfoDest: i32 = clampi(i32(params[P_LFODEST] + 0.5), 0, 2);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);
  const panN: f32 = clampf(params[P_PAN], 0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const velSensN: f32 = clampf(params[P_VELSENS], 0.0, 1.0);

  const semis: f32 = (oct - 0.5) * 48.0;
  const octRatio: f32 = f32(Mathf.pow(2.0, semis / 12.0));
  const atkInc: f32 = 1.0 / ((0.002 + atkN * atkN * 1.6) * sampleRate);
  const decT: f32 = 0.02 + decN * decN * 3.0;
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (decT * sampleRate)));
  const relT: f32 = 0.02 + relN * relN * 3.5;
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (relT * sampleRate)));
  const lfoHz: f32 = 0.03 * f32(Mathf.pow(300.0, lfoRateN));
  const lfoInc: f32 = lfoHz / sampleRate;
  const glideCoef: f32 = glideN < 0.001 ? 0.0 : f32(Mathf.exp(-1.0 / ((0.003 + glideN * 0.6) * sampleRate)));
  const baseCut: f32 = 30.0 * f32(Mathf.exp(cutN * 6.2));
  const reso: f32 = resN * 3.9;
  const ksDecayCoef: f32 = f32(Mathf.exp(-1.0 / ((0.2 + morph * 4.8) * sampleRate)));
  const ampVel: f32 = (1.0 - velSensN) + velSensN * vel;
  const outLevel: f32 = level * 0.85;
  const panBi: f32 = panN * 2.0 - 1.0;
  const lGain: f32 = clampf(1.0 - panBi, 0.0, 1.0);
  const rGain: f32 = clampf(1.0 + panBi, 0.0, 1.0);
  const delaySamps: i32 = clampi(1 + i32(widthN * 30.0), 1, WBUF - 1);

  for (let i = 0; i < n; i++) {
    if (glideCoef > 0.0) curFreq = curFreq + (tgtFreq - curFreq) * (1.0 - glideCoef);
    else curFreq = tgtFreq;

    // envelope
    if (envSt == 1) { env += atkInc; if (env >= 1.0) { env = 1.0; envSt = 2; } }
    else if (envSt == 2) { env = susN + (env - susN) * decCoef; if (env <= susN + 0.001) { env = susN; envSt = 3; } }
    else if (envSt == 3) { env = susN; }
    else if (envSt == 4) { env *= relCoef; if (env < 0.0003) { env = 0.0; envSt = 0; } }

    lfoPh += lfoInc; if (lfoPh >= 1.0) lfoPh -= 1.0;
    const lfo: f32 = f32(Mathf.sin(lfoPh * TAU));

    let pitchRatio: f32 = 1.0;
    let cutMod: f32 = 0.0;
    let timbUse: f32 = timb;
    if (lfoDest == 0) pitchRatio = f32(Mathf.pow(2.0, (lfo * lfoAmtN * 7.0) / 12.0));
    else if (lfoDest == 1) cutMod = lfo * lfoAmtN;
    else timbUse = clampf(timb + lfo * lfoAmtN * 0.5, 0.0, 1.0);

    const freq: f32 = curFreq * octRatio * pitchRatio;

    let core: f32 = 0.0;
    if (eng == 0) core = engineVA(freq, harm, timbUse, morph);
    else if (eng == 1) core = engineFold(freq, harm, timbUse, morph);
    else if (eng == 2) core = engineChord(freq, harm, timbUse, morph);
    else if (eng == 3) core = engineSpeech(freq, harm, timbUse, morph);
    else if (eng == 4) core = engineGranular(freq, harm, timbUse, morph);
    else if (eng == 5) core = engineModal(harm, timbUse, ksDecayCoef);
    else if (eng == 6) core = engineNoise(freq, harm, timbUse, morph);
    else core = enginePerc(freq, harm, timbUse, morph);

    // shared resonant ladder low-pass
    let fc: f32 = baseCut * f32(Mathf.pow(2.0, envAN * env * 3.2 + cutMod * 3.5));
    fc = clampf(fc, 20.0, sampleRate * 0.46);
    const g: f32 = f32(Mathf.tan(PI * fc / sampleRate));
    const G: f32 = g / (1.0 + g);
    const inp: f32 = f32(Mathf.tanh(core * 1.1));
    let u: f32 = f32(Mathf.tanh((inp - reso * z3) * 0.85));
    z0 = f32(z0 + G * (u - Mathf.tanh(z0)));
    z1 = f32(z1 + G * (Mathf.tanh(z0) - Mathf.tanh(z1)));
    z2 = f32(z2 + G * (Mathf.tanh(z1) - Mathf.tanh(z2)));
    z3 = f32(z3 + G * (Mathf.tanh(z2) - Mathf.tanh(z3)));
    const filtered: f32 = z3;

    const sig: f32 = filtered * env * ampVel;

    // width via short cross-feed delay, then equal-power-ish pan
    widthBuf[widthIdx] = sig;
    let ri: i32 = widthIdx - delaySamps; while (ri < 0) ri += WBUF;
    const delayed: f32 = widthBuf[ri];
    widthIdx = (widthIdx + 1) % WBUF;
    const rSig: f32 = sig * (1.0 - widthN) + delayed * widthN;

    const outL: f32 = f32(Mathf.tanh(sig * lGain * outLevel * 1.3));
    const outR: f32 = f32(Mathf.tanh(rSig * rGain * outLevel * 1.3));
    outBuf[i] = outL;
    outBuf[MAX_FRAMES + i] = outR;
  }
}
