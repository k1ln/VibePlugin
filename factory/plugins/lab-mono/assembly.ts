// =====================================================================
//  LAB MONO — an aggressive, patchable single-VCO monophonic synth
//  In the lineage of the raw Japanese semi-modular lab monos: ONE VCO
//  (saw + pulse with PWM) feeding a screaming Korg-35-style 2-pole
//  resonant low-pass that self-oscillates as Resonance is pushed, a
//  punchy decay envelope, and a patchable MOD source (sample & hold OR
//  triangle LFO) wired straight to the filter cutoff for burbling,
//  zapping movement.
//
//  Signal path (mono, last-note priority):
//    VCO (saw + PWM pulse) -> Korg-35 resonant LPF -> amp decay env -> level
//      cutoff = base + EnvAmt*filterEnv + Mod(depth) * (S&H or LFO)
//  A DC blocker and a bounded soft saturator keep the self-oscillating
//  filter screaming but never exploding. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_CUTOFF: i32 = 0; // base cutoff 0..1
const P_RESO:   i32 = 1; // resonance 0..1 (screams toward self-oscillation)
const P_ENVAMT: i32 = 2; // filter-envelope amount 0..1
const P_MOD:    i32 = 3; // mod depth into cutoff 0..1
const P_MODRATE:i32 = 4; // mod rate 0..1 (Hz) AND S&H/LFO blend
const P_DECAY:  i32 = 5; // amp + filter decay 0..1
const P_LEVEL:  i32 = 6; // output level 0..1

// ---- mono voice state (last-note priority) ----
let curNote: i32 = -1;   // currently sounding host note id (-1 = none)
let gate: i32 = 0;       // 1 while a key is held
let freq: f32 = 0.0;     // sounding frequency in Hz
let vel: f32 = 0.0;      // velocity 0..1
let phase: f32 = 0.0;    // oscillator phase 0..1
let fenv: f32 = 0.0;     // filter envelope 1 -> 0
let aenv: f32 = 0.0;     // amp envelope (decay/sustain)

// Korg-35-style 2-pole low-pass state
let lp1: f32 = 0.0;
let lp2: f32 = 0.0;

// ---- shared modulation: sample & hold + triangle LFO + RNG, DC, PWM ----
let modPhase: f32 = 0.0; // 0..1 clock for the mod source
let shValue: f32 = 0.0;  // current held random value (-1..1)
let shSmooth: f32 = 0.0; // lightly slewed S&H output (stepped but click-free)
let rngState: u32 = 0x1234567;

let pwmPhase: f32 = 0.0; // slow LFO that PWM-modulates the pulse width

let dcX: f32 = 0.0;      // DC blocker
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  curNote = -1; gate = 0;
  freq = 0.0; vel = 0.0; phase = 0.0;
  fenv = 0.0; aenv = 0.0;
  lp1 = 0.0; lp2 = 0.0;
  modPhase = 0.0; shValue = 0.0; shSmooth = 0.0;
  rngState = 0x1234567;
  pwmPhase = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_CUTOFF]  = 0.35;
  params[P_RESO]    = 0.62;
  params[P_ENVAMT]  = 0.55;
  params[P_MOD]     = 0.45;
  params[P_MODRATE] = 0.4;
  params[P_DECAY]   = 0.45;
  params[P_LEVEL]   = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// soft saturator: bounded, smooth, cheap (tames the screaming filter)
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// xorshift32 -> uniform random in [-1, 1]
@inline function nextRand(): f32 {
  let x: u32 = rngState;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rngState = x;
  const u: f32 = f32(x >> 8) * (1.0 / 16777216.0);
  return f32(u * 2.0 - 1.0);
}

// Host passes frequency in Hz. Monophonic: a new note steals the voice.
export function noteOn(id: i32, f: f32, v: f32): void {
  const nf: f32 = f > 0.0 ? f : 0.0001;
  curNote = id;
  gate = 1;
  freq = nf;
  vel = clampf(v, 0.0, 1.0);
  phase = 0.0;
  fenv = 1.0;      // retrigger the filter sweep
  aenv = 1.0;      // retrigger the amp envelope
}

export function noteOff(id: i32): void {
  if (id == curNote) gate = 0;
}

