// =====================================================================
//  ANALOG POLY — a five-voice polyphonic analog instrument modelled
//  control-for-control on the Sequential Prophet-5 Rev 4 (User's Guide
//  Version 1.3, Feb 2021, read cover to cover; every program parameter
//  of the hardware is represented here).
//
//  OSCILLATORS (manual p.17): two VCOs per voice. Oscillator A generates
//  sawtooth and variable-width square/pulse SIMULTANEOUSLY (independent
//  on/off shape switches, polyBLEP band-limited) and can be hard-SYNCed
//  to Oscillator B. Oscillator B generates sawtooth, triangle and pulse
//  simultaneously, has a FINE knob (sharp, ~a semitone, p.18), a LO FREQ
//  switch (drops it ~7 octaves → per-voice modulation LFO, p.19) and a
//  KEYBOARD switch (off → ignores the keyboard, fixed base pitch, p.19).
//  FREQUENCY knobs step in semitones over a four-octave range (p.18).
//  PULSE WIDTH: square at centre, needle-thin at either extreme (p.18).
//  MIXER (p.21): Osc A, Osc B, white noise.
//  FILTER (p.22): resonant 24 dB low-pass, self-oscillates at max
//  RESONANCE. The Rev 4 REV switch selects two genuinely different
//  voicings AND envelope shapes (p.22/25): Rev 1/2 = SSM 2040/SSI 2140
//  character (rawer input, brighter output tap, near-linear envelope
//  segments), Rev 3 = CEM 3320 character (saturating ladder, exponential
//  envelope curves). ENVELOPE AMOUNT + off/half/full KEYBOARD tracking.
//  ENVELOPES (p.25-30): dedicated filter + amplifier ADSRs, VELOCITY
//  switches for each (Filt / Amp, p.26/30), and the RELEASE switch
//  (p.43): off → fast release on BOTH envelopes, on → knob values.
//  POLY MOD (p.34): sources Filter Envelope + Oscillator B (audio rate);
//  destinations Freq A (exponential FM), PW A, Filter cutoff.
//  LFO (p.31): saw / triangle / square shape switches, any combination;
//  saw+square positive-only, triangle bipolar (p.31); 0.022-500 Hz (p.32).
//  WHEEL-MOD (p.32): SOURCE MIX knob blends LFO ↔ pink-ish noise;
//  destinations Freq A / Freq B / PW A / PW B / Filter; INITIAL AMOUNT
//  applies continuously and the Mod wheel rides on top (p.33/38).
//  VINTAGE knob (p.36): 4 (tight Rev4) … 1 (loose Rev1) — scales fixed
//  per-voice random spread + slow drift of VCO pitch, filter cutoff,
//  envelope times and amp gain.
//  PERFORMANCE: GLIDE (p.39, per voice, fixed rate, from the last played
//  pitch), UNISON (p.40) with 1-5 voice stacking, detune 0-8 and chord
//  memory (p.41: switch to Chord while holding keys to capture; ships
//  with root+5th+octave), key priority LO / LO-retrig / LAST /
//  LAST-retrig (p.45; unison default = low-note legato), spring-loaded
//  pitch wheel with 1-12 semitone bend range (default 1, p.37), mod
//  wheel, channel AFTERTOUCH → Filter and/or LFO amount (p.38), MASTER
//  TUNE ±~1 semitone (p.42) and the A-440 reference tone (p.42).
//
//  Switch groups are bit-packed; the GUI decodes them into the
//  individual panel switches. Pure algorithm — no samples, no imports,
//  allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 5;
const HELD_MAX: i32 = 16;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ------------------------
const P_AFREQ: i32 = 0;    // 0..48 semitones (24 = centre)
const P_APW: i32 = 1;      // 0..1, square at 0.5
const P_AWAVE: i32 = 2;    // bit0 saw, bit1 square, bit2 SYNC
const P_BFREQ: i32 = 3;    // 0..48 semitones
const P_BFINE: i32 = 4;    // 0..1 → up to ~1 semitone sharp
const P_BPW: i32 = 5;
const P_BWAVE: i32 = 6;    // bit0 saw, bit1 tri, bit2 sqr, bit3 LO FREQ, bit4 KEYBOARD OFF
const P_MIXA: i32 = 7;
const P_MIXB: i32 = 8;
const P_MIXN: i32 = 9;
const P_REV: i32 = 10;     // 0 = Rev 1/2 (SSM), 1 = Rev 3 (CEM)
const P_CUT: i32 = 11;
const P_RES: i32 = 12;
const P_FENVAMT: i32 = 13;
const P_FKBD: i32 = 14;    // 0 off, 1 half, 2 full
const P_FA: i32 = 15; const P_FD: i32 = 16; const P_FS: i32 = 17; const P_FR: i32 = 18;
const P_AA: i32 = 19; const P_AD: i32 = 20; const P_AS: i32 = 21; const P_AR: i32 = 22;
const P_VELSW: i32 = 23;   // bit0 Filt, bit1 Amp
const P_LFOAMT: i32 = 24;  // INITIAL AMOUNT
const P_LFOFRQ: i32 = 25;  // 0..1 → 0.022 .. 500 Hz
const P_LFOSHP: i32 = 26;  // bit0 saw, bit1 tri, bit2 square
const P_WMIX: i32 = 27;    // 0 = LFO only .. 1 = noise only
const P_WDEST: i32 = 28;   // bit0 FreqA, bit1 FreqB, bit2 PW A, bit3 PW B, bit4 Filter
const P_PMFE: i32 = 29;    // POLY MOD filter-env amount
const P_PMOB: i32 = 30;    // POLY MOD osc B amount
const P_PMDEST: i32 = 31;  // bit0 Freq A, bit1 PW A, bit2 Filter
const P_VINT: i32 = 32;    // 4 tight .. 1 loose
const P_GLIDE: i32 = 33;
const P_VOICE: i32 = 34;   // prio*7 + unison (0 off, 1-5 stack, 6 chord); prio 0 LO,1 LOr,2 LAS,3 LAr
const P_UDET: i32 = 35;    // 0..8 unison detune
const P_RELSW: i32 = 36;   // 0 = fast release, 1 = knob release
const P_TUNE: i32 = 37;    // -1..1 ≈ ±1 semitone MASTER TUNE
const P_A440: i32 = 38;
const P_BEND: i32 = 39;    // -1..1 spring loaded
const P_BRANGE: i32 = 40;  // 1..12 semitones
const P_WHEEL: i32 = 41;   // mod wheel
const P_AT: i32 = 42;      // 0 off, 1 Filt, 2 LFO, 3 both
const P_PRESS: i32 = 43;   // channel pressure (performance)
const P_VOL: i32 = 44;

