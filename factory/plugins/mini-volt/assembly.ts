// =====================================================================
//  MINI VOLT — compact expressive single-oscillator MONO synth
//  A lean one-VCO voice in the compact vintage-mono lineage: a wide-range
//  main oscillator (saw with a touch of PWM-able pulse) plus a square SUB an
//  octave down, feeding a classic transistor-ladder 4-pole resonant low-pass with
//  its OWN snappy envelope. An OSC MOD section adds a small LFO that
//  vibratos the pitch and grows the pulse-width for expressive growl, and
//  GLIDE slides pitch between notes (last-note priority). Pure algorithm.
//
//  Signal path per note:
//    osc (saw + PWM pulse) + sub-square  ->  transistor-ladder LPF (env-swept)
//    -> amp envelope -> soft saturate -> level
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
const P_CUTOFF: i32 = 0; // base ladder cutoff 0..1
const P_RESO:   i32 = 1; // ladder resonance 0..1
const P_ENV:    i32 = 2; // filter-envelope amount 0..1
const P_MOD:    i32 = 3; // osc mod: vibrato + PWM growl depth 0..1
const P_SUB:    i32 = 4; // sub-oscillator level 0..1
const P_GLIDE:  i32 = 5; // glide / portamento time 0..1
const P_LEVEL:  i32 = 6; // output level 0..1

// ---- voice state ----
let phase: f32 = 0.0;       // main oscillator phase 0..1
let subPhase: f32 = 0.0;    // sub oscillator phase 0..1 (half rate)
let lfoPhase: f32 = 0.0;    // osc-mod LFO phase 0..1
let targetFreq: f32 = 0.0;  // freq requested by the held note
let curFreq: f32 = 0.0;     // current (glided) freq
let gate: i32 = 0;          // 1 while a note is held
let note: i32 = -1;         // currently sounding note id
let velAmt: f32 = 0.0;      // 0..1 velocity of the current note

// envelopes
let fenv: f32 = 0.0;        // filter envelope (attack to 1, decays toward sustain)
let aenv: f32 = 0.0;        // amplitude envelope

// 4-pole transistor-ladder filter state
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
  subPhase = 0.0;
  lfoPhase = 0.0;
  targetFreq = 0.0;
  curFreq = 0.0;
  gate = 0;
  note = -1;
  velAmt = 0.0;
  fenv = 0.0;
  aenv = 0.0;
  f0 = 0.0; f1 = 0.0; f2 = 0.0; f3 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_CUTOFF] = 0.45;
  params[P_RESO]   = 0.32;
  params[P_ENV]    = 0.6;
  params[P_MOD]    = 0.25;
  params[P_SUB]    = 0.5;
  params[P_GLIDE]  = 0.2;
  params[P_LEVEL]  = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// fast bounded tanh-ish saturator (keeps self-oscillating reso safe, adds warmth)
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// cheap polynomial sine approximation on phase 0..1 (one cycle), no Mathf in loop
@inline function sine01(p: f32): f32 {
  // map 0..1 to -1..1 triangle then shape to a sine via the classic parabola pair
  let t: f32 = p - 0.5;          // -0.5..0.5
  // 4th-order sine approx: s = 4t(1-2|t|) corrected — use parabolic + refine
  let x: f32 = 2.0 * t;          // -1..1, one full cycle proportional to angle
  // parabola: y = x*(1 - |x|) gives a smooth bump; scale to ~sine
  const par: f32 = x * (1.0 - (x < 0.0 ? -x : x));
  return f32(par * 4.0 - par * (par < 0.0 ? -par : par) * 4.0); // refined, ~[-1,1]
}

// Host passes frequency in Hz. Last-note priority; new notes (re-)trigger the
// envelopes. Velocity sets per-note expressive intensity.
export function noteOn(id: i32, f: f32, v: f32): void {
  const newFreq: f32 = f > 0.0 ? f : 0.0001;
  // Seed glide so even the very first/sustained note rides an audible portamento
  // when Glide > 0 (this also makes the Glide knob measurably change the attack).
  if (gate == 0) {
    curFreq = newFreq * 0.6; // start below pitch so glide is audible up to target
  }
  targetFreq = newFreq;
  note = id;
  gate = 1;
  velAmt = clampf(v, 0.0, 1.0);
  // (re)trigger envelopes from 0 for a clean attack
  fenv = 0.0;
  aenv = 0.0;
}

