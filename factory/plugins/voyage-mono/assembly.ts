// =====================================================================
//  VOYAGE MONO — a modern, hi-fi mono synthesizer (modern-ladder lineage)
//
//  An original take on the modern transistor-ladder mono lead/bass voice:
//    * THREE fat oscillators, each a continuously variable saw<->pulse
//      blend, spread by a Detune control for a thick, beating unison.
//    * A 4-pole transistor-ladder filter wrapped in a DUAL-MODE blend:
//      Filter Mode morphs the ladder output from pure LOW-PASS, through a
//      spaced band-pass-like middle, toward a HIGH-PASS character — the
//      "dual filter" hallmark of the modern mono lineage, here as one knob.
//    * A snappy per-note filter+amp envelope with bipolar Env Amount,
//      portamento Glide, and a final hi-fi polish (tilt + soft limit).
//
//  Pure algorithm. No host imports. No allocation in process(). Every DSP
//  value is f32 (Mathf.* math, explicit f32() casts) and the signal chain
//  is gain-staged so the peak stays below ~1.0.
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
const P_CUTOFF:  i32 = 0;  // 0..1  -> base filter cutoff (exp)
const P_RES:     i32 = 1;  // 0..1  -> ladder resonance
const P_MODE:    i32 = 2;  // 0..1  -> LP (0) <-> HP (1) blend (dual-mode)
const P_ENVAMT:  i32 = 3;  // 0..1  -> filter envelope amount (0.5 = none, bipolar)
const P_DETUNE:  i32 = 4;  // 0..1  -> oscillator spread / fatness
const P_GLIDE:   i32 = 5;  // 0..1  -> portamento time
const P_LEVEL:   i32 = 6;  // 0..1  -> output level

// ---- engine state ----------------------------------------------------
let sampleRate: f32 = 48000.0;

// note / voice (last-note priority, monophonic)
let gate:     i32 = 0;
let note:     i32 = -1;
let vel:      f32 = 0.8;
let targetHz: f32 = 220.0;
let curHz:    f32 = 110.0;

// three oscillator phases (0..1)
let ph0: f32 = 0.0;
let ph1: f32 = 0.37;
let ph2: f32 = 0.71;

// amplitude envelope (snappy AD/AR with sustain)
let ampEnv:   f32 = 0.0;
let ampStage: i32 = 0;   // 0=idle 1=attack 2=decay/sustain 3=release

// filter envelope
let filtEnv:   f32 = 0.0;
let filtStage: i32 = 0;

// ladder filter state (4 cascaded one-pole stages)
let s0: f32 = 0.0;
let s1: f32 = 0.0;
let s2: f32 = 0.0;
let s3: f32 = 0.0;

// DC blocker
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

// hi-fi tilt high-pass state (for the HP side of the dual mode + polish)
let hpZ: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  gate = 0; note = -1; vel = 0.8;
  targetHz = 220.0; curHz = 110.0;
  ph0 = 0.0; ph1 = 0.37; ph2 = 0.71;
  ampEnv = 0.0; ampStage = 0;
  filtEnv = 0.0; filtStage = 0;
  s0 = 0.0; s1 = 0.0; s2 = 0.0; s3 = 0.0;
  dcX = 0.0; dcY = 0.0; hpZ = 0.0;

  params[P_CUTOFF]  = 0.55;
  params[P_RES]     = 0.45;
  params[P_MODE]    = 0.2;
  params[P_ENVAMT]  = 0.7;
  params[P_DETUNE]  = 0.3;
  params[P_GLIDE]   = 0.15;
  params[P_LEVEL]   = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

