// =====================================================================
//  ADDITIVE — a polyphonic additive (Fourier) synthesizer modelled on
//  the Kawai K5 (Owner's Manual, read cover to cover).
//
//  Per voice: TWO independent additive SOURCES (S1/S2), each summing 64
//  sinusoidal harmonics — echoing the K5's dual DHG that spreads 126
//  harmonics over two halves.  The harmonic spectrum is sculpted by
//  macro controls instead of 126 sliders:
//    * PROFILE  seeds the harmonic bank (saw 1/n, square odd-1/n, pulse,
//               triangle, organ octaves, resonant);
//    * TILT     bipolar spectral slope (brightness);
//    * ODD/EVEN partial balance;
//    * DENSITY  how many partials sound;
//    * FORMANT  DFT-style emphasis (peak harmonic, width, amount).
//  The K5's four six-stage DHG amplitude envelopes are modelled as three
//  HARMONIC BAND envelopes (low/mid/high attack+decay) so the spectrum
//  morphs over the life of the note — the signature evolving K5 timbre.
//  Each source then passes a DDF (spectral low-pass over the harmonic
//  bank: cutoff, resonance, own attack/decay envelope, keyboard scaling)
//  and a DDA (ADSR amplitude contour).  Global: a DFG pitch envelope, a
//  shared LFO (tri/saw/ramp/square/random) routable to pitch, spectrum,
//  amplitude and formant with key sync; S1/S2 balance, S2 coarse+detune
//  (Twin-mode beating), master tune, portamento, pitch-bend wheel+range,
//  mod-wheel vibrato, aftertouch pressure and volume.
//
//  Harmonic amplitudes are recomputed at CONTROL RATE (every 32 samples)
//  and summed per-sample by a complex-recurrence sine bank, so 128
//  partials over 6 voices stay real-time.  No samples, no host imports,
//  allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 6;
const NUM_HARM: i32 = 64;
const CTRL: i32 = 32;          // control-rate block (samples)

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
// source block: base = src*22
const PB_PROFILE: i32 = 0;
const PB_TILT: i32 = 1;
const PB_ODDEVEN: i32 = 2;
const PB_DENSITY: i32 = 3;
const PB_FFREQ: i32 = 4;
const PB_FWID: i32 = 5;
const PB_FAMT: i32 = 6;
const PB_LOA: i32 = 7;
const PB_LOD: i32 = 8;
const PB_MIDA: i32 = 9;
const PB_MIDD: i32 = 10;
const PB_HIA: i32 = 11;
const PB_HID: i32 = 12;
const PB_DDFCUT: i32 = 13;
const PB_DDFRES: i32 = 14;
const PB_DDFENV: i32 = 15;
const PB_DDFA: i32 = 16;
const PB_DDFD: i32 = 17;
const PB_DDAA: i32 = 18;
const PB_DDAD: i32 = 19;
const PB_DDAS: i32 = 20;
const PB_DDAR: i32 = 21;
const SRC_STRIDE: i32 = 22;

const P_FLAGS: i32 = 44;   // bit0 Full(1)/Twin(0), bit1 LFO keysync, bit2 DDF keytrack on, bit3 legato
const P_BAL: i32 = 45;
const P_S2COARSE: i32 = 46;
const P_S2DET: i32 = 47;
const P_MTUNE: i32 = 48;
const P_PORTA: i32 = 49;
const P_PENV: i32 = 50;
const P_PENVR: i32 = 51;
const P_LFORATE: i32 = 52;
const P_LFOSHP: i32 = 53;
const P_LFODEP: i32 = 54;
const P_LFODST: i32 = 55;   // bit0 pitch, bit1 spectrum, bit2 amp, bit3 formant
const P_DDFKT: i32 = 56;
const P_BENDR: i32 = 57;
const P_PWHEEL: i32 = 58;
const P_MODWHL: i32 = 59;
const P_AT: i32 = 60;
const P_VOL: i32 = 61;

// ---- helpers ---------------------------------------------------------
@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function pget(i: i32): f32 { return params[i]; }
@inline function pbits(i: i32): i32 { return i32(params[i] + (params[i] < 0.0 ? -0.5 : 0.5)); }
@inline function envTime(n: f32): f32 { return 0.001 * Mathf.pow(10000.0, clampf(n, 0.0, 1.0)); } // 1ms..10s

