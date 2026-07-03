// =====================================================================
//  FAT MONO — a monophonic analog instrument modelled control-for-control
//  on the Moog Minimoog Model D (User's Manual Version 2, 84 pp, read
//  cover to cover; every front-panel control is represented here).
//
//  OSCILLATOR BANK: three oscillators, each with six waveforms
//  (triangle, triangle-sawtooth hybrid — reverse sawtooth on osc 3 —
//  sawtooth, square, wide pulse, narrow pulse; polyBLEP band-limited)
//  and six ranges (LO, 32', 16', 8', 4', 2'); osc 2 & 3 FREQUENCY knobs
//  detune ±7 semitones; OSC. 3 CONTROL releases osc 3 from the keyboard
//  (fixed base pitch → drone / free-running modulation source).
//  CONTROLLERS: master TUNE (±2 semi), GLIDE (1 ms – 10 s per octave,
//  fixed-rate like the hardware), MODULATION MIX between the
//  OSC.3/FILTER-EG source and the NOISE/LFO source, OSCILLATOR
//  MODULATION switch (bus → osc pitch, rides the mod wheel).  The noise
//  mod source is PINK when the mixer noise switch is WHITE and RED when
//  it is PINK (manual p.21).  Dedicated LFO 0.05–200 Hz with the
//  push/pull triangle/square shape (manual p.23).
//  MIXER: Osc 1/2/3, NOISE (white/pink) and EXTERNAL INPUT, each with an
//  on/off rocker and volume; with no cable the main output is normalled
//  back into the external input, so EXTERNAL INPUT VOLUME × MAIN OUTPUT
//  VOLUME overloads the mixer into the famous scream (manual p.27/36).
//  MODIFIERS: 24 dB/oct ladder LPF (10 Hz – 20 kHz, self-oscillating
//  EMPHASIS, passband makeup), AMOUNT OF CONTOUR 0–4 octaves, KEYBOARD
//  CONTROL 1 (1/3) & 2 (2/3) tracking switches, FILTER MODULATION
//  switch; FILTER + LOUDNESS contours (attack 1 ms–10 s, decay
//  4 ms–35 s, sustain) with the left-hand DECAY switch: on → decay time
//  is reused as the release, off → abrupt release (manual p.30/31).
//  OUTPUT: volume, MAIN OUTPUT switch, A-440 reference tuner.
//  KEYBOARD: low/high/last note priority (low = classic default) and
//  multi-trigger vs legato single-trigger (Global Settings p.47),
//  spring-loaded pitch wheel ±7 semitones (a fifth, p.24), mod wheel,
//  and the reissue patch-panel routes velocity→loudness and
//  after-pressure→filter (p.40).
//
//  Switch groups are bit-packed to stay far below the 64-param cap; the
//  GUI decodes them into the individual rockers.  Pure algorithm — no
//  samples, no imports, allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const HELD_MAX: i32 = 16;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_TUNE: i32 = 0;     // -2..2 semitones master tune
const P_GLIDE: i32 = 1;    // 0..1 → 1 ms .. 10 s per octave
const P_MODMIX: i32 = 2;   // 0 = OSC3/FEG source, 1 = NOISE/LFO source
const P_MODSRC: i32 = 3;   // bit0: FILTER EG (else OSC 3), bit1: LFO (else NOISE)
const P_O1RNG: i32 = 4;    // 0 LO,1 32',2 16',3 8',4 4',5 2'
const P_O1WAV: i32 = 5;    // 0 tri,1 tri-saw,2 saw,3 square,4 wide pulse,5 narrow pulse
const P_O2RNG: i32 = 6;
const P_O2FRQ: i32 = 7;    // -7..7 semitones
const P_O2WAV: i32 = 8;
const P_O3RNG: i32 = 9;
const P_O3FRQ: i32 = 10;   // -7..7 semitones
const P_O3WAV: i32 = 11;   // slot 1 = REVERSE SAW (osc 3 only, manual p.18)
const P_OSCSW: i32 = 12;   // bit0 OSCILLATOR MODULATION on, bit1 OSC.3 KB CONTROL OFF
const P_MIXO1: i32 = 13;
const P_MIXO2: i32 = 14;
const P_MIXO3: i32 = 15;
const P_MIXEXT: i32 = 16;  // EXTERNAL INPUT VOLUME
const P_MIXNOI: i32 = 17;  // NOISE VOLUME
const P_MIXSW: i32 = 18;   // bit0..2 osc1..3 on, bit3 ext on, bit4 noise on, bit5 white(1)/pink(0)
const P_CUTOFF: i32 = 19;  // -4..4 (10 Hz .. ~20 kHz)
const P_EMPH: i32 = 20;    // 0..1 EMPHASIS, self-oscillates near max
const P_CONTAMT: i32 = 21; // 0..1 AMOUNT OF CONTOUR (0..4 octaves)
const P_FILTSW: i32 = 22;  // bit0 FILTER MODULATION, bit1 KEYBOARD CONTROL 1, bit2 KEYBOARD CONTROL 2
const P_FA: i32 = 23;      // filter contour attack (1 ms .. 10 s)
const P_FD: i32 = 24;      // filter contour decay (4 ms .. 35 s)
const P_FS: i32 = 25;      // filter contour sustain
const P_LA: i32 = 26;      // loudness contour attack
const P_LD: i32 = 27;      // loudness contour decay
const P_LS: i32 = 28;      // loudness contour sustain
const P_LFOR: i32 = 29;    // 0..1 → 0.05 .. 200 Hz
const P_PERFSW: i32 = 30;  // bit0 GLIDE on, bit1 DECAY on, bit2 LFO SQUARE, bit3 MAIN OUTPUT on
const P_KEYMODE: i32 = 31; // priority(0 low,1 high,2 last) + 3*multiTrigger + 6*A440
const P_PBEND: i32 = 32;   // -1..1 spring-loaded, ±7 semitones (a fifth)
const P_MODWHL: i32 = 33;  // 0..1
const P_VELLOUD: i32 = 34; // velocity → loudness patch amount
const P_PRSFILT: i32 = 35; // after pressure → filter patch amount
const P_PRESS: i32 = 36;   // 0..1 after pressure (performance)
const P_VOLUME: i32 = 37;  // MAIN OUTPUT VOLUME