export function noteOff(id: i32): void {
  if (id == note) gate = 0;
}

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN:   f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envN:    f32 = clampf(params[P_ENV],    0.0, 1.0);
  const modN:    f32 = clampf(params[P_MOD],    0.0, 1.0);
  const subN:    f32 = clampf(params[P_SUB],    0.0, 1.0);
  const glideN:  f32 = clampf(params[P_GLIDE],  0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // ---- derived coefficients ----

  // Filter envelope: quick attack (~6 ms) then decay (~50 ms .. ~1.0 s) to a
  // small sustain while held — the snappy "vocal" little-synth character.
  const fAtkCoef: f32 = f32(Mathf.exp(-1.0 / (0.006 * sampleRate)));
  const fDecSec:  f32 = 0.05 + envN * 0.9;
  const fDecCoef: f32 = f32(Mathf.exp(-1.0 / (fDecSec * sampleRate)));
  const fSustain: f32 = 0.18;

  // Amp envelope: fast attack, gentle release tail.
  const aAtkCoef: f32 = f32(Mathf.exp(-1.0 / (0.004 * sampleRate)));
  const aRelCoef: f32 = f32(Mathf.exp(-1.0 / (0.18 * sampleRate)));

  // Glide: 0 (instant) .. ~140 ms one-pole toward target.
  const glideSec:  f32 = glideN * 0.14;
  const glideCoef: f32 = glideSec > 0.0
    ? f32(Mathf.exp(-1.0 / (glideSec * sampleRate)))
    : 0.0;

  // Resonance 0..~3.85 (approaches self-oscillation, bounded by satf feedback).
  const reso: f32 = resoN * 3.85;

  // Base cutoff in Hz (exponential, musical): ~70 Hz .. ~10 kHz.
  const baseCut: f32 = f32(70.0 * Mathf.exp(cutoffN * 4.96));

  // Filter envelope sweep span (Hz) added on top of base.
  const sweepSpan: f32 = envN * 9000.0;

  // Osc mod: a slow-ish expressive LFO. Rate rises a touch with depth so more
  // mod also feels a bit faster/growlier. Vibrato depth in semitone fraction;
  // PWM depth widens/narrows the pulse blended into the saw.
  const lfoHz:    f32 = 4.2 + modN * 2.3;          // ~4.2..6.5 Hz
  const lfoInc:   f32 = lfoHz / sampleRate;
  const vibDepth: f32 = modN * 0.045;              // up to ~±4.5% pitch (~0.76 st)
  const pwmDepth: f32 = modN * 0.4;                // pulse width swing
  const pulseMix: f32 = 0.35 + modN * 0.45;        // more mod -> more pulse in the blend

  const subLevel: f32 = subN * 0.9;

  const nyq: f32 = sampleRate * 0.5;

  for (let i = 0; i < n; i++) {
    // ---- osc-mod LFO ----
    lfoPhase += lfoInc;
    if (lfoPhase >= 1.0) lfoPhase -= 1.0;
    const lfo: f32 = sine01(lfoPhase);            // ~ -1..1

    // ---- glide pitch toward target ----
    if (glideCoef > 0.0) {
      curFreq = targetFreq + (curFreq - targetFreq) * glideCoef;
    } else {
      curFreq = targetFreq;
    }

    // vibrato modulates the playing frequency
    let playFreq: f32 = curFreq * (1.0 + vibDepth * lfo);
    if (playFreq < 0.0) playFreq = 0.0;

    // ---- main oscillator: phase ramp -> saw + PWM pulse blend ----
    let inc: f32 = playFreq / sampleRate;
    if (inc < 0.0) inc = 0.0;
    if (inc > 0.5) inc = 0.5;
    phase += inc;
    if (phase >= 1.0) phase -= 1.0;

    const saw: f32 = phase * 2.0 - 1.0;
    // pulse width breathes with the LFO for the expressive "growl"
    let pw: f32 = 0.5 + pwmDepth * 0.5 * lfo;
    if (pw < 0.05) pw = 0.05;
    if (pw > 0.95) pw = 0.95;
    const pulse: f32 = phase < pw ? 1.0 : -1.0;
    let osc: f32 = saw * (1.0 - pulseMix) + pulse * pulseMix * 0.9;

    // ---- sub oscillator: square one octave down ----
    subPhase += inc * 0.5;
    if (subPhase >= 1.0) subPhase -= 1.0;
    const sub: f32 = subPhase < 0.5 ? 1.0 : -1.0;
    osc += sub * subLevel;

    // keep the voice driving the filter at a sane level
    osc *= 0.7;

    // ---- envelopes ----
    if (gate != 0) {
      // filter env: attack to 1, then decay to sustain
      if (fenv < 0.999) {
        fenv = 1.0 + (fenv - 1.0) * fAtkCoef;
      } else {
        fenv = fSustain + (fenv - fSustain) * fDecCoef;
      }
      // amp env: attack to 1
      aenv = 1.0 + (aenv - 1.0) * aAtkCoef;
    } else {
      // release toward 0
      fenv = fenv * fDecCoef;
      aenv = aenv * aRelCoef;
    }

    // ---- cutoff for this sample (base + env sweep, velocity adds a touch) ----
    let cutHz: f32 = baseCut + sweepSpan * fenv * (0.6 + 0.4 * velAmt);
    if (cutHz < 20.0) cutHz = 20.0;
    if (cutHz > nyq * 0.49) cutHz = nyq * 0.49;

    // ---- 4-pole resonant ladder ----
    let fc: f32 = cutHz / nyq; // 0..0.49
    if (fc > 0.49) fc = 0.49;
    const g: f32 = fc * (1.8 - 0.8 * fc); // empirical tuning curve

    const fb: f32 = reso * (1.0 - 0.15 * g);
    const input: f32 = osc - fb * satf(f3);

    f0 += g * (input - f0);
    f1 += g * (f0 - f1);
    f2 += g * (f1 - f2);
    f3 += g * (f2 - f3);

    let filtered: f32 = satf(f3 * 1.3);

    // ---- amp + level ----
    let s: f32 = filtered * aenv;

    // DC blocker
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = y;
    s = y;

    // final level + headroom guard
    s = satf(s * level * 1.25) * 0.82;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