let rngState: i32 = 0x2545f491;
@inline function rngf(): f32 {
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return f32(rngState & 0x7fffffff) / f32(0x3fffffff) - 1.0;
}

// band index for harmonic number h (1-based): low<=8, mid<=24, else high
@inline function bandOf(h: i32): i32 { return h <= 8 ? 0 : (h <= 24 ? 1 : 2); }

// ---- voice state -----------------------------------------------------
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vTarget: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // target Hz (S1)
const vCur:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // glide Hz
const vGlideK: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh2:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
// per-source DDA env + stage
const vDda:    StaticArray<f32> = new StaticArray<f32>(2 * NUM_VOICES);
const vDdaSt:  StaticArray<i32> = new StaticArray<i32>(2 * NUM_VOICES);
// per-source DDF env + stage (AD)
const vDdf:    StaticArray<f32> = new StaticArray<f32>(2 * NUM_VOICES);
const vDdfSt:  StaticArray<i32> = new StaticArray<i32>(2 * NUM_VOICES);
// band env value + stage: index (src*3 + band)*NUM_VOICES + v
const vBand:   StaticArray<f32> = new StaticArray<f32>(2 * 3 * NUM_VOICES);
const vBandSt: StaticArray<i32> = new StaticArray<i32>(2 * 3 * NUM_VOICES);
// per-voice pitch env (DFG)
const vPEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
// per-voice, per-source effective harmonic amplitudes (control-rate)
const effA1:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES * NUM_HARM);
const effA2:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES * NUM_HARM);

// global base spectra (control-rate, shared)
const baseA1:  StaticArray<f32> = new StaticArray<f32>(NUM_HARM);
const baseA2:  StaticArray<f32> = new StaticArray<f32>(NUM_HARM);

let ageCounter: i32 = 0;
let lastPlayedHz: f32 = 261.63;

// held-key list (mono/last-note not required; poly) — kept for legato/porta ref only
let lfoPhase: f32 = 0.0;
let lfoSH: f32 = 0.0;
let lfoVal: f32 = 0.0;   // bipolar -1..1
let lfoPos: f32 = 0.0;   // 0..1 (for tremolo)

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAge[v] = 0; vVel[v] = 0.0;
    vTarget[v] = 261.63; vCur[v] = 261.63; vGlideK[v] = 1.0;
    vPh1[v] = 0.0; vPh2[v] = 0.0; vPEnv[v] = 0.0;
    for (let s = 0; s < 2; s++) { vDda[s * NUM_VOICES + v] = 0.0; vDdaSt[s * NUM_VOICES + v] = 0;
      vDdf[s * NUM_VOICES + v] = 0.0; vDdfSt[s * NUM_VOICES + v] = 0; }
    for (let b = 0; b < 6; b++) { vBand[b * NUM_VOICES + v] = 0.0; vBandSt[b * NUM_VOICES + v] = 0; }
  }
  for (let i = 0; i < NUM_VOICES * NUM_HARM; i++) { effA1[i] = 0.0; effA2[i] = 0.0; }
  ageCounter = 0; lastPlayedHz = 261.63;
  lfoPhase = 0.0; lfoSH = 0.0; lfoVal = 0.0; lfoPos = 0.0;

  // musically sensible boot state (matches spec.json defaults)
  params[0] = 0.0; params[1] = 0.1; params[2] = 0.0; params[3] = 0.7;
  params[4] = 0.3; params[5] = 0.4; params[6] = 0.35;
  params[7] = 0.02; params[8] = 0.6; params[9] = 0.05; params[10] = 0.4; params[11] = 0.08; params[12] = 0.25;
  params[13] = 0.7; params[14] = 0.2; params[15] = 0.3; params[16] = 0.05; params[17] = 0.5;
  params[18] = 0.02; params[19] = 0.5; params[20] = 0.7; params[21] = 0.4;
  params[22] = 1.0; params[23] = -0.1; params[24] = 0.4; params[25] = 0.5;
  params[26] = 0.5; params[27] = 0.5; params[28] = 0.25;
  params[29] = 0.03; params[30] = 0.7; params[31] = 0.1; params[32] = 0.5; params[33] = 0.15; params[34] = 0.3;
  params[35] = 0.6; params[36] = 0.25; params[37] = 0.25; params[38] = 0.08; params[39] = 0.5;
  params[40] = 0.04; params[41] = 0.6; params[42] = 0.65; params[43] = 0.45;
  params[P_FLAGS] = 5.0; params[P_BAL] = 0.5; params[P_S2COARSE] = 0.0; params[P_S2DET] = 0.08;
  params[P_MTUNE] = 0.0; params[P_PORTA] = 0.0; params[P_PENV] = 0.0; params[P_PENVR] = 0.4;
  params[P_LFORATE] = 0.35; params[P_LFOSHP] = 0.0; params[P_LFODEP] = 0.1; params[P_LFODST] = 1.0;
  params[P_DDFKT] = 0.4; params[P_BENDR] = 2.0; params[P_PWHEEL] = 0.0; params[P_MODWHL] = 0.0;
  params[P_AT] = 0.0; params[P_VOL] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 64; }