const NUM_PARAMS: i32 = 38;

// ---- small helpers ---------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + 0.5); }

let rngState: i32 = 0x2545f491;
@inline function rngf(): f32 { // white noise -1..1, deterministic
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return f32(rngState & 0x7fffffff) / f32(0x3fffffff) - 1.0;
}

@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) { const x: f32 = t / dt; return x + x - x * x - 1.0; }
  else if (t > 1.0 - dt) { const x: f32 = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

// the six Model D waveform positions (manual p.17-19).
// revSaw: osc 3 replaces the tri-saw hybrid with a reverse sawtooth.
function oscWave(ph: f32, inc: f32, wav: i32, revSaw: i32): f32 {
  if (wav == 0) { // triangle
    return ph < 0.5 ? 4.0 * ph - 1.0 : 3.0 - 4.0 * ph;
  }
  // band-limited sawtooth building block
  let saw: f32 = 2.0 * ph - 1.0;
  saw -= polyBlep(ph, inc);
  if (wav == 1) {
    if (revSaw == 1) return -saw; // reverse sawtooth (osc 3 only)
    const tri: f32 = ph < 0.5 ? 4.0 * ph - 1.0 : 3.0 - 4.0 * ph;
    return (tri + saw) * 0.5;     // triangle-sawtooth hybrid
  }
  if (wav == 2) return saw;       // sawtooth
  // pulse family: square (0.5), wide rectangle (~1/3), narrow rectangle (~1/10)
  const pw: f32 = wav == 3 ? 0.5 : (wav == 4 ? 0.33 : 0.10);
  let sq: f32 = ph < pw ? 1.0 : -1.0;
  sq += polyBlep(ph, inc);
  let ph2: f32 = ph - pw; if (ph2 < 0.0) ph2 += 1.0;
  sq -= polyBlep(ph2, inc);
  return sq;
}

// RANGE switch → octave multiplier: LO, 32', 16', 8' (unison), 4', 2'.
// LO drops far below 32' so the oscillator becomes a modulation source
// ("brings the pitch down even further", manual p.17; 0.1 Hz per specs).
function rangeMul(r: i32): f32 {
  if (r == 0) return 0.015625;  // LO: -6 octaves
  if (r == 1) return 0.25;      // 32'
  if (r == 2) return 0.5;       // 16'
  if (r == 3) return 1.0;       // 8'
  if (r == 4) return 2.0;       // 4'
  return 4.0;                   // 2'
}

// contour attack: 1 ms .. 10 s (manual p.80)
@inline function atkTime(n: f32): f32 { return 0.001 * f32(Mathf.pow(10000.0, clampf(n, 0.0, 1.0))); }
// contour decay: 4 ms .. 35 s (manual p.80)
@inline function decTime(n: f32): f32 { return 0.004 * f32(Mathf.pow(8750.0, clampf(n, 0.0, 1.0))); }

// ---- mono voice state -------------------------------------------------
let gate: i32 = 0;
let curHz: f32 = 261.63;    // glide state
let targetHz: f32 = 261.63;
let glideK: f32 = 1.0;      // per-sample multiplicative step
let noteVel: f32 = 1.0;

let ph1: f32 = 0.0;
let ph2: f32 = 0.0;
let ph3: f32 = 0.0;
let o3Last: f32 = 0.0;      // osc 3 output, tapped for the mod bus

let aEnv: f32 = 0.0; let aStage: i32 = 0; // 0 idle, 1 attack, 2 decay→sustain, 4 release
let fEnv: f32 = 0.0; let fStage: i32 = 0;

let lp0: f32 = 0.0; let lp1: f32 = 0.0; let lp2: f32 = 0.0; let lp3: f32 = 0.0;

let lfoPhase: f32 = 0.0;
let pinkState: f32 = 0.0;   // one-pole for pink-ish mod noise
let redState: f32 = 0.0;    // deeper one-pole for red mod noise
let a440Phase: f32 = 0.0;
let fbSample: f32 = 0.0;    // main output normalled back to the ext input

// ---- held-key list (note priority) ------------------------------------
const hId:    StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
const hFreq:  StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hVel:   StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hOrder: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let orderCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  gate = 0; curHz = 261.63; targetHz = 261.63; glideK = 1.0; noteVel = 1.0;
  ph1 = 0.0; ph2 = 0.37; ph3 = 0.71; o3Last = 0.0;
  aEnv = 0.0; aStage = 0; fEnv = 0.0; fStage = 0;
  lp0 = 0.0; lp1 = 0.0; lp2 = 0.0; lp3 = 0.0;
  lfoPhase = 0.0; pinkState = 0.0; redState = 0.0; a440Phase = 0.0; fbSample = 0.0;
  hCount = 0; orderCounter = 0;

  // boot state = spec.json defaults (host may render before pushing)
  params[P_TUNE] = 0.0; params[P_GLIDE] = 0.25; params[P_MODMIX] = 0.0; params[P_MODSRC] = 0.0;
  params[P_O1RNG] = 3.0; params[P_O1WAV] = 2.0;
  params[P_O2RNG] = 3.0; params[P_O2FRQ] = 0.08; params[P_O2WAV] = 2.0;
  params[P_O3RNG] = 2.0; params[P_O3FRQ] = -0.12; params[P_O3WAV] = 2.0;
  params[P_OSCSW] = 0.0;
  params[P_MIXO1] = 0.8; params[P_MIXO2] = 0.75; params[P_MIXO3] = 0.7;
  params[P_MIXEXT] = 0.0; params[P_MIXNOI] = 0.0; params[P_MIXSW] = 39.0;
  params[P_CUTOFF] = 0.4; params[P_EMPH] = 0.35; params[P_CONTAMT] = 0.55;
  params[P_FILTSW] = 6.0;
  params[P_FA] = 0.2; params[P_FD] = 0.45; params[P_FS] = 0.4;
  params[P_LA] = 0.08; params[P_LD] = 0.5; params[P_LS] = 0.8;
  params[P_LFOR] = 0.35; params[P_PERFSW] = 9.0; params[P_KEYMODE] = 0.0;
  params[P_PBEND] = 0.0; params[P_MODWHL] = 0.0;
  params[P_VELLOUD] = 0.3; params[P_PRSFILT] = 0.35; params[P_PRESS] = 0.0;
  params[P_VOLUME] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- glide (fixed rate: 1 ms – 10 s PER OCTAVE, manual p.80) ----------
function computeGlide(): void {
  const on: i32 = pbits(P_PERFSW) & 1;
  glideK = 1.0;
  if (on == 0) { curHz = targetHz; return; }
  if (curHz <= 0.0) curHz = targetHz;
  if (curHz == targetHz) return;
  const n: f32 = clampf(pget(P_GLIDE), 0.0, 1.0);
  const tOct: f32 = 0.001 * f32(Mathf.pow(10000.0, n));     // seconds per octave
  const step: f32 = f32(Mathf.pow(2.0, 1.0 / (tOct * sampleRate)));
  glideK = targetHz > curHz ? step : 1.0 / step;
}

// pick the sounding key per note priority; newPress → decide (re)trigger
function retune(newPress: i32): void {
  if (hCount == 0) return;
  const km: i32 = pbits(P_KEYMODE);
  const prio: i32 = km % 3;             // 0 low, 1 high, 2 last
  const multiTrig: i32 = (km / 3) % 2;  // 1 = multi-trigger, 0 = legato single-trigger
  let pick: i32 = 0;
  if (prio == 0) { for (let i = 1; i < hCount; i++) if (hFreq[i] < hFreq[pick]) pick = i; }
  else if (prio == 1) { for (let i = 1; i < hCount; i++) if (hFreq[i] > hFreq[pick]) pick = i; }
  else { for (let i = 1; i < hCount; i++) if (hOrder[i] > hOrder[pick]) pick = i; }

  targetHz = hFreq[pick];
  noteVel = hVel[pick];
  const wasOff: i32 = gate == 0 ? 1 : 0;
  gate = 1;
  computeGlide();
  // contour triggering: a fresh press always fires from silence; while
  // holding, only multi-trigger re-fires (legato keeps the contours
  // running — Global Settings p.47).
  if (wasOff == 1 || (newPress == 1 && multiTrig == 1)) {
    aStage = 1; fStage = 1;
    if (wasOff == 1) { aEnv = 0.0; fEnv = 0.0; }
  }
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  // update or append in the held list
  let found: i32 = -1;
  for (let i = 0; i < hCount; i++) if (hId[i] == id) { found = i; break; }
  if (found >= 0) {
    hFreq[found] = hz; hVel[found] = vel; hOrder[found] = orderCounter++;
  } else {
    if (hCount >= HELD_MAX) { // drop the oldest entry
      for (let i = 1; i < hCount; i++) {
        hId[i - 1] = hId[i]; hFreq[i - 1] = hFreq[i]; hVel[i - 1] = hVel[i]; hOrder[i - 1] = hOrder[i];
      }
      hCount--;
    }
    hId[hCount] = id; hFreq[hCount] = hz; hVel[hCount] = clampf(vel, 0.0, 1.0);
    hOrder[hCount] = orderCounter++;
    hCount++;
  }
  retune(1);
}

export function noteOff(id: i32): void {
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) {
      for (let j = i + 1; j < hCount; j++) {
        hId[j - 1] = hId[j]; hFreq[j - 1] = hFreq[j]; hVel[j - 1] = hVel[j]; hOrder[j - 1] = hOrder[j];
      }
      hCount--;
      break;
    }
  }
  if (hCount == 0) {
    if (gate == 1) { gate = 0; aStage = 4; fStage = 4; }
  } else {
    retune(0); // fall back to the remaining priority note (glide carries the pitch)
  }
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- per-block parameter mapping -------------------------------------
  const tuneSemi: f32 = clampf(pget(P_TUNE), -2.0, 2.0);
  const modMix: f32 = clampf(pget(P_MODMIX), 0.0, 1.0);
  const modSrc: i32 = pbits(P_MODSRC);
  const srcAisFEG: i32 = modSrc & 1;
  const srcBisLFO: i32 = (modSrc >> 1) & 1;

  const o1Rng: f32 = rangeMul(pbits(P_O1RNG));
  const o2Rng: f32 = rangeMul(pbits(P_O2RNG));
  const o3Rng: f32 = rangeMul(pbits(P_O3RNG));
  const o1Wav: i32 = pbits(P_O1WAV);
  const o2Wav: i32 = pbits(P_O2WAV);
  const o3Wav: i32 = pbits(P_O3WAV);
  const o2Semi: f32 = clampf(pget(P_O2FRQ), -7.0, 7.0);
  const o3Semi: f32 = clampf(pget(P_O3FRQ), -7.0, 7.0);

  const oscSw: i32 = pbits(P_OSCSW);
  const oscModOn: i32 = oscSw & 1;
  const o3KbOff: i32 = (oscSw >> 1) & 1;

  const mixSw: i32 = pbits(P_MIXSW);
  const o1On: f32 = f32(mixSw & 1);
  const o2On: f32 = f32((mixSw >> 1) & 1);
  const o3On: f32 = f32((mixSw >> 2) & 1);
  const extOn: f32 = f32((mixSw >> 3) & 1);
  const noiOn: f32 = f32((mixSw >> 4) & 1);
  const noiWhite: i32 = (mixSw >> 5) & 1;
  const mixO1: f32 = clampf(pget(P_MIXO1), 0.0, 1.0) * o1On;
  const mixO2: f32 = clampf(pget(P_MIXO2), 0.0, 1.0) * o2On;
  const mixO3: f32 = clampf(pget(P_MIXO3), 0.0, 1.0) * o3On;
  const mixExt: f32 = clampf(pget(P_MIXEXT), 0.0, 1.0);
  const mixNoi: f32 = clampf(pget(P_MIXNOI), 0.0, 1.0) * noiOn;

  const cutK: f32 = clampf(pget(P_CUTOFF), -4.0, 4.0);
  const fcBase: f32 = 450.0 * f32(Mathf.pow(2.0, cutK * 1.375)); // ~10 Hz .. ~20.4 kHz
  const emph: f32 = clampf(pget(P_EMPH), 0.0, 1.0);
  const kLad: f32 = emph * 4.15;                                 // self-oscillates near max
  const contAmt: f32 = clampf(pget(P_CONTAMT), 0.0, 1.0) * 4.0;  // 0..4 octaves (specs p.80)
  const filtSw: i32 = pbits(P_FILTSW);
  const filtModOn: i32 = filtSw & 1;
  const kbTrk: f32 = f32((filtSw >> 1) & 1) * 0.3333333 + f32((filtSw >> 2) & 1) * 0.6666667;

  const perfSw: i32 = pbits(P_PERFSW);
  const decaySw: i32 = (perfSw >> 1) & 1;
  const lfoSquare: i32 = (perfSw >> 2) & 1;
  const mainOut: f32 = f32((perfSw >> 3) & 1);
  const a440On: i32 = (pbits(P_KEYMODE) / 6) % 2;

  // contour rates (attack linear-ramp; decay/release exponential-approach)
  const fAtkStep: f32 = 1.0 / (atkTime(pget(P_FA)) * sr);
  const fDecK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(P_FD)) * sr)));
  const fSus: f32 = clampf(pget(P_FS), 0.0, 1.0);
  const aAtkStep: f32 = 1.0 / (atkTime(pget(P_LA)) * sr);
  const aDecK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (decTime(pget(P_LD)) * sr)));
  const aSus: f32 = clampf(pget(P_LS), 0.0, 1.0);
  // DECAY switch: on → release at the decay-time rate; off → abrupt (~4 ms)
  const fastRelK: f32 = 1.0 - f32(Mathf.exp(-4.0 / (0.004 * sr)));
  const fRelK: f32 = decaySw == 1 ? fDecK : fastRelK;
  const aRelK: f32 = decaySw == 1 ? aDecK : fastRelK;

  const lfoHz: f32 = 0.05 * f32(Mathf.pow(4000.0, clampf(pget(P_LFOR), 0.0, 1.0))); // 0.05..200 Hz
  const lfoInc: f32 = lfoHz / sr;

  const bendSemi: f32 = clampf(pget(P_PBEND), -1.0, 1.0) * 7.0;  // a fifth up/down (p.24)
  const wheel: f32 = clampf(pget(P_MODWHL), 0.0, 1.0);
  const velLoud: f32 = clampf(pget(P_VELLOUD), 0.0, 1.0);
  const prsFilt: f32 = clampf(pget(P_PRSFILT), 0.0, 1.0);
  const press: f32 = clampf(pget(P_PRESS), 0.0, 1.0);
  const vol: f32 = clampf(pget(P_VOLUME), 0.0, 1.0);
  const outGain: f32 = vol * vol * 2.4;

  // velocity → loudness (reissue patch route, manual p.40)
  const velGain: f32 = 1.0 - velLoud * (1.0 - noteVel * noteVel);

  // pink noise for the mod bus when WHITE is selected, red when PINK (p.21)
  const pinkK: f32 = clampf(TWO_PI * 400.0 / sr, 0.0, 0.9);
  const redK: f32 = clampf(TWO_PI * 40.0 / sr, 0.0, 0.9);

  const glideOn: i32 = perfSw & 1;

  for (let f = 0; f < n; f++) {
    // ---- glide -----------------------------------------------------------
    if (curHz != targetHz) {
      if (glideOn == 0 || glideK == 1.0) curHz = targetHz;
      else {
        curHz *= glideK;
        if ((glideK > 1.0 && curHz >= targetHz) || (glideK < 1.0 && curHz <= targetHz)) curHz = targetHz;
      }
    }

    // ---- contours ---------------------------------------------------------
    if (aStage == 1) { aEnv += aAtkStep; if (aEnv >= 1.0) { aEnv = 1.0; aStage = 2; } }
    else if (aStage == 2) { aEnv += (aSus - aEnv) * aDecK; }
    else if (aStage == 4) { aEnv += (0.0 - aEnv) * aRelK; if (aEnv <= 0.0004) { aEnv = 0.0; aStage = 0; } }
    if (fStage == 1) { fEnv += fAtkStep; if (fEnv >= 1.0) { fEnv = 1.0; fStage = 2; } }
    else if (fStage == 2) { fEnv += (fSus - fEnv) * fDecK; }
    else if (fStage == 4) { fEnv += (0.0 - fEnv) * fRelK; if (fEnv <= 0.0004) fEnv = 0.0; }

    // ---- LFO + mod noise ----------------------------------------------------
    lfoPhase += lfoInc; if (lfoPhase >= 1.0) lfoPhase -= 1.0;
    const lfoTri: f32 = lfoPhase < 0.5 ? lfoPhase * 4.0 - 1.0 : 3.0 - lfoPhase * 4.0;
    const lfoVal: f32 = lfoSquare == 1 ? (lfoPhase < 0.5 ? 1.0 : -1.0) : lfoTri;
    const wn: f32 = rngf();
    pinkState += (wn - pinkState) * pinkK;
    redState += (wn - redState) * redK;
    const modNoise: f32 = noiWhite == 1 ? pinkState * 2.2 : redState * 5.0;

    // ---- modulation bus (CONTROLLERS section, rides the mod wheel) ---------
    const srcA: f32 = srcAisFEG == 1 ? fEnv : o3Last;
    const srcB: f32 = srcBisLFO == 1 ? lfoVal : modNoise;
    const bus: f32 = (srcA * (1.0 - modMix) + srcB * modMix) * wheel;

    // ---- oscillator pitches --------------------------------------------------
    let semiCommon: f32 = tuneSemi + bendSemi;
    if (oscModOn == 1) semiCommon += bus * 7.0; // OSCILLATOR MODULATION → pitch
    const kbMul: f32 = curHz * f32(Mathf.pow(2.0, semiCommon / 12.0));

    let inc1: f32 = kbMul * o1Rng / sr;
    if (inc1 > 0.45) inc1 = 0.45; if (inc1 < 0.0) inc1 = 0.0;
    ph1 += inc1; if (ph1 >= 1.0) ph1 -= 1.0;
    const osc1: f32 = oscWave(ph1, inc1, o1Wav, 0);

    let inc2: f32 = kbMul * o2Rng * f32(Mathf.pow(2.0, o2Semi / 12.0)) / sr;
    if (inc2 > 0.45) inc2 = 0.45; if (inc2 < 0.0) inc2 = 0.0;
    ph2 += inc2; if (ph2 >= 1.0) ph2 -= 1.0;
    const osc2: f32 = oscWave(ph2, inc2, o2Wav, 0);

    // osc 3: KB CONTROL OFF → fixed C2 base, free of keyboard, glide and
    // the mod bus (so it stays a stable drone / modulation source)
    let hz3: f32;
    if (o3KbOff == 1) hz3 = 65.41 * o3Rng * f32(Mathf.pow(2.0, (tuneSemi + o3Semi) / 12.0));
    else hz3 = kbMul * o3Rng * f32(Mathf.pow(2.0, o3Semi / 12.0));
    let inc3: f32 = hz3 / sr;
    if (inc3 > 0.45) inc3 = 0.45; if (inc3 < 0.0) inc3 = 0.0;
    ph3 += inc3; if (ph3 >= 1.0) ph3 -= 1.0;
    const osc3: f32 = oscWave(ph3, inc3, o3Wav, 1);
    o3Last = osc3;

    // ---- noise + external input / feedback overload ---------------------------
    const noise: f32 = noiWhite == 1 ? wn : pinkState * 2.2;
    // no cable → main output normalled back to the ext input; drive scales
    // with EXTERNAL INPUT VOLUME × MAIN OUTPUT VOLUME (manual p.27/33/36)
    const extSig: f32 = inBuf[f] * 2.0 + fbSample * vol * 2.0;

    // ---- MIXER (saturates when overloaded) -------------------------------------
    let sig: f32 = osc1 * mixO1 + osc2 * mixO2 + osc3 * mixO3
                 + noise * mixNoi + extSig * mixExt * extOn;
    sig = f32(Mathf.tanh(sig * 0.9)) * 1.15;

    // ---- filter cutoff: knob + contour + key tracking + mod + pressure ----------
    const keyOct: f32 = f32(Mathf.log2(curHz / 261.63));
    let fcOct: f32 = fEnv * contAmt + kbTrk * keyOct + prsFilt * press * 3.0;
    if (filtModOn == 1) fcOct += bus * 4.0; // FILTER MODULATION switch
    let fc: f32 = fcBase * f32(Mathf.pow(2.0, fcOct));
    fc = clampf(fc, 4.0, sr * 0.45);

    // ---- 24 dB/oct transistor-ladder low-pass ------------------------------------
    let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
    if (g > 0.99) g = 0.99;
    let inp: f32 = sig - kLad * lp3;
    inp = f32(Mathf.tanh(inp));
    lp0 += g * (inp - lp0);
    lp1 += g * (lp0 - lp1);
    lp2 += g * (lp1 - lp2);
    lp3 += g * (lp2 - lp3);
    let y: f32 = lp3 * (1.0 + kLad * 0.75); // passband makeup

    // ---- loudness contour VCA -------------------------------------------------------
    y *= aEnv * velGain;

    // ---- A-440 reference tuner (Output section, p.33) ---------------------------------
    if (a440On == 1) {
      a440Phase += 440.0 / sr; if (a440Phase >= 1.0) a440Phase -= 1.0;
      y += 0.14 * Mathf.sin(TWO_PI * a440Phase);
    }

    let out: f32 = y * outGain * mainOut;
    fbSample = out; // normalled feedback tap (post main output volume+switch)
    out = f32(Mathf.tanh(out));
    outBuf[f] = out;
    outBuf[MAX_FRAMES + f] = out;
  }
}