const NUM_PARAMS: i32 = 45;

// ---- helpers ----------------------------------------------------------
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

// envelope knob → time: 1 ms .. 10 s (exponential)
@inline function envTime(n: f32): f32 { return 0.001 * f32(Mathf.pow(10000.0, clampf(n, 0.0, 1.0))); }

// PULSE WIDTH knob: square at centre, needle-thin at both extremes (p.18).
// The taper is very slightly asymmetric (like a real pot), so full cw is a
// hair narrower than full ccw.
@inline function pwFromKnob(k: f32): f32 { return 0.5 - Mathf.abs(k - 0.5) * (0.88 + 0.07 * k); }

// ---- voice state --------------------------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // glide current Hz
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vGlideK: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhA:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhB:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vLp0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLp3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vDetMul: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // unison detune multiplier

// VINTAGE: fixed per-voice random character + slow drift (manual p.36)
const vRndPA: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc A pitch
const vRndPB: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc B pitch
const vRndFC: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // filter cutoff
const vRndFE: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // filter env times
const vRndAE: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // amp env times
const vRndAG: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // amp gain
const vDrift:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // slow random walk
const vDriftT: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// held-key list
const hId:    StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
const hFreq:  StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hVel:   StaticArray<f32> = new StaticArray<f32>(HELD_MAX);
const hOrder: StaticArray<i32> = new StaticArray<i32>(HELD_MAX);
let hCount: i32 = 0;
let orderCounter: i32 = 0;
let ageCounter: i32 = 1;
let lastPlayedHz: f32 = 261.63;

// chord memory (p.41) — ships with root + fifth + octave
const chordRatio: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
let chordCount: i32 = 3;
let lastUnison: i32 = -1;

