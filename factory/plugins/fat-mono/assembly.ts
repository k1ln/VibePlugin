// =====================================================================
//  FAT MONO — fat monophonic analog-style synthesizer (original model)
//
//  Behaviour modelled on a classic 3-oscillator transistor-ladder mono synth:
//    * 3 detuned oscillators (two sawtooth + one pulse), summed thick.
//    * A 4-pole resonant transistor-ladder low-pass with tanh saturation
//      inside the feedback loop (the source of the warm, singing character).
//    * A dedicated filter ADSR (with bipolar amount) that sweeps the cutoff
//      on every note, plus a separate amplitude ADSR.
//    * Last-note-priority monophonic voice with portamento / glide.
//
//  Pure algorithm, no host imports, no allocation in process(). Every DSP
//  value is f32 (Mathf.* math) and the output is gain-staged to stay < 1.0.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI:    f32 = 3.14159265358979;
const TWOPI: f32 = 6.28318530717959;

// ---- parameter indices ----------------------------------------------
const P_DETUNE:  i32 = 0;  // 0..1  -> oscillator spread (fatness)
const P_CUTOFF:  i32 = 1;  // 0..1  -> base filter cutoff
const P_RES:     i32 = 2;  // 0..1  -> ladder resonance
const P_ENVAMT:  i32 = 3;  // 0..1  -> filter envelope amount
const P_ATTACK:  i32 = 4;  // 0..1  -> attack time (both envelopes)
const P_RELEASE: i32 = 5;  // 0..1  -> release time (both envelopes)
const P_GLIDE:   i32 = 6;  // 0..1  -> portamento time
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- engine state ----------------------------------------------------
let sampleRate: f32 = 48000.0;

// note / voice
let gate:     i32 = 0;     // 1 while a key is held
let note:     i32 = -1;    // currently sounding note id (last-note priority)
let vel:      f32 = 0.8;   // velocity of the active note (0..1)
let targetHz: f32 = 220.0; // pitch we are gliding toward
let curHz:    f32 = 110.0; // current (glided) pitch, starts low so glide is audible

// three oscillator phases (0..1)
let ph0: f32 = 0.0;
let ph1: f32 = 0.33;
let ph2: f32 = 0.66;

// amplitude envelope
let ampEnv:   f32 = 0.0;
let ampStage: i32 = 0;     // 0=idle 1=attack 2=sustain 3=release

// filter envelope
let filtEnv:   f32 = 0.0;
let filtStage: i32 = 0;

// ladder filter state (4 cascaded one-pole stages)
let s0: f32 = 0.0;
let s1: f32 = 0.0;
let s2: f32 = 0.0;
let s3: f32 = 0.0;

// gentle DC blocker on the output
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  gate = 0; note = -1; vel = 0.8;
  targetHz = 220.0; curHz = 110.0;
  ph0 = 0.0; ph1 = 0.33; ph2 = 0.66;
  ampEnv = 0.0; ampStage = 0;
  filtEnv = 0.0; filtStage = 0;
  s0 = 0.0; s1 = 0.0; s2 = 0.0; s3 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_DETUNE]  = 0.35;
  params[P_CUTOFF]  = 0.45;
  params[P_RES]     = 0.55;
  params[P_ENVAMT]  = 0.7;
  params[P_ATTACK]  = 0.08;
  params[P_RELEASE] = 0.3;
  params[P_GLIDE]   = 0.25;
  params[P_LEVEL]   = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

// Host passes frequency in Hz; last-note-priority monophonic.
export function noteOn(id: i32, f: f32, v: f32): void {
  note = id;
  targetHz = f > 1.0 ? f : 1.0;
  vel = v > 0.0 ? (v < 1.0 ? v : 1.0) : 0.0;
  // If the voice was silent, restart pitch from a slightly low value so the
  // very first note still exhibits an audible glide; otherwise glide from the
  // pitch we were already at (legato portamento).
  if (gate == 0 && ampStage == 0) {
    curHz = targetHz * 0.5;
  }
  gate = 1;
  ampStage = 1;   // (re)trigger attack
  filtStage = 1;
}

