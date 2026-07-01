// =====================================================================
//  MONO SPARK — punchy sub-heavy monophonic synthesizer
//  An SH-101-lineage techno/acid workhorse: ONE main VCO producing a saw
//  plus a variable-width pulse (with PWM), reinforced by a strong square
//  SUB oscillator one/two octaves down, plus a touch of white noise. The
//  blend runs into a snappy 4-pole resonant low-pass driven by its OWN
//  decay envelope (the punch), then an amp envelope and output level.
//
//  Mono with last-note priority. A small voice pool (4) lets fast chord
//  stabs retrigger cleanly, but only the most-recent gated note sounds —
//  classic mono behaviour with a fat, weighty low end from the sub.
//
//  Signal path:
//    [ saw + pulse(PWM) + 2x square SUB + noise ]
//      -> 4-pole resonant LPF (cutoff = base + envAmt * filterEnv)
//      -> amp env -> soft clip -> level
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32 = 3.14159265358979;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_CUTOFF: i32 = 0; // base cutoff 0..1
const P_RESO:   i32 = 1; // resonance 0..1
const P_ENVAMT: i32 = 2; // filter envelope amount 0..1
const P_SUB:    i32 = 3; // sub-oscillator level 0..1
const P_PWM:    i32 = 4; // pulse width 0..1 (0.5 = square)
const P_DECAY:  i32 = 5; // filter + amp decay 0..1
const P_LEVEL:  i32 = 6; // output level 0..1

// ---- mono voice state ----
const VOICES: i32 = 4;
const heldId:   StaticArray<i32> = new StaticArray<i32>(VOICES); // note ids currently held (-1 empty)
const heldFreq: StaticArray<f32> = new StaticArray<f32>(VOICES); // their freqs
let nHeld: i32 = 0;          // number of held notes in the stack

let mainPhase: f32 = 0.0;    // main VCO phase 0..1
let subPhase:  f32 = 0.0;    // sub oscillator phase 0..1
let curFreq:   f32 = 0.0;    // frequency currently sounding (Hz)
let gate: i32 = 0;           // 1 while any note held

// envelopes (decay-style: snap to 1 on trigger, decay down)
let fenv: f32 = 0.0;         // filter envelope
let aenv: f32 = 0.0;         // amp envelope
let vel:  f32 = 0.8;         // velocity of the current note

// 4-pole ladder filter state
let z0: f32 = 0.0;
let z1: f32 = 0.0;
let z2: f32 = 0.0;
let z3: f32 = 0.0;

// noise + dc-block state
let rngState: u32 = 0x9e3779b9;
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  mainPhase = 0.0;
  subPhase = 0.0;
  curFreq = 0.0;
  gate = 0;
  fenv = 0.0;
  aenv = 0.0;
  vel = 0.8;
  nHeld = 0;
  z0 = 0.0; z1 = 0.0; z2 = 0.0; z3 = 0.0;
  rngState = 0x9e3779b9;
  dcX = 0.0; dcY = 0.0;
  for (let i = 0; i < VOICES; i++) { heldId[i] = -1; heldFreq[i] = 0.0; }

  params[P_CUTOFF] = 0.40;
  params[P_RESO]   = 0.55;
  params[P_ENVAMT] = 0.70;
  params[P_SUB]    = 0.65;
  params[P_PWM]    = 0.35;
  params[P_DECAY]  = 0.35;
  params[P_LEVEL]  = 0.80;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// fast bounded soft-clipper (cubic-ish), saturates smoothly toward ±1
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

@inline function whiteNoise(): f32 {
  rngState ^= rngState << 13;
  rngState ^= rngState >> 17;
  rngState ^= rngState << 5;
  return f32(i32(rngState)) * f32(4.6566129e-10); // ~ -1..1
}

// Trigger the envelopes (re-strike) and reset the sub phase for a tight thump.
@inline function strike(f: f32, v: f32): void {
  curFreq = f > 0.0 ? f : 0.0001;
  vel = clampf(v, 0.05, 1.0);
  fenv = 1.0;
  aenv = 1.0;
  subPhase = 0.0; // align sub for a punchy attack transient
}

// Host passes frequency in Hz. Last-note priority: a new note steals the voice.
export function noteOn(id: i32, f: f32, v: f32): void {
  // push onto the held stack (drop oldest if full)
  if (nHeld >= VOICES) {
    for (let i = 0; i < VOICES - 1; i++) { heldId[i] = heldId[i + 1]; heldFreq[i] = heldFreq[i + 1]; }
    nHeld = VOICES - 1;
  }
  heldId[nHeld] = id;
  heldFreq[nHeld] = f;
  nHeld++;
  gate = 1;
  strike(f, v);
}