// ---- glide -----------------------------------------------------------
function computeGlideK(v: i32): void {
  const porta: f32 = clampf(pget(P_PORTA), 0.0, 1.0);
  vGlideK[v] = 1.0;
  if (porta <= 0.0) { vCur[v] = vTarget[v]; return; }
  if (vCur[v] <= 0.0) vCur[v] = vTarget[v];
  if (vCur[v] == vTarget[v]) return;
  const t: f32 = 0.005 + porta * porta * 3.0; // 5 ms .. 3 s
  const nSmp: f32 = t * sampleRate;
  const ratio: f32 = vTarget[v] / vCur[v];
  vGlideK[v] = Mathf.pow(ratio, 1.0 / nSmp);
}

function allocVoice(): i32 {
  for (let i = 0; i < NUM_VOICES; i++) if (vActive[i] == 0) return i;
  let oldest: i32 = 0; let oa: i32 = vAge[0];
  for (let i = 1; i < NUM_VOICES; i++) if (vAge[i] < oa) { oa = vAge[i]; oldest = i; }
  return oldest;
}

export function noteOn(id: i32, hz: f32, vel: f32): void {
  if (hz <= 0.0) return;
  const slot: i32 = allocVoice();
  vNote[slot] = id;
  vTarget[slot] = hz;
  vCur[slot] = lastPlayedHz;
  computeGlideK(slot);
  vActive[slot] = 1; vGate[slot] = 1;
  vVel[slot] = clampf(vel, 0.0, 1.0);
  vAge[slot] = ageCounter++;
  vPh1[slot] = 0.0; vPh2[slot] = 0.37;
  vPEnv[slot] = 1.0;
  for (let s = 0; s < 2; s++) {
    vDda[s * NUM_VOICES + slot] = 0.0; vDdaSt[s * NUM_VOICES + slot] = 1;
    vDdf[s * NUM_VOICES + slot] = 0.0; vDdfSt[s * NUM_VOICES + slot] = 1;
  }
  for (let b = 0; b < 6; b++) { vBand[b * NUM_VOICES + slot] = 0.0; vBandSt[b * NUM_VOICES + slot] = 0; }
  lastPlayedHz = hz;
}

export function noteOff(id: i32): void {
  if (id < 0) return;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vDdaSt[0 * NUM_VOICES + i] = 4; vDdaSt[1 * NUM_VOICES + i] = 4;
    }
  }
}

// ---- LFO -------------------------------------------------------------
function lfoShapeVal(shp: i32, ph: f32): f32 {
  if (shp == 0) return ph < 0.5 ? ph * 4.0 - 1.0 : 3.0 - ph * 4.0; // triangle
  if (shp == 1) return 1.0 - ph * 2.0;   // saw down
  if (shp == 2) return ph * 2.0 - 1.0;   // ramp up
  if (shp == 3) return ph < 0.5 ? 1.0 : -1.0; // square
  return lfoSH;                          // random S&H
}