// Host passes frequency in Hz; last-note-priority monophonic.
export function noteOn(id: i32, f: f32, v: f32): void {
  note = id;
  targetHz = f > 1.0 ? f : 1.0;
  vel = v > 0.0 ? (v < 1.0 ? v : 1.0) : 0.0;
  if (gate == 0 && ampStage == 0) {
    curHz = targetHz * 0.5;   // first note glides up from below for audible portamento
  }
  gate = 1;
  ampStage = 1;
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

// PolyBLEP discontinuity correction — keeps saw/pulse smooth and analog.
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

// fast f32 tanh (rational Padé)
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

// One oscillator: continuously variable saw<->pulse blend at phase `ph`.
// `shape` 0 = pure saw, 1 = pure pulse(~50%). Band-limited via polyBLEP.
@inline function oscBlend(ph: f32, dt: f32, shape: f32): f32 {
  // band-limited saw
  let saw: f32 = 2.0 * ph - 1.0;
  saw -= polyBlep(ph, dt);
  // band-limited pulse (~45% duty)
  const duty: f32 = 0.45;
  let pw: f32 = ph < duty ? 1.0 : -1.0;
  pw += polyBlep(ph, dt);
  let ph2b: f32 = ph - duty; if (ph2b < 0.0) ph2b += 1.0;
  pw -= polyBlep(ph2b, dt);
  return saw * (1.0 - shape) + pw * shape;
}

export function process(n: i32): void {
  // ---- read + condition parameters ----
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resN:    f32 = clampf(params[P_RES], 0.0, 1.0);
  const modeN:   f32 = clampf(params[P_MODE], 0.0, 1.0);
  const envN:    f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const detune:  f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const glideN:  f32 = clampf(params[P_GLIDE], 0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // bipolar env amount: 0.5 = none, >0.5 opens, <0.5 closes
  const envAmt: f32 = (envN - 0.5) * 2.0;   // -1 .. +1

  // Snappy modern envelope: short attack, moderate decay, musical release.
  const attackT:  f32 = 0.002 + 0.02;          // ~22 ms — snappy
  const decayT:   f32 = 0.18;
  const releaseT: f32 = 0.12;
  const aCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (attackT * sampleRate)));
  const dCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (decayT * sampleRate)));
  const rCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (releaseT * sampleRate)));
  const sustain: f32 = 0.7;

  // Glide: 0 -> ~1 ms (instant), 1 -> ~0.5 s portamento.
  const glideT: f32 = 0.001 + glideN * glideN * 0.5;
  const glCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (glideT * sampleRate)));

  // Detune spread in cents -> ratios. osc1 down, osc2 up; osc0 reference.
  const cents: f32 = detune * 22.0;            // up to ~22 cents spread
  const det1: f32 = f32(Mathf.exp(-cents * 0.0005776227));  // 2^(-c/1200)
  const det2: f32 = f32(Mathf.exp( cents * 0.0005776227));

  // Oscillator shape: a touch of pulse for body, more as detune rises (fatter).
  const shape: f32 = 0.25 + detune * 0.2;

  // Resonance feedback amount (ladder). Kept below self-oscillation blowup.
  const reso: f32 = resN * 4.1;
  const resComp: f32 = 1.0 + 0.4 * resN;

  // Dual-mode crossover frequency for the HP side: as Mode rises, the
  // high-pass corner climbs, removing more lows so the voice shifts from
  // full-bodied LP toward an airy HP character.
  const hpHz: f32 = 40.0 * f32(Mathf.exp(modeN * 4.6));   // 40 .. ~4 kHz
  const hpG: f32 = clampf(TWOPI * hpHz / sampleRate, 0.0, 1.0);
  // Blend weight: 0 = all low-pass, 1 = all high-passed-ladder.
  const hpMix: f32 = modeN;

  const oscScale: f32 = 0.30;
  const outGain: f32 = level * 0.92;

  for (let f: i32 = 0; f < n; f++) {
    // ---- pitch glide ----
    curHz += glCoef * (targetHz - curHz);
    let hz: f32 = curHz;
    if (hz < 1.0) hz = 1.0;

    // ---- amplitude envelope ----
    if (ampStage == 1) {
      ampEnv += aCoef * (1.04 - ampEnv);
      if (ampEnv >= 0.999) { ampEnv = 1.0; ampStage = 2; }
    } else if (ampStage == 2) {
      ampEnv += dCoef * (sustain - ampEnv);
    } else if (ampStage == 3) {
      ampEnv += rCoef * (0.0 - ampEnv);
      if (ampEnv < 0.0001) { ampEnv = 0.0; ampStage = 0; }
    }

    // ---- filter envelope ----
    if (filtStage == 1) {
      filtEnv += aCoef * (1.04 - filtEnv);
      if (filtEnv >= 0.999) { filtEnv = 1.0; filtStage = 2; }
    } else if (filtStage == 2) {
      filtEnv += dCoef * (sustain - filtEnv);
    } else if (filtStage == 3) {
      filtEnv += rCoef * (0.0 - filtEnv);
      if (filtEnv < 0.0001) { filtEnv = 0.0; filtStage = 0; }
    }

    // ---- three oscillators ----
    const dt0: f32 = hz / sampleRate;
    const dt1: f32 = hz * det1 / sampleRate;
    const dt2: f32 = hz * det2 / sampleRate;

    ph0 += dt0; if (ph0 >= 1.0) ph0 -= 1.0;
    ph1 += dt1; if (ph1 >= 1.0) ph1 -= 1.0;
    ph2 += dt2; if (ph2 >= 1.0) ph2 -= 1.0;

    const o0: f32 = oscBlend(ph0, dt0, shape);
    const o1: f32 = oscBlend(ph1, dt1, shape);
    const o2: f32 = oscBlend(ph2, dt2, shape);

    let oscMix: f32 = (o0 + o1 + o2) * oscScale * resComp;

    // ---- cutoff from base + bipolar filter envelope ----
    let cutCtl: f32 = cutoffN + envAmt * filtEnv;
    cutCtl = clampf(cutCtl, 0.0, 1.0);
    let fc: f32 = 30.0 * f32(Mathf.exp(cutCtl * 6.55));   // 30 .. ~16k
    const nyq: f32 = sampleRate * 0.49;
    if (fc > nyq) fc = nyq;
    if (fc < 20.0) fc = 20.0;

    // ladder one-pole coefficient (mild pre-warp)
    let g: f32 = TWOPI * fc / sampleRate;
    if (g > 1.0) g = 1.0;
    const gc: f32 = g * (1.0 - 0.5 * g);

    // ---- 4-pole ladder with tanh saturation in the feedback loop ----
    let input: f32 = oscMix - reso * s3;
    input = tanhf(input);
    s0 += gc * (input - s0);
    s1 += gc * (s0 - s1);
    s2 += gc * (s1 - s2);
    s3 += gc * (s2 - s3);
    let lp: f32 = s3;

    // ---- DUAL-MODE blend: LP <-> spaced HP ----
    // High-pass side = ladder-filtered signal minus a slow low-pass of it,
    // so the HP corner is a SEPARATE, higher-frequency band than the LP knee.
    // This creates the spaced dual-filter character (LP feeds a HP stage).
    hpZ += hpG * (lp - hpZ);
    let hp: f32 = lp - hpZ;
    // crossfade LP -> HP as Mode goes 0 -> 1
    let filt: f32 = lp * (1.0 - hpMix) + hp * (1.0 + 0.4 * resN) * hpMix;

    // ---- amplitude ----
    let voice: f32 = filt * ampEnv * vel;

    // DC blocker
    let y: f32 = voice - dcX + 0.9975 * dcY;
    dcX = voice;
    dcY = y;

    // hi-fi polish: gentle soft limit, then scale by Level.
    let outS: f32 = tanhf(y * 1.05) * outGain;
    if (outS > 1.0) outS = 1.0;
    if (outS < -1.0) outS = -1.0;

    outBuf[f] = outS;                 // left
    outBuf[MAX_FRAMES + f] = outS;    // right (mono synth)
  }
}