let lfoPhase: f32 = 0.0;
let modNoise: f32 = 0.0;   // low-passed noise for the WHEEL-MOD source
let a440Phase: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 1.0;
    vCur[v] = 261.63; vTarget[v] = 261.63; vGlideK[v] = 1.0;
    vPhA[v] = 0.13 * f32(v); vPhB[v] = 0.31 * f32(v);
    vFEnv[v] = 0.0; vAEnv[v] = 0.0; vFStage[v] = 0; vAStage[v] = 0;
    vLp0[v] = 0.0; vLp1[v] = 0.0; vLp2[v] = 0.0; vLp3[v] = 0.0;
    vDetMul[v] = 1.0;
    vDrift[v] = 0.0; vDriftT[v] = 0.0;
  }
  // deterministic per-voice VINTAGE character
  rngState = 0x2545f491;
  for (let v = 0; v < NUM_VOICES; v++) {
    vRndPA[v] = rngf(); vRndPB[v] = rngf(); vRndFC[v] = rngf();
    vRndFE[v] = rngf(); vRndAE[v] = rngf(); vRndAG[v] = rngf();
  }
  hCount = 0; orderCounter = 0; ageCounter = 1; lastPlayedHz = 261.63;
  chordCount = 3; chordRatio[0] = 1.0; chordRatio[1] = 1.4983071; chordRatio[2] = 2.0;
  chordRatio[3] = 1.0; chordRatio[4] = 1.0;
  lastUnison = -1;
  lfoPhase = 0.0; modNoise = 0.0; a440Phase = 0.0;

  // boot state = spec.json defaults (host may render before pushing)
  params[P_AFREQ] = 24.0; params[P_APW] = 0.5; params[P_AWAVE] = 1.0;
  params[P_BFREQ] = 24.0; params[P_BFINE] = 0.12; params[P_BPW] = 0.5; params[P_BWAVE] = 1.0;
  params[P_MIXA] = 0.8; params[P_MIXB] = 0.6; params[P_MIXN] = 0.0;
  params[P_REV] = 1.0; params[P_CUT] = 0.5; params[P_RES] = 0.2;
  params[P_FENVAMT] = 0.45; params[P_FKBD] = 1.0;
  params[P_FA] = 0.05; params[P_FD] = 0.42; params[P_FS] = 0.3; params[P_FR] = 0.3;
  params[P_AA] = 0.03; params[P_AD] = 0.5; params[P_AS] = 0.8; params[P_AR] = 0.35;
  params[P_VELSW] = 0.0;
  params[P_LFOAMT] = 0.04; params[P_LFOFRQ] = 0.5; params[P_LFOSHP] = 2.0;
  params[P_WMIX] = 0.0; params[P_WDEST] = 3.0;
  params[P_PMFE] = 0.0; params[P_PMOB] = 0.0; params[P_PMDEST] = 0.0;
  params[P_VINT] = 4.0; params[P_GLIDE] = 0.0;
  params[P_VOICE] = 0.0; params[P_UDET] = 2.0; params[P_RELSW] = 1.0;
  params[P_TUNE] = 0.0; params[P_A440] = 0.0;
  params[P_BEND] = 0.0; params[P_BRANGE] = 1.0; params[P_WHEEL] = 0.0;
  params[P_AT] = 0.0; params[P_PRESS] = 0.0; params[P_VOL] = 0.75;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

// ---- glide (p.39: per voice, glides from the previously played pitch) ---
function computeGlideK(v: i32): void {
  const rate: f32 = clampf(pget(P_GLIDE), 0.0, 1.0);
  vGlideK[v] = 1.0;
  if (rate <= 0.004) { vCur[v] = vTarget[v]; return; }
  if (vCur[v] <= 0.0) vCur[v] = vTarget[v];
  if (vCur[v] == vTarget[v]) return;
  // fixed rate: constant octaves/second (bigger intervals take longer)
  const octPerSec: f32 = 60.0 * f32(Mathf.pow(0.004, rate)); // 60 → 0.24 oct/s
  const step: f32 = f32(Mathf.pow(2.0, octPerSec / sampleRate));
  vGlideK[v] = vTarget[v] > vCur[v] ? step : 1.0 / step;
}

// ---- voice trigger / release --------------------------------------------
function allocVoice(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 0) return i;
  let oldest: i32 = 0; let oa: i32 = vAge[0];
  for (let i = 1; i < NUM_VOICES; i++) if (vAge[i] < oa) { oa = vAge[i]; oldest = i; }
  return oldest;
}

function triggerVoice(slot: i32, id: i32, hz: f32, vel: f32, retrig: i32, detCents: f32): void {
  vNote[slot] = id;
  vTarget[slot] = hz > 0.0 ? hz : 1.0;
  vDetMul[slot] = f32(Mathf.pow(2.0, detCents / 1200.0));
  if (vActive[slot] == 0 || retrig == 1) {
    vCur[slot] = lastPlayedHz;
    vFStage[slot] = 1; vAStage[slot] = 1;
    if (vActive[slot] == 0) {
      vFEnv[slot] = 0.0; vAEnv[slot] = 0.0;
      vLp0[slot] = 0.0; vLp1[slot] = 0.0; vLp2[slot] = 0.0; vLp3[slot] = 0.0;
    }
    vDriftT[slot] = rngf(); // pick a fresh drift target for the VINTAGE walk
  }
  vActive[slot] = 1; vGate[slot] = 1;
  vVel[slot] = clampf(vel, 0.0, 1.0);
  computeGlideK(slot);
  vAge[slot] = ageCounter++;
}