// ---- build the global base spectra (control rate) --------------------
function buildBase(src: i32, dst: StaticArray<f32>, extraTilt: f32, extraForm: f32): void {
  const base: i32 = src * SRC_STRIDE;
  const prof: i32 = pbits(base + PB_PROFILE);
  let tilt: f32 = clampf(pget(base + PB_TILT) + extraTilt, -1.5, 1.5);
  const oe: f32 = clampf(pget(base + PB_ODDEVEN), -1.0, 1.0);
  const dens: f32 = clampf(pget(base + PB_DENSITY), 0.0, 1.0);
  const ffreq: f32 = clampf(pget(base + PB_FFREQ) + extraForm, 0.0, 1.0);
  const fwid: f32 = clampf(pget(base + PB_FWID), 0.0, 1.0);
  const famt: f32 = clampf(pget(base + PB_FAMT), 0.0, 1.0);

  const activeN: f32 = 2.0 + dens * f32(NUM_HARM - 2);
  const peak: f32 = 1.0 + ffreq * f32(NUM_HARM - 1);
  const sigma: f32 = 1.0 + fwid * 22.0;
  const twoSig2: f32 = 2.0 * sigma * sigma;

  let sum: f32 = 0.0;
  for (let i = 0; i < NUM_HARM; i++) {
    const h: i32 = i + 1;
    const hf: f32 = f32(h);
    let a: f32 = 0.0;
    // ---- seed by profile ----
    if (prof == 0) {                 // saw 1/n
      a = 1.0 / hf;
    } else if (prof == 1) {          // square: odd 1/n
      a = (h & 1) == 1 ? 1.0 / hf : 0.0;
    } else if (prof == 2) {          // pulse / buzzy: 1/sqrt(n)
      a = 1.0 / Mathf.sqrt(hf);
    } else if (prof == 3) {          // triangle: odd 1/n^2
      a = (h & 1) == 1 ? 1.0 / (hf * hf) : 0.0;
    } else if (prof == 4) {          // organ: octaves emphasised
      const l2: f32 = Mathf.log2(hf);
      const isPow2: bool = (h & (h - 1)) == 0;
      a = isPow2 ? 1.0 / (1.0 + l2) : 0.08 / hf;
    } else {                         // resonant: 1/n with an inherent mid peak
      a = (1.0 / hf) * (1.0 + 3.0 * Mathf.exp(-((hf - 6.0) * (hf - 6.0)) / 10.0));
    }
    // ---- spectral tilt (brightness slope) ----
    a *= Mathf.pow(hf, tilt * 1.5);
    // ---- odd/even balance ----
    if ((h & 1) == 1) a *= clampf(1.0 + oe, 0.0, 2.0);
    else              a *= clampf(1.0 - oe, 0.0, 2.0);
    // ---- density taper ----
    const taper: f32 = clampf(activeN - hf + 1.0, 0.0, 1.0);
    a *= taper;
    // ---- formant emphasis (DFT) ----
    if (famt > 0.0) {
      const d: f32 = hf - peak;
      a *= 1.0 + famt * 4.0 * Mathf.exp(-(d * d) / twoSig2);
    }
    dst[i] = a;
    sum += a;
  }
  // normalise so overall energy is bounded regardless of macro settings
  const norm: f32 = 0.9 / (sum > 0.0001 ? sum : 0.0001);
  for (let i = 0; i < NUM_HARM; i++) dst[i] *= norm;
}

// spectral low-pass weight for the DDF (harmonic-domain)
@inline function ddfWeight(h: i32, cutN: f32, reso: f32): f32 {
  const hf: f32 = f32(h);
  let w: f32 = hf <= cutN ? 1.0 : Mathf.pow(cutN / hf, 3.5);
  if (reso > 0.0) {
    const d: f32 = hf - cutN;
    w += reso * 1.6 * Mathf.exp(-(d * d) / 6.0);
  }
  return w;
}

