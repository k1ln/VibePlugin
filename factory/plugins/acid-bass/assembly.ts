// =====================================================================
//  ACID BASS — monophonic resonant squelch-bass synth (303-style voice)
//  A single morphing saw<->square oscillator drives a 4-pole resonant
//  low-pass with a fast-decaying filter envelope (the "squelch"). Accent
//  boosts the filter envelope and level on hard hits; Glide slides pitch
//  between notes (last-note priority). Pure algorithm, no samples.
//
//  Signal path per note:
//    osc (saw<->square morph) -> drive/shaper -> 4-pole resonant LPF
//    cutoff = base + envMod * filterEnv(+accent) -> amp env -> level
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32  = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_WAVE:  i32 = 0; // 0 = saw, 1 = square (morph)
const P_CUTOFF: i32 = 1; // base cutoff 0..1
const P_RESO:  i32 = 2; // resonance 0..1
const P_ENVMOD: i32 = 3; // filter envelope amount 0..1
const P_DECAY: i32 = 4; // filter+amp decay 0..1
const P_ACCENT: i32 = 5; // accent amount 0..1
const P_GLIDE: i32 = 6; // glide / portamento time 0..1
const P_LEVEL: i32 = 7; // output level 0..1

// ---- voice state ----
let phase: f32 = 0.0;       // oscillator phase 0..1
let targetFreq: f32 = 0.0;  // freq requested by the note
let curFreq: f32 = 0.0;     // current (glided) freq
let gate: i32 = 0;          // 1 while a note is held
let note: i32 = -1;         // currently sounding note id
let accentAmt: f32 = 0.0;   // 0..1 accent strength for the current note (from velocity)

// envelopes
let fenv: f32 = 0.0;        // filter envelope (decays from 1 -> 0)
let aenv: f32 = 0.0;        // amplitude envelope (AD-ish with sustain)

// 4-pole (Moog-style) ladder filter state
let f0: f32 = 0.0;
let f1: f32 = 0.0;
let f2: f32 = 0.0;
let f3: f32 = 0.0;

// gentle DC blocker on the output
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  phase = 0.0;
  targetFreq = 0.0;
  curFreq = 0.0;
  gate = 0;
  note = -1;
  accentAmt = 0.0;
  fenv = 0.0;
  aenv = 0.0;
  f0 = 0.0; f1 = 0.0; f2 = 0.0; f3 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_WAVE]   = 0.15;
  params[P_CUTOFF] = 0.35;
  params[P_RESO]   = 0.78;
  params[P_ENVMOD] = 0.7;
  params[P_DECAY]  = 0.4;
  params[P_ACCENT] = 0.5;
  params[P_GLIDE]  = 0.25;
  params[P_LEVEL]  = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// soft saturator to tame self-oscillating resonance and add analog grit