export function process(n: i32): void {
  const cutoffN:  f32 = clampf(params[P_CUTOFF],  0.0, 1.0);
  const resoN:    f32 = clampf(params[P_RESO],    0.0, 1.0);
  const envAmtN:  f32 = clampf(params[P_ENVAMT],  0.0, 1.0);
  const modN:     f32 = clampf(params[P_MOD],     0.0, 1.0);
  const modRateN: f32 = clampf(params[P_MODRATE], 0.0, 1.0);
  const decayN:   f32 = clampf(params[P_DECAY],   0.0, 1.0);
  const level:    f32 = clampf(params[P_LEVEL],   0.0, 1.0);

  // ---- derived coefficients ----

  // Decay: filter env ~30 ms .. ~1.6 s; amp env follows for the percussive zap.
  const fdecaySec: f32 = 0.03 + decayN * decayN * 1.6;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));
  const adecaySec: f32 = 0.05 + decayN * decayN * 2.2;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));
  // sustain floor scales with Decay so longer decay = more held body, shorter
  // decay = more plucked — guarantees Decay changes the held note's loudness.
  const sustainFloor: f32 = 0.12 + decayN * 0.55;

  // Resonance 0..~1.6: pushes the Korg-35 feedback toward self-oscillation.
  const reso: f32 = resoN * resoN * 1.62;

  // Base cutoff (exponential, musical): ~60 Hz .. ~10 kHz.
  const baseCut: f32 = f32(60.0 * Mathf.exp(cutoffN * 5.12));

  // Filter-envelope sweep span (Hz).
  const sweepSpan: f32 = envAmtN * 9000.0;

  // Mod clock rate: ~0.3 Hz (slow burble) .. ~28 Hz (zapping).
  const modRateHz: f32 = 0.3 + modRateN * modRateN * 27.7;
  const modInc: f32 = modRateHz / sampleRate;

  // Mod depth -> how many Hz the mod source moves the cutoff.
  const modSpan: f32 = modN * 7000.0;

  // Blend between S&H (low rate end) and triangle LFO (high rate end): the
  // low half of Mod Rate is steppy S&H burble, the high half is smooth LFO
  // zapping. This makes Mod Rate audibly change character, not just speed.
  const lfoBlend: f32 = clampf((modRateN - 0.5) * 2.0, 0.0, 1.0);

  // Lightly slew the stepped S&H value so steps are click-free but still steppy.
  const shSlew: f32 = clampf(80.0 / sampleRate, 0.0, 1.0);

  // PWM LFO ~2.7 Hz
  const pwmInc: f32 = 2.7 / sampleRate;

  const nyq: f32 = sampleRate * 0.5;

  for (let i = 0; i < n; i++) {
    // ---- mod source clock: triangle phase + stepped S&H ----
    modPhase += modInc;
    if (modPhase >= 1.0) {
      modPhase -= 1.0;
      shValue = nextRand();   // re-sample on each cycle
    }
    shSmooth += shSlew * (shValue - shSmooth);

    // triangle LFO from the same phase (-1..1)
    const tri: f32 = f32(4.0 * Mathf.abs(modPhase - 0.5) - 1.0);

    // patchable mod: blend S&H (steppy) -> LFO (smooth) as rate rises
    const modSrc: f32 = shSmooth * (1.0 - lfoBlend) + tri * lfoBlend;
    const modCut: f32 = modSpan * modSrc;

    // ---- PWM LFO ----
    pwmPhase += pwmInc;
    if (pwmPhase >= 1.0) pwmPhase -= 1.0;
    const pw: f32 = 0.5 + 0.2 * f32(Mathf.sin(pwmPhase * TWO_PI));

    // ---- oscillator: phase ramp -> saw + PWM pulse ----
    let inc: f32 = freq / sampleRate;
    if (inc < 0.0) inc = 0.0;
    if (inc > 0.5) inc = 0.5;
    phase += inc;
    if (phase >= 1.0) phase -= 1.0;

    const saw: f32 = phase * 2.0 - 1.0;
    const pulse: f32 = phase < pw ? 1.0 : -1.0;
    let osc: f32 = 0.62 * saw + 0.38 * pulse;
    osc *= 0.9;

    // ---- envelopes ----
    let fe: f32 = fenv * fenvCoef;
    fenv = fe;

    let ae: f32 = aenv * aenvCoef;
    if (gate != 0) {
      if (ae < sustainFloor) ae = sustainFloor;   // decay to a Decay-scaled sustain
    }
    aenv = ae;

    // ---- cutoff: base + filter-env sweep + patchable mod ----
    let cutHz: f32 = baseCut + sweepSpan * fe + modCut;
    if (cutHz < 20.0) cutHz = 20.0;
    if (cutHz > nyq * 0.49) cutHz = nyq * 0.49;

    // ---- Korg-35-style 2-pole resonant low-pass ----
    let fc: f32 = cutHz / nyq;
    if (fc > 0.49) fc = 0.49;
    const g: f32 = fc * (1.85 - 0.85 * fc);

    // feedback from the band-pass node drives the screaming resonance; the
    // saturator inside the loop keeps self-oscillation bounded and gritty.
    const bp: f32 = lp1 - lp2;
    const fb: f32 = reso * satf(bp * 1.4);
    const input: f32 = osc - fb;

    lp1 += g * (input - lp1);
    lp2 += g * (lp1 - lp2);

    let filtered: f32 = satf(lp2 * 1.25);

    // ---- amp env + velocity loudness ----
    const ampBoost: f32 = 0.55 + 0.45 * vel;
    let s: f32 = filtered * ae * ampBoost;

    // ---- DC blocker ----
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = y;
    s = y;

    // headroom + output level (keeps the screaming filter peak < ~1.0)
    s = satf(s * 0.85) * level * 0.92;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;

    // retire once fully released and silent
    if (gate == 0 && aenv < 0.0006 && fenv < 0.0006) {
      // voice idle; nothing to do (keeps state stable)
    }
  }
}