// control-rate update for one active voice
function updateVoice(v: i32, dt: f32): void {
  const kt: i32 = (pbits(P_FLAGS) >> 2) & 1;
  const ktAmt: f32 = clampf(pget(P_DDFKT), 0.0, 1.0);
  const at: f32 = clampf(pget(P_AT), 0.0, 1.0);
  const f0: f32 = vCur[v];
  // keyboard-scaling factor for DDF cutoff (relative to a 261 Hz reference)
  let ktShift: f32 = 0.0;
  if (kt == 1) ktShift = ktAmt * (Mathf.log2(f0 / 261.63)) * 12.0; // harmonics of shift

  for (let s = 0; s < 2; s++) {
    const base: i32 = s * SRC_STRIDE;
    const si: i32 = s * NUM_VOICES + v;
    // --- DDA (ADSR) ---
    let de: f32 = vDda[si]; let dst: i32 = vDdaSt[si];
    const aT: f32 = envTime(pget(base + PB_DDAA));
    const dT: f32 = envTime(pget(base + PB_DDAD));
    const sL: f32 = clampf(pget(base + PB_DDAS), 0.0, 1.0);
    const rT: f32 = envTime(pget(base + PB_DDAR));
    if (dst == 1) { de += dt / aT; if (de >= 1.0) { de = 1.0; dst = 2; } }
    else if (dst == 2) { de += (sL - de) * (1.0 - Mathf.exp(-dt * 5.0 / dT)); if (Mathf.abs(de - sL) < 0.001) dst = 3; }
    else if (dst == 3) { de = sL; }
    else if (dst == 4) { de += (0.0 - de) * (1.0 - Mathf.exp(-dt * 5.0 / rT)); }
    vDda[si] = de; vDdaSt[si] = dst;
    // --- DDF envelope (AD) ---
    let fe: f32 = vDdf[si]; let fst: i32 = vDdfSt[si];
    const faT: f32 = envTime(pget(base + PB_DDFA));
    const fdT: f32 = envTime(pget(base + PB_DDFD));
    if (fst == 1) { fe += dt / faT; if (fe >= 1.0) { fe = 1.0; fst = 2; } }
    else if (fst == 2) { fe += (0.0 - fe) * (1.0 - Mathf.exp(-dt * 5.0 / fdT)); }
    vDdf[si] = fe; vDdfSt[si] = fst;
    // --- band envelopes (3) ---
    for (let b = 0; b < 3; b++) {
      const bi: i32 = (s * 3 + b) * NUM_VOICES + v;
      let be: f32 = vBand[bi]; let bst: i32 = vBandSt[bi];
      const baT: f32 = envTime(pget(base + PB_LOA + b * 2));
      const bdT: f32 = envTime(pget(base + PB_LOD + b * 2));
      if (bst == 0) { be += dt / baT; if (be >= 1.0) { be = 1.0; bst = 1; } }
      else { be += (0.2 - be) * (1.0 - Mathf.exp(-dt * 4.0 / bdT)); } // decay to floor
      vBand[bi] = be; vBandSt[bi] = bst;
    }
    // --- DDF cutoff (harmonic index) with env + keytrack + pressure ---
    const cutKnob: f32 = clampf(pget(base + PB_DDFCUT), 0.0, 1.0);
    const reso: f32 = clampf(pget(base + PB_DDFRES), 0.0, 1.0);
    const envAmt: f32 = clampf(pget(base + PB_DDFENV), -1.0, 1.0);
    let cutN: f32 = 1.0 + cutKnob * f32(NUM_HARM - 1);
    cutN *= Mathf.pow(2.0, envAmt * fe * 2.0);       // env sweeps cutoff (±2 oct)
    cutN *= Mathf.pow(2.0, (ktShift + at * 6.0) / 12.0); // keytrack + aftertouch open
    if (cutN < 1.0) cutN = 1.0; if (cutN > f32(NUM_HARM)) cutN = f32(NUM_HARM);
    // --- build effective harmonic amps for this voice/source ---
    const baseArr: StaticArray<f32> = s == 0 ? baseA1 : baseA2;
    const dstArr: StaticArray<f32> = s == 0 ? effA1 : effA2;
    // nyquist harmonic limit for this source's fundamental (S2 may run up to ~2.2x)
    const srcF0: f32 = s == 0 ? f0 : f0 * 2.2;
    let maxH: i32 = i32(0.45 * sampleRate / (srcF0 > 1.0 ? srcF0 : 1.0));
    if (maxH > NUM_HARM) maxH = NUM_HARM; if (maxH < 1) maxH = 1;
    const bl: f32 = vBand[(s * 3 + 0) * NUM_VOICES + v];
    const bm: f32 = vBand[(s * 3 + 1) * NUM_VOICES + v];
    const bh: f32 = vBand[(s * 3 + 2) * NUM_VOICES + v];
    const off: i32 = v * NUM_HARM;
    for (let i = 0; i < NUM_HARM; i++) {
      if (i >= maxH) { dstArr[off + i] = 0.0; continue; }
      const h: i32 = i + 1;
      const bandV: f32 = h <= 8 ? bl : (h <= 24 ? bm : bh);
      dstArr[off + i] = baseArr[i] * bandV * ddfWeight(h, cutN, reso);
    }
  }
}