function releaseId(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0; vFStage[i] = 4; vAStage[i] = 4;
    }
  }
}
function releaseAllVoices(): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1) { vGate[i] = 0; vFStage[i] = 4; vAStage[i] = 4; }
  }
}

// ---- unison retune with key priority (p.40/41/45) ------------------------
// detune spread pattern across the stack
function detPattern(s: i32): f32 {
  if (s == 0) return 0.0;
  if (s == 1) return -1.0;
  if (s == 2) return 1.0;
  if (s == 3) return -0.5;
  return 0.5;
}

function unisonRetune(newPress: i32): void {
  const vm: i32 = pbits(P_VOICE);
  const uni: i32 = vm % 7;
  const prio: i32 = vm / 7; // 0 LO, 1 LOr, 2 LAS, 3 LAr
  if (uni == 0) return;
  if (hCount == 0) { releaseAllVoices(); return; }
  let pick: i32 = 0;
  if (prio <= 1) { for (let i = 1; i < hCount; i++) if (hFreq[i] < hFreq[pick]) pick = i; }
  else { for (let i = 1; i < hCount; i++) if (hOrder[i] > hOrder[pick]) pick = i; }
  // the original P5 always played unison legato (p.45); retrig variants re-fire
  const retrigMode: i32 = prio & 1;
  let retrig: i32 = 0;
  if (newPress == 1) retrig = retrigMode == 1 ? 1 : (hCount > 1 ? 0 : 1);
  const baseHz: f32 = hFreq[pick];
  const vel: f32 = hVel[pick];
  const det: f32 = clampf(pget(P_UDET), 0.0, 8.0) / 8.0 * 30.0; // up to ±30 cents
  let stack: i32 = uni;
  let isChord: i32 = 0;
  if (uni == 6) { stack = chordCount; isChord = 1; }
  if (stack > NUM_VOICES) stack = NUM_VOICES;
  for (let s = 0; s < stack; s++) {
    const hz: f32 = isChord == 1 ? baseHz * chordRatio[s] : baseHz;
    triggerVoice(s, hId[pick], hz, vel, retrig, det * detPattern(s));
  }
  for (let s = stack; s < NUM_VOICES; s++) {
    if (vActive[s] == 1 && vGate[s] == 1) { vGate[s] = 0; vFStage[s] = 4; vAStage[s] = 4; }
  }
  lastPlayedHz = baseHz;
}

// ---- held-list maintenance -------------------------------------------------
function heldAdd(id: i32, hz: f32, vel: f32): void {
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) { hFreq[i] = hz; hVel[i] = vel; hOrder[i] = orderCounter++; return; }
  }
  if (hCount >= HELD_MAX) {
    for (let i = 1; i < hCount; i++) {
      hId[i - 1] = hId[i]; hFreq[i - 1] = hFreq[i]; hVel[i - 1] = hVel[i]; hOrder[i - 1] = hOrder[i];
    }
    hCount--;
  }
  hId[hCount] = id; hFreq[hCount] = hz; hVel[hCount] = vel; hOrder[hCount] = orderCounter++;
  hCount++;
}
function heldRemove(id: i32): void {
  for (let i = 0; i < hCount; i++) {
    if (hId[i] == id) {
      for (let j = i + 1; j < hCount; j++) {
        hId[j - 1] = hId[j]; hFreq[j - 1] = hFreq[j]; hVel[j - 1] = hVel[j]; hOrder[j - 1] = hOrder[j];
      }
      hCount--;
      return;
    }
  }
}

// ---- note events -------------------------------------------------------------
export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  heldAdd(id, hz, vel);
  const uni: i32 = pbits(P_VOICE) % 7;
  if (uni > 0) { unisonRetune(1); return; }
  // poly: last-note priority; repeated same key retriggers the same voice (p.45)
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 1 && vNote[i] == id) { slot = i; break; }
  if (slot < 0) slot = allocVoice();
  triggerVoice(slot, id, hz, vel, 1, 0.0);
  lastPlayedHz = hz;
}

export function noteOff(id: i32): void {
  if (id < 0) return;
  heldRemove(id);
  const uni: i32 = pbits(P_VOICE) % 7;
  if (uni > 0) {
    if (hCount == 0) releaseAllVoices(); else unisonRetune(0);
    return;
  }
  releaseId(id);
}