export function noteOff(id: i32): void {
  if (id == note) {
    gate = 0;
    ampStage = 3;
    filtStage = 3;
  }
}

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// One-pole "PolyBLEP" correction term to tame naive-saw/pulse aliasing at the
// discontinuity — keeps the tone smooth and analog rather than buzzy/digital.
@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) {
    let x: f32 = t / dt;
    return x + x - x * x - 1.0;
  } else if (t > 1.0 - dt) {
    let x: f32 = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

export function process(n: i32): void {
  // ---- read + condition parameters ----
  const detune:  f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resN:    f32 = clampf(params[P_RES], 0.0, 1.0);
  const envAmt:  f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const attackN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const releaseN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const glideN:  f32 = clampf(params[P_GLIDE], 0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // Envelope rates: convert 0..1 into per-sample one-pole coefficients.
  // attack 2 ms .. 1.5 s ; release 8 ms .. 3 s ; decay tied to release-ish.
  const attackT:  f32 = 0.002 + attackN * attackN * 1.5;
  const releaseT: f32 = 0.008 + releaseN * releaseN * 3.0;
  const decayT:   f32 = 0.06 + releaseN * 1.2;     // filter/amp decay to sustain
  const aCoef: f32 = 1.0 - Mathf.exp(-1.0 / (attackT * sampleRate));
  const rCoef: f32 = 1.0 - Mathf.exp(-1.0 / (releaseT * sampleRate));
  const dCoef: f32 = 1.0 - Mathf.exp(-1.0 / (decayT * sampleRate));
  const sustain: f32 = 0.65;   // sustain level for both envelopes

  // Glide: 0 -> ~1 ms (instant), 1 -> ~0.6 s portamento.
  const glideT: f32 = 0.001 + glideN * glideN * 0.6;
  const glCoef: f32 = 1.0 - Mathf.exp(-1.0 / (glideT * sampleRate));

  // Detune spread in cents -> ratio. osc1 down, osc2 up; osc0 reference.
  const cents: f32 = detune * 18.0;                 // up to ~18 cents
  const det1: f32 = Mathf.exp(-cents * 0.0005776227);  // 2^(-c/1200)
  const det2: f32 = Mathf.exp( cents * 0.0005776227);
  // sub-style third oscillator one octave-ish, lightly detuned for body
  const det2b: f32 = det2 * 0.5;

  // Resonance feedback amount (ladder). Keep below self-oscillation blowup.
  const reso: f32 = resN * 4.2;
  // Resonance robs low end; compensate input gain a touch as reso rises.
  const resComp: f32 = 1.0 + 0.5 * resN;

  // Output trim. Three oscillators summed → scale down, then user Level.
  const oscScale: f32 = 0.32;
  const outGain: f32 = level * 0.9;

  for (let f: i32 = 0; f < n; f++) {
    // ---- pitch glide ----
    curHz += glCoef * (targetHz - curHz);
    let hz: f32 = curHz;
    if (hz < 1.0) hz = 1.0;

    // ---- amplitude envelope ----
    if (ampStage == 1) {                 // attack -> 1.0
      ampEnv += aCoef * (1.02 - ampEnv);
      if (ampEnv >= 0.999) { ampEnv = 1.0; ampStage = 2; }
    } else if (ampStage == 2) {          // decay toward sustain (held)
      ampEnv += dCoef * (sustain - ampEnv);
    } else if (ampStage == 3) {          // release -> 0
      ampEnv += rCoef * (0.0 - ampEnv);
      if (ampEnv < 0.0001) { ampEnv = 0.0; ampStage = 0; }
    }

    // ---- filter envelope (same shape, separate state) ----
    if (filtStage == 1) {
      filtEnv += aCoef * (1.02 - filtEnv);
      if (filtEnv >= 0.999) { filtEnv = 1.0; filtStage = 2; }
    } else if (filtStage == 2) {
      filtEnv += dCoef * (sustain - filtEnv);
    } else if (filtStage == 3) {
      filtEnv += rCoef * (0.0 - filtEnv);
      if (filtEnv < 0.0001) { filtEnv = 0.0; filtStage = 0; }
    }

    // ---- oscillators ----
    const dt0: f32 = hz / sampleRate;
    const dt1: f32 = hz * det1 / sampleRate;
    const dt2: f32 = hz * det2b / sampleRate;

    ph0 += dt0; if (ph0 >= 1.0) ph0 -= 1.0;
    ph1 += dt1; if (ph1 >= 1.0) ph1 -= 1.0;
    ph2 += dt2; if (ph2 >= 1.0) ph2 -= 1.0;

    // osc0: band-limited saw
    let saw0: f32 = 2.0 * ph0 - 1.0;
    saw0 -= polyBlep(ph0, dt0);
    // osc1: band-limited saw (detuned for fatness)
    let saw1: f32 = 2.0 * ph1 - 1.0;
    saw1 -= polyBlep(ph1, dt1);
    // osc2: band-limited pulse (~30% duty) one octave down for weight
    const duty: f32 = 0.3;
    let pw: f32 = ph2 < duty ? 1.0 : -1.0;
    pw += polyBlep(ph2, dt2);
    let ph2b: f32 = ph2 - duty; if (ph2b < 0.0) ph2b += 1.0;
    pw -= polyBlep(ph2b, dt2);

    let oscMix: f32 = (saw0 + saw1 * 0.9 + pw * 0.7) * oscScale;
    oscMix *= resComp;

    // ---- cutoff from base + filter envelope ----
    // map cutoffN exponentially to ~30 Hz .. ~16 kHz, add env sweep.
    let cutCtl: f32 = cutoffN + envAmt * filtEnv;
    cutCtl = clampf(cutCtl, 0.0, 1.0);
    let fc: f32 = 30.0 * Mathf.exp(cutCtl * 6.55);      // 30 .. ~16k
    const nyq: f32 = sampleRate * 0.49;
    if (fc > nyq) fc = nyq;
    if (fc < 20.0) fc = 20.0;

    // transistor-ladder one-pole coefficient
    let g: f32 = TWOPI * fc / sampleRate;
    if (g > 1.0) g = 1.0;
    const gc: f32 = g * (1.0 - 0.5 * g);   // mild freq pre-warp

    // ---- 4-pole ladder with tanh saturation in the loop ----
    // feedback from last stage, scaled by resonance
    let input: f32 = oscMix - reso * s3;
    // tanh drive in the loop gives the warm, compressing analog character
    input = tanhf(input);
    s0 += gc * (input - s0);
    s1 += gc * (s0 - s1);
    s2 += gc * (s1 - s2);
    s3 += gc * (s2 - s3);
    let lp: f32 = s3;

    // ---- amplitude ----
    let voice: f32 = lp * ampEnv * vel;

    // DC blocker (R ~ 0.995)
    let y: f32 = voice - dcX + 0.9975 * dcY;
    dcX = voice;
    dcY = y;

    let outS: f32 = tanhf(y * 1.1) * outGain;   // gentle final saturation/limit
    if (outS > 1.0) outS = 1.0;
    if (outS < -1.0) outS = -1.0;

    outBuf[f] = outS;                 // left
    outBuf[MAX_FRAMES + f] = outS;    // right (mono synth)
  }
}

// fast f32 tanh approximation (rational Padé), stays in f32 the whole way.
@inline function tanhf(x: f32): f32 {
  let v: f32 = x;
  if (v > 4.0) return 1.0;
  if (v < -4.0) return -1.0;
  const x2: f32 = v * v;
  const num: f32 = v * (135135.0 + x2 * (17325.0 + x2 * (378.0 + x2)));
  const den: f32 = 135135.0 + x2 * (62370.0 + x2 * (3150.0 + x2 * 28.0));
  let r: f32 = num / den;
  if (r > 1.0) r = 1.0;
  if (r < -1.0) r = -1.0;
  return r;
}