export function noteOff(id: i32): void {
  // remove from stack
  let w: i32 = 0;
  for (let i = 0; i < nHeld; i++) {
    if (heldId[i] != id) {
      heldId[w] = heldId[i];
      heldFreq[w] = heldFreq[i];
      w++;
    }
  }
  nHeld = w;

  if (nHeld <= 0) {
    gate = 0; // release
  } else {
    // fall back to the previous held note (last-note priority), no re-strike
    curFreq = heldFreq[nHeld - 1];
  }
}

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN:   f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envAmtN: f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const subN:    f32 = clampf(params[P_SUB],    0.0, 1.0);
  const pwmN:    f32 = clampf(params[P_PWM],    0.0, 1.0);
  const decayN:  f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // ---- derived coefficients ----

  // Filter envelope decay: ~25 ms (snappy techno pluck) .. ~1.4 s (long sweep)
  const fdecaySec: f32 = 0.025 + decayN * decayN * 1.4;
  const fenvCoef: f32 = f32(Mathf.exp(f32(-1.0) / (fdecaySec * sampleRate)));

  // Amp envelope: a touch longer so notes ring just past the filter close.
  const adecaySec: f32 = 0.05 + decayN * decayN * 1.7;
  const aenvCoef: f32 = f32(Mathf.exp(f32(-1.0) / (adecaySec * sampleRate)));

  // Resonance 0..~4 (approaches self-oscillation but bounded by satf feedback).
  const reso: f32 = resoN * 4.0;

  // Base cutoff in Hz (exponential, musical): ~70 Hz .. ~10 kHz.
  const baseCut: f32 = f32(70.0 * Mathf.exp(cutoffN * 4.96)); // 70 * e^4.96 ~ 10k

  // Envelope sweep span (Hz) added on top of base.
  const sweepSpan: f32 = envAmtN * 9000.0;

  const nyq: f32 = sampleRate * 0.5;

  // Pulse width: keep away from the degenerate 0/1 edges. 0.5 = square.
  const pw: f32 = 0.08 + pwmN * 0.84; // 0.08..0.92

  // Sub level (square one octave down + a quieter two-octave-down layer).
  const subLvl: f32 = subN * 1.1;

  for (let i = 0; i < n; i++) {
    // ---- main oscillator ----
    let inc: f32 = curFreq / sampleRate;
    if (inc < 0.0) inc = 0.0;
    if (inc > 0.5) inc = 0.5;
    mainPhase += inc;
    if (mainPhase >= 1.0) mainPhase -= 1.0;

    const saw: f32 = mainPhase * 2.0 - 1.0;            // raw saw
    const pulse: f32 = mainPhase < pw ? 1.0 : -1.0;     // variable-width pulse
    // blend saw + pulse for the SH-style mixer feel
    const main: f32 = 0.6 * saw + 0.55 * pulse;

    // ---- sub oscillator (one octave down) + a softer 2-octave layer ----
    subPhase += inc * 0.5;
    if (subPhase >= 1.0) subPhase -= 1.0;
    const sub1: f32 = subPhase < 0.5 ? 1.0 : -1.0;      // square, 1 oct down
    // derive a 2-octave-down square from the same phase (period doubling)
    const sub2: f32 = subPhase < 0.25 || subPhase >= 0.75 ? 1.0 : -1.0;
    const sub: f32 = (sub1 * 0.85 + sub2 * 0.4) * subLvl;

    // ---- noise (subtle grit, scales with sub a touch for body) ----
    const noise: f32 = whiteNoise() * 0.04;

    // ---- envelopes (decay toward 0; amp holds a small floor while gated) ----
    fenv *= fenvCoef;
    if (gate != 0) {
      aenv = aenv * aenvCoef;
      if (aenv < 0.35) aenv = 0.35; // sustain floor while held
    } else {
      aenv *= aenvCoef;
    }

    // ---- cutoff for this sample ----
    let cutHz: f32 = baseCut + sweepSpan * fenv;
    if (cutHz < 20.0) cutHz = 20.0;
    if (cutHz > nyq * 0.49) cutHz = nyq * 0.49;

    // ---- 4-pole resonant ladder ----
    let fc: f32 = cutHz / nyq; // 0..0.49
    if (fc > 0.49) fc = 0.49;
    const g: f32 = fc * (1.8 - 0.8 * fc); // empirical tuning curve

    const fb: f32 = reso * (1.0 - 0.15 * g);
    const drive: f32 = (main + sub + noise) * (0.9 + 0.3 * vel);
    let input: f32 = drive - fb * satf(z3);

    z0 += g * (input - z0);
    z1 += g * (z0 - z1);
    z2 += g * (z1 - z2);
    z3 += g * (z2 - z3);

    let filtered: f32 = satf(z3 * 1.3);

    // ---- amp + level ----
    let s: f32 = filtered * aenv * vel;

    // DC blocker (kills any sub-induced offset)
    const y: f32 = s - dcX + f32(0.9985) * dcY;
    dcX = s;
    dcY = y;
    s = y;

    // final level + headroom guard (peak stays < ~1.0)
    s = satf(s * level * 1.4) * 0.82;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