// =====================================================================
//  PROCESS
// =====================================================================
export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- voice-mode transitions + chord memory capture (p.41) -----------
  const vmNow: i32 = pbits(P_VOICE);
  const uniNow: i32 = vmNow % 7;
  if (uniNow == 6 && lastUnison != 6) {
    // capture the held chord; lowest note is the root. With <2 keys held
    // the previous (or shipped) chord is kept.
    if (hCount >= 2) {
      let root: f32 = hFreq[0];
      for (let i = 1; i < hCount; i++) if (hFreq[i] < root) root = hFreq[i];
      chordCount = 0;
      for (let i = 0; i < hCount && chordCount < NUM_VOICES; i++) {
        chordRatio[chordCount] = hFreq[i] / root;
        chordCount++;
      }
    }
  }
  if (uniNow != lastUnison && lastUnison >= 0) {
    if (uniNow == 0) {
      releaseAllVoices();
      for (let i = 0; i < hCount; i++) {
        const s: i32 = allocVoice();
        triggerVoice(s, hId[i], hFreq[i], hVel[i], 1, 0.0);
      }
    } else if (hCount > 0) {
      unisonRetune(0);
    }
  }
  lastUnison = uniNow;

  // ---- per-block parameter mapping --------------------------------------
  const aWave: i32 = pbits(P_AWAVE);
  const aSawOn: f32 = f32(aWave & 1);
  const aSqrOn: f32 = f32((aWave >> 1) & 1);
  const syncOn: i32 = (aWave >> 2) & 1;
  const bWave: i32 = pbits(P_BWAVE);
  const bSawOn: f32 = f32(bWave & 1);
  const bTriOn: f32 = f32((bWave >> 1) & 1);
  const bSqrOn: f32 = f32((bWave >> 2) & 1);
  const bLoFreq: i32 = (bWave >> 3) & 1;
  const bKbdOff: i32 = (bWave >> 4) & 1;

  const bendSemi: f32 = clampf(pget(P_BEND), -1.0, 1.0) * clampf(pget(P_BRANGE), 1.0, 12.0);
  const tuneSemi: f32 = clampf(pget(P_TUNE), -1.0, 1.0); // MASTER TUNE ±~1 semitone
  const aSemi: f32 = f32(pbits(P_AFREQ) - 24);
  const bSemi: f32 = f32(pbits(P_BFREQ) - 24) + clampf(pget(P_BFINE), 0.0, 1.0); // FINE tunes sharp (p.18)
  const commonSemi: f32 = tuneSemi + bendSemi;
  const aMulBase: f32 = f32(Mathf.pow(2.0, (aSemi + commonSemi) / 12.0));
  const bMulBase: f32 = f32(Mathf.pow(2.0, (bSemi + commonSemi) / 12.0));
  const pwkA: f32 = clampf(pget(P_APW), 0.0, 1.0);
  const pwkB: f32 = clampf(pget(P_BPW), 0.0, 1.0);

  const mixA: f32 = clampf(pget(P_MIXA), 0.0, 1.0);
  const mixB: f32 = clampf(pget(P_MIXB), 0.0, 1.0);
  const mixN: f32 = clampf(pget(P_MIXN), 0.0, 1.0);

  const rev3: i32 = pbits(P_REV); // 1 = CEM (Rev 3), 0 = SSM (Rev 1/2)
  const cutN: f32 = clampf(pget(P_CUT), 0.0, 1.0);
  const fcBase: f32 = 20.0 * f32(Mathf.pow(2.0, cutN * 10.0)); // 20 Hz .. ~20.4 kHz
  const resN: f32 = clampf(pget(P_RES), 0.0, 1.0);
  const kRes: f32 = resN * 4.2; // self-oscillates near max (p.24)
  const fEnvAmt: f32 = clampf(pget(P_FENVAMT), 0.0, 1.0);
  const fkbd: i32 = pbits(P_FKBD);
  const kbTrk: f32 = fkbd == 0 ? 0.0 : (fkbd == 1 ? 0.5 : 1.0);

  const velSw: i32 = pbits(P_VELSW);
  const velFilt: i32 = velSw & 1;
  const velAmp: i32 = (velSw >> 1) & 1;

  // RELEASE switch (p.43): off → fast release on both envelopes
  const relSw: i32 = pbits(P_RELSW);
  const fRelT: f32 = relSw == 1 ? envTime(pget(P_FR)) : 0.008;
  const aRelT: f32 = relSw == 1 ? envTime(pget(P_AR)) : 0.008;
  const fAtkT: f32 = envTime(pget(P_FA));
  const fDecT: f32 = envTime(pget(P_FD));
  const fSus: f32 = clampf(pget(P_FS), 0.0, 1.0);
  const aAtkT: f32 = envTime(pget(P_AA));
  const aDecT: f32 = envTime(pget(P_AD));
  const aSus: f32 = clampf(pget(P_AS), 0.0, 1.0);

  const lfoShp: i32 = pbits(P_LFOSHP);
  const lfoHz: f32 = 0.022 * f32(Mathf.pow(22727.0, clampf(pget(P_LFOFRQ), 0.0, 1.0))); // .022..500 Hz (p.32)
  const lfoInc: f32 = lfoHz / sr;
  const wMix: f32 = clampf(pget(P_WMIX), 0.0, 1.0);
  const wDest: i32 = pbits(P_WDEST);
  const press: f32 = clampf(pget(P_PRESS), 0.0, 1.0);
  const atMode: i32 = pbits(P_AT);
  // INITIAL AMOUNT applies continuously; the wheel (and LFO-aftertouch) ride on top (p.32/38)
  let wAmt: f32 = clampf(pget(P_LFOAMT), 0.0, 1.0) + clampf(pget(P_WHEEL), 0.0, 1.0);
  if ((atMode & 2) != 0) wAmt += press;
  wAmt = clampf(wAmt, 0.0, 1.2);
  const wDepth: f32 = wAmt * wAmt; // gentle taper: vibrato depths stay musical
  const atFiltOct: f32 = (atMode & 1) != 0 ? press * 2.5 : 0.0;

  const pmFE: f32 = clampf(pget(P_PMFE), 0.0, 1.0);
  const pmOB: f32 = clampf(pget(P_PMOB), 0.0, 1.0);
  const pmDest: i32 = pbits(P_PMDEST);

  // VINTAGE spread: 0 at 4 (tight) → 1 at 1 (loose)
  const spread: f32 = clampf((4.0 - clampf(pget(P_VINT), 1.0, 4.0)) / 3.0, 0.0, 1.0);

  const a440On: i32 = pbits(P_A440);
  const vol: f32 = clampf(pget(P_VOL), 0.0, 1.0);
  const outGain: f32 = vol * vol * 2.4;
  const modNoiseK: f32 = clampf(TWO_PI * 180.0 / sr, 0.0, 0.9);

  const uniAct: i32 = uniNow > 0 ? 1 : 0;
  const voiceScale: f32 = uniAct == 1 ? 0.42 : 0.5;

  for (let f = 0; f < n; f++) {
    // ---- global LFO (p.31: saw & square positive-only, triangle bipolar) --
    lfoPhase += lfoInc; if (lfoPhase >= 1.0) lfoPhase -= 1.0;
    let lfoVal: f32 = 0.0;
    let lfoCnt: f32 = 0.0;
    if ((lfoShp & 1) != 0) { lfoVal += 1.0 - lfoPhase; lfoCnt += 1.0; }                     // saw (falling, positive)
    if ((lfoShp & 2) != 0) { lfoVal += lfoPhase < 0.5 ? lfoPhase * 4.0 - 1.0 : 3.0 - lfoPhase * 4.0; lfoCnt += 1.0; } // tri (bipolar)
    if ((lfoShp & 4) != 0) { lfoVal += lfoPhase < 0.5 ? 1.0 : 0.0; lfoCnt += 1.0; }          // square (positive)
    if (lfoCnt > 1.0) lfoVal /= lfoCnt;

    const wn: f32 = rngf();
    modNoise += (wn - modNoise) * modNoiseK; // pink-ish mod noise
    const modSig: f32 = (lfoVal * (1.0 - wMix) + modNoise * 3.0 * wMix) * wDepth;

    const wFreqA: f32 = (wDest & 1) != 0 ? modSig * 10.0 : 0.0;  // semitones
    const wFreqB: f32 = (wDest & 2) != 0 ? modSig * 10.0 : 0.0;
    const wPWA: f32 = (wDest & 4) != 0 ? modSig * 0.4 : 0.0;
    const wPWB: f32 = (wDest & 8) != 0 ? modSig * 0.4 : 0.0;
    const wFilt: f32 = (wDest & 16) != 0 ? modSig * 5.0 : 0.0;   // octaves

    const wMulA: f32 = wFreqA != 0.0 ? f32(Mathf.pow(2.0, wFreqA / 12.0)) : 1.0;
    const wMulB: f32 = wFreqB != 0.0 ? f32(Mathf.pow(2.0, wFreqB / 12.0)) : 1.0;

    let sum: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- glide ---------------------------------------------------------
      let cur: f32 = vCur[v];
      const tgt: f32 = vTarget[v];
      if (cur != tgt) {
        const gk: f32 = vGlideK[v];
        if (gk == 1.0) cur = tgt;
        else {
          cur *= gk;
          if ((gk > 1.0 && cur >= tgt) || (gk < 1.0 && cur <= tgt)) cur = tgt;
        }
        vCur[v] = cur;
      }

      // ---- VINTAGE drift walk ---------------------------------------------
      let dr: f32 = vDrift[v];
      dr += (vDriftT[v] - dr) * 0.000015;
      vDrift[v] = dr;

      // per-voice envelope time scaling from VINTAGE
      const fTimeMul: f32 = f32(Mathf.pow(2.0, spread * vRndFE[v] * 0.9));
      const aTimeMul: f32 = f32(Mathf.pow(2.0, spread * vRndAE[v] * 0.9));

      // ---- envelopes -------------------------------------------------------
      // Rev 1/2 (SSM): near-linear decay/release segments (manual p.25);
      // Rev 3 (CEM): exponential-approach curves.
      let fenv: f32 = vFEnv[v];
      const fst: i32 = vFStage[v];
      if (fst == 1) {
        fenv += 1.0 / (fAtkT * fTimeMul * sr);
        if (fenv >= 1.0) { fenv = 1.0; vFStage[v] = 2; }
      } else if (fst == 2) {
        if (rev3 == 1) fenv += (fSus - fenv) * (1.0 - f32(Mathf.exp(-4.0 / (fDecT * fTimeMul * sr))));
        else { fenv -= 1.2 / (fDecT * fTimeMul * sr); if (fenv < fSus) fenv = fSus; }
      } else if (fst == 4) {
        if (rev3 == 1) { fenv += (0.0 - fenv) * (1.0 - f32(Mathf.exp(-4.0 / (fRelT * fTimeMul * sr)))); if (fenv <= 0.0004) fenv = 0.0; }
        else { fenv -= 1.2 / (fRelT * fTimeMul * sr); if (fenv < 0.0) fenv = 0.0; }
      }
      vFEnv[v] = fenv;

      let aenv: f32 = vAEnv[v];
      const ast: i32 = vAStage[v];
      if (ast == 1) {
        aenv += 1.0 / (aAtkT * aTimeMul * sr);
        if (aenv >= 1.0) { aenv = 1.0; vAStage[v] = 2; }
      } else if (ast == 2) {
        if (rev3 == 1) aenv += (aSus - aenv) * (1.0 - f32(Mathf.exp(-4.0 / (aDecT * aTimeMul * sr))));
        else { aenv -= 1.2 / (aDecT * aTimeMul * sr); if (aenv < aSus) aenv = aSus; }
      } else if (ast == 4) {
        if (rev3 == 1) { aenv += (0.0 - aenv) * (1.0 - f32(Mathf.exp(-4.0 / (aRelT * aTimeMul * sr)))); if (aenv <= 0.0004) aenv = 0.0; }
        else { aenv -= 1.2 / (aRelT * aTimeMul * sr); if (aenv < 0.0) aenv = 0.0; }
      }
      vAEnv[v] = aenv;
      if (vGate[v] == 0 && aenv <= 0.0005) { vActive[v] = 0; continue; }

      // ---- VINTAGE pitch/cutoff offsets --------------------------------------
      const vintCentsA: f32 = spread * (vRndPA[v] * 16.0 + dr * 10.0);
      const vintCentsB: f32 = spread * (vRndPB[v] * 16.0 + dr * 8.0);
      const vintMulA: f32 = 1.0 + vintCentsA * 0.000577;
      const vintMulB: f32 = 1.0 + vintCentsB * 0.000577;
      const vintFcOct: f32 = spread * (vRndFC[v] * 0.55 + dr * 0.2);
      const vintGain: f32 = 1.0 + spread * vRndAG[v] * 0.12;

      // ---- oscillator B (sync master; LO FREQ / KEYBOARD switches, p.19) -----
      let bHz: f32;
      if (bKbdOff == 1) bHz = 261.63 * bMulBase * vintMulB;
      else bHz = cur * vDetMul[v] * bMulBase * vintMulB;
      bHz *= wMulB;
      if (bLoFreq == 1) bHz *= 0.0078125; // LO FREQ: ~7 octaves down
      let incB: f32 = bHz / sr;
      if (incB > 0.45) incB = 0.45; if (incB < 0.0) incB = 0.0;
      let pB: f32 = vPhB[v]; pB += incB;
      let wrappedB: i32 = 0;
      if (pB >= 1.0) { pB -= 1.0; wrappedB = 1; }
      vPhB[v] = pB;
      let pwB: f32 = pwFromKnob(pwkB) + wPWB;
      pwB = clampf(pwB, 0.04, 0.96);
      let oscB: f32 = 0.0;
      if (bSawOn != 0.0) { let s: f32 = 2.0 * pB - 1.0; s -= polyBlep(pB, incB); oscB += s; }
      if (bTriOn != 0.0) { oscB += pB < 0.5 ? 4.0 * pB - 1.0 : 3.0 - 4.0 * pB; }
      if (bSqrOn != 0.0) {
        let sq: f32 = pB < pwB ? 1.0 : -1.0;
        sq += polyBlep(pB, incB);
        let p2: f32 = pB - pwB; if (p2 < 0.0) p2 += 1.0;
        sq -= polyBlep(p2, incB);
        oscB += sq;
      }

      // ---- POLY MOD source (p.34): filter env + audio-rate osc B -------------
      const pmSrc: f32 = pmFE * fenv + pmOB * oscB;

      // ---- oscillator A (slave; saw + pulse simultaneously, p.17) ------------
      let aMul: f32 = aMulBase * vintMulA * wMulA;
      if ((pmDest & 1) != 0 && pmSrc != 0.0) aMul *= f32(Mathf.pow(2.0, pmSrc * 5.0)); // FREQ A: exp FM
      let incA: f32 = cur * vDetMul[v] * aMul / sr;
      if (incA > 0.45) incA = 0.45; if (incA < 0.0) incA = 0.0;
      let pA: f32 = vPhA[v]; pA += incA;
      if (pA >= 1.0) pA -= 1.0;
      if (syncOn == 1 && wrappedB == 1) pA = pB * (incB > 0.0 ? incA / incB : 0.0); // hard sync (p.18)
      vPhA[v] = pA;
      let pwA: f32 = pwFromKnob(pwkA) + wPWA;
      if ((pmDest & 2) != 0) pwA += pmSrc * 0.5; // PW A
      pwA = clampf(pwA, 0.04, 0.96);
      let oscA: f32 = 0.0;
      if (aSawOn != 0.0) { let s: f32 = 2.0 * pA - 1.0; s -= polyBlep(pA, incA); oscA += s; }
      if (aSqrOn != 0.0) {
        let sq: f32 = pA < pwA ? 1.0 : -1.0;
        sq += polyBlep(pA, incA);
        let p2: f32 = pA - pwA; if (p2 < 0.0) p2 += 1.0;
        sq -= polyBlep(p2, incA);
        oscA += sq;
      }

      // ---- mixer (p.21) --------------------------------------------------------
      const noi: f32 = rngf();
      let sig: f32 = oscA * mixA + oscB * mixB + noi * mixN;
      sig *= 0.5;

      // ---- filter cutoff assembly ------------------------------------------------
      const keyOct: f32 = f32(Mathf.log2(cur / 261.63));
      const fVel: f32 = velFilt == 1 ? vVel[v] : 1.0;
      let fcOct: f32 = fEnvAmt * fVel * fenv * 7.0 + kbTrk * keyOct + wFilt + atFiltOct + vintFcOct;
      if ((pmDest & 4) != 0) fcOct += pmSrc * 6.0; // POLY MOD → filter
      let fc: f32 = fcBase * f32(Mathf.pow(2.0, fcOct));
      fc = clampf(fc, 4.0, sr * 0.45);
      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let st0: f32 = vLp0[v]; let st1: f32 = vLp1[v]; let st2: f32 = vLp2[v]; let st3: f32 = vLp3[v];
      let y: f32;
      if (rev3 == 1) {
        // Rev 3 (CEM 3320): saturating 4-pole ladder, classic warm clip
        let inp: f32 = sig - kRes * st3;
        inp = f32(Mathf.tanh(inp));
        st0 += g * (inp - st0);
        st1 += g * (st0 - st1);
        st2 += g * (st1 - st2);
        st3 += g * (st2 - st3);
        y = st3 * (1.0 + kRes * 0.75); // passband makeup
      } else {
        // Rev 1/2 (SSM 2040 / SSI 2140): cleaner input stage, brighter
        // output tap (blend of poles 3 and 4) and hotter resonance makeup
        let inp: f32 = sig - kRes * 0.96 * st3;
        inp = inp / (1.0 + 0.28 * Mathf.abs(inp)); // soft, rawer limiting
        st0 += g * (inp - st0);
        st1 += g * (st0 - st1);
        st2 += g * (st1 - st2);
        st3 += g * (st2 - st3);
        y = (st2 * 0.6 + st3 * 0.4) * (1.0 + kRes * 0.9); // gentler effective slope
      }
      vLp0[v] = st0; vLp1[v] = st1; vLp2[v] = st2; vLp3[v] = st3;

      // ---- VCA -----------------------------------------------------------------------
      const aVel: f32 = velAmp == 1 ? (0.25 + 0.75 * vVel[v] * vVel[v]) : 1.0;
      sum += y * aenv * aVel * vintGain;
    }

    let out: f32 = sum * voiceScale;

    // ---- A-440 reference tone (p.42) ---------------------------------------------
    if (a440On == 1) {
      a440Phase += 440.0 / sr; if (a440Phase >= 1.0) a440Phase -= 1.0;
      out += 0.12 * Mathf.sin(TWO_PI * a440Phase);
    }

    out = f32(Mathf.tanh(out * outGain));
    outBuf[f] = out;
    outBuf[MAX_FRAMES + f] = out;
  }
}