// ---- process ---------------------------------------------------------
export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const dtCtrl: f32 = f32(CTRL) / sr;

  // performance / global reads
  const flags: i32 = pbits(P_FLAGS);
  const full: i32 = flags & 1;
  const keysync: i32 = (flags >> 1) & 1;
  const bal: f32 = clampf(pget(P_BAL), 0.0, 1.0);
  const gS1: f32 = Mathf.sqrt(1.0 - bal);
  const gS2: f32 = Mathf.sqrt(bal);
  const s2coarse: f32 = pget(P_S2COARSE);
  const s2det: f32 = clampf(pget(P_S2DET), -1.0, 1.0);
  const mtune: f32 = clampf(pget(P_MTUNE), -1.0, 1.0);
  const penvAmt: f32 = clampf(pget(P_PENV), -1.0, 1.0);
  const penvRate: f32 = clampf(pget(P_PENVR), 0.0, 1.0);
  const lfoRate: f32 = clampf(pget(P_LFORATE), 0.0, 1.0);
  const lfoShp: i32 = pbits(P_LFOSHP);
  const lfoDep: f32 = clampf(pget(P_LFODEP), 0.0, 1.0);
  const lfoDst: i32 = pbits(P_LFODST);
  const bendR: f32 = clampf(pget(P_BENDR), 0.0, 12.0);
  const pw: f32 = clampf(pget(P_PWHEEL), -1.0, 1.0);
  const modw: f32 = clampf(pget(P_MODWHL), 0.0, 1.0);
  const at: f32 = clampf(pget(P_AT), 0.0, 1.0);
  const vol: f32 = clampf(pget(P_VOL), 0.0, 1.0);

  // pitch multiplier common to all voices this block
  const bendRatio: f32 = Mathf.pow(2.0, pw * bendR / 12.0);
  const mtuneRatio: f32 = Mathf.pow(2.0, mtune / 12.0);
  const s2Ratio: f32 = Mathf.pow(2.0, s2coarse / 12.0) * Mathf.pow(2.0, s2det * 50.0 / 1200.0) * (full == 1 ? 2.0 : 1.0);

  const lfoInc: f32 = (0.03 + lfoRate * lfoRate * 24.0) / sr; // 0.03 .. ~24 Hz
  const penvDecay: f32 = 1.0 - Mathf.exp(-dtCtrl * 4.0 / envTime(penvRate));

  let ctrlCount: i32 = 0;

  for (let i = 0; i < n; i++) {
    // ---- control-rate updates ----
    if (ctrlCount == 0) {
      // advance LFO at control rate
      lfoPhase += lfoInc * f32(CTRL);
      if (lfoPhase >= 1.0) {
        lfoPhase -= 1.0;
        lfoSH = rngf();
        if (keysync == 1) { /* retrig handled on noteOn only; keysync flag kept */ }
      }
      lfoPos = lfoPhase;
      lfoVal = lfoShapeVal(lfoShp, lfoPhase);

      // LFO → spectrum / formant folded into base spectra
      const specMod: f32 = (lfoDst & 2) != 0 ? lfoVal * lfoDep * 0.8 : 0.0;
      const formMod: f32 = (lfoDst & 8) != 0 ? lfoVal * lfoDep * 0.3 : 0.0;
      const presTilt: f32 = at * 0.6; // aftertouch brightens
      buildBase(0, baseA1, specMod + presTilt, formMod);
      buildBase(1, baseA2, specMod + presTilt, formMod);

      for (let v = 0; v < NUM_VOICES; v++) {
        if (vActive[v] == 0) continue;
        // pitch env decays 1 -> 0
        vPEnv[v] += (0.0 - vPEnv[v]) * penvDecay;
        updateVoice(v, dtCtrl);
        // deactivate when both DDA released & silent
        if (vGate[v] == 0) {
          const d0: f32 = vDda[0 * NUM_VOICES + v];
          const d1: f32 = vDda[1 * NUM_VOICES + v];
          if (vDdaSt[0 * NUM_VOICES + v] == 4 && vDdaSt[1 * NUM_VOICES + v] == 4 && d0 < 0.0008 && d1 < 0.0008)
            vActive[v] = 0;
        }
      }
    }
    ctrlCount++; if (ctrlCount >= CTRL) ctrlCount = 0;

    // ---- per-sample synthesis ----
    let outL: f32 = 0.0;
    const vibDepth: f32 = lfoDep + modw * 0.6;
    const pitchLfo: f32 = (lfoDst & 1) != 0 ? Mathf.pow(2.0, lfoVal * vibDepth * 2.0 / 12.0) : Mathf.pow(2.0, lfoVal * modw * 0.6 * 2.0 / 12.0);
    const ampLfo: f32 = (lfoDst & 4) != 0 ? (1.0 - lfoDep * 0.5 * (0.5 + 0.5 * lfoVal)) : 1.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;
      // glide
      if (vGlideK[v] != 1.0) {
        vCur[v] *= vGlideK[v];
        if ((vGlideK[v] > 1.0 && vCur[v] >= vTarget[v]) || (vGlideK[v] < 1.0 && vCur[v] <= vTarget[v])) {
          vCur[v] = vTarget[v]; vGlideK[v] = 1.0;
        }
      }
      const pEnvRatio: f32 = Mathf.pow(2.0, penvAmt * vPEnv[v] * 24.0 / 12.0);
      const f0: f32 = vCur[v] * mtuneRatio * bendRatio * pitchLfo * pEnvRatio;
      const f1: f32 = f0;
      const f2: f32 = f0 * s2Ratio;

      // S1 harmonic sum via complex recurrence
      const off: i32 = v * NUM_HARM;
      let ph1: f32 = vPh1[v] + f1 / sr; ph1 -= Mathf.floor(ph1); vPh1[v] = ph1;
      const a1: f32 = TWO_PI * ph1;
      const c1: f32 = Mathf.cos(a1); const s1: f32 = Mathf.sin(a1);
      let ch: f32 = c1; let sh: f32 = s1;
      let acc1: f32 = effA1[off] * sh;
      for (let h = 2; h <= NUM_HARM; h++) {
        const nc: f32 = ch * c1 - sh * s1;
        const ns: f32 = sh * c1 + ch * s1;
        ch = nc; sh = ns;
        acc1 += effA1[off + h - 1] * sh;
      }
      // S2 harmonic sum
      let ph2: f32 = vPh2[v] + f2 / sr; ph2 -= Mathf.floor(ph2); vPh2[v] = ph2;
      const a2: f32 = TWO_PI * ph2;
      const c2: f32 = Mathf.cos(a2); const s2v: f32 = Mathf.sin(a2);
      ch = c2; sh = s2v;
      let acc2: f32 = effA2[off] * sh;
      for (let h = 2; h <= NUM_HARM; h++) {
        const nc: f32 = ch * c2 - sh * s2v;
        const ns: f32 = sh * c2 + ch * s2v;
        ch = nc; sh = ns;
        acc2 += effA2[off + h - 1] * sh;
      }
      const e1: f32 = vDda[0 * NUM_VOICES + v];
      const e2: f32 = vDda[1 * NUM_VOICES + v];
      outL += acc1 * e1 * gS1 + acc2 * e2 * gS2;
    }

    outL *= ampLfo;
    // master gain + soft clip
    let s: f32 = outL * (vol * vol * 2.2);
    s = Mathf.tanh(s);
    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