@inline function satf(x: f32): f32 {
  // fast tanh-ish: bounded, smooth, cheap
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// Host passes frequency in Hz. Last-note priority; new notes (re-)trigger the
// envelopes. Velocity sets the per-note accent strength.
export function noteOn(id: i32, f: f32, v: f32): void {
  const newFreq: f32 = f > 0.0 ? f : 0.0001;
  // If nothing was sounding, jump straight to pitch so the first note doesn't
  // glide up from silence in an unexpected way... but a tiny seed gives glide
  // something audible to ride for very first note too.
  if (gate == 0 && curFreq <= 0.0) {
    curFreq = newFreq * 0.5; // start an octave down so the first note glides
  }
  targetFreq = newFreq;
  note = id;
  gate = 1;
  // velocity -> accent strength for this note
  accentAmt = clampf(v, 0.0, 1.0);
  // (re)trigger envelopes
  fenv = 1.0;
  aenv = 1.0;
}

export function noteOff(id: i32): void {
  if (id == note) gate = 0;
}

export function process(n: i32): void {
  const wave:   f32 = clampf(params[P_WAVE],   0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN:  f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envModN: f32 = clampf(params[P_ENVMOD], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const accentN: f32 = clampf(params[P_ACCENT], 0.0, 1.0);
  const glideN: f32 = clampf(params[P_GLIDE],  0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // ---- derived coefficients ----

  // Filter-envelope decay: ~30 ms (snappy) up to ~1.2 s (long sweep).
  const fdecaySec: f32 = 0.03 + decayN * decayN * 1.2;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));

  // Amp envelope: a touch longer than the filter so notes ring out musically.
  const adecaySec: f32 = 0.06 + decayN * decayN * 1.6;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));

  // Glide time: 0 (instant) .. ~120 ms per-sample one-pole toward target.
  // Build a one-pole coefficient; glideN==0 means snap.
  const glideSec: f32 = glideN * 0.12;
  const glideCoef: f32 = glideSec > 0.0
    ? f32(Mathf.exp(-1.0 / (glideSec * sampleRate)))
    : 0.0;

  // Accent: boosts filter-env amount and a bit of level on hard hits.
  // accentN scales how strong the accent system is; accentAmt is per-note vel.
  const accent: f32 = accentN * accentAmt;            // 0..1 effective accent
  const envModEff: f32 = envModN * (1.0 + 1.3 * accent); // accent opens filter more
  const ampBoost: f32 = 1.0 + 0.6 * accent;            // accent is louder

  // Resonance 0..~3.9 (approaches self-oscillation but stays bounded by satf).
  const reso: f32 = resoN * 3.9;

  // Base cutoff in Hz (exponential, musical): ~80 Hz .. ~9 kHz.
  const baseCut: f32 = f32(80.0 * Mathf.exp(cutoffN * 4.72)); // 80 * e^4.72 ~ 9000

  // Envelope sweep span in Hz added on top of base.
  const sweepSpan: f32 = envModEff * 8500.0;

  const nyq: f32 = sampleRate * 0.5;

  // Drive into the filter (square is hotter; keep saw clean-ish).
  const oscDrive: f32 = 1.0 + wave * 0.6;

  for (let i = 0; i < n; i++) {
    // ---- glide pitch toward target ----
    if (glideCoef > 0.0) {
      curFreq = targetFreq + (curFreq - targetFreq) * glideCoef;
    } else {
      curFreq = targetFreq;
    }

    // ---- oscillator: phase ramp -> saw, derive square, morph ----
    let inc: f32 = curFreq / sampleRate;
    if (inc < 0.0) inc = 0.0;
    if (inc > 0.5) inc = 0.5;
    phase += inc;
    if (phase >= 1.0) phase -= 1.0;

    const saw: f32 = phase * 2.0 - 1.0;
    const sq:  f32 = phase < 0.5 ? 1.0 : -1.0;
    // morph saw -> square
    let osc: f32 = saw + (sq - saw) * wave;
    osc *= oscDrive;

    // ---- envelopes (decay toward 0; amp holds a small sustain while gated) ----
    fenv *= fenvCoef;
    if (gate != 0) {
      // amp sustains at a floor while held, then releases on noteOff
      const sustain: f32 = 0.0;
      aenv = sustain + (aenv - sustain) * aenvCoef;
      // keep amp from collapsing fully while held: gentle floor
      if (aenv < 0.25) aenv = 0.25;
    } else {
      aenv *= aenvCoef;
    }

    // ---- compute cutoff for this sample ----
    let cutHz: f32 = baseCut + sweepSpan * fenv;
    // accent adds a brief extra "click" of brightness at note start via fenv^2
    cutHz += sweepSpan * 0.5 * accent * (fenv * fenv);
    if (cutHz < 20.0) cutHz = 20.0;
    if (cutHz > nyq * 0.49) cutHz = nyq * 0.49;

    // ---- 4-pole resonant ladder (normalized cutoff) ----
    // g = tan-ish frequency warp approximated; use simple one-pole cascade.
    let fc: f32 = cutHz / nyq; // 0..0.49
    if (fc > 0.49) fc = 0.49;
    // tuning coefficient for the cascade
    const g: f32 = fc * (1.8 - 0.8 * fc); // empirical tuning curve

    // resonance feedback (clamped); satf on feedback keeps it bounded
    const fb: f32 = reso * (1.0 - 0.15 * g);
    let input: f32 = osc - fb * satf(f3);

    // four cascaded one-pole low-passes
    f0 += g * (input - f0);
    f1 += g * (f0 - f1);
    f2 += g * (f1 - f2);
    f3 += g * (f2 - f3);

    let filtered: f32 = f3;
    // saturate the output of the ladder for analog warmth + safety
    filtered = satf(filtered * 1.4);

    // ---- amp + accent + level ----
    let s: f32 = filtered * aenv * ampBoost;

    // DC blocker
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = y;
    s = y;

    // final level + headroom guard
    s = satf(s * level * 1.3) * 0.85;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
