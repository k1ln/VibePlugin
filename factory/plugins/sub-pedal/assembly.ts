// =====================================================================
//  SUB PEDAL — deep sub-bass organ-pedal synthesizer (original model)
//
//  A dedicated, floor-rumbling monophonic bass voice in the lineage of the
//  classic wooden foot-pedal "taurus" bass synths. Built to be HUGE and
//  simple — pure earth-shaking root notes:
//
//    * Two stacked main oscillators (sawtooth + square), tuned LOW.
//    * A thick SQUARE SUB an octave below for chest-thumping weight.
//    * A fat 4-pole Moog-style transistor-ladder low-pass with tanh
//      saturation in the feedback loop and a SLOW filter envelope.
//    * Portamento / glide between notes (mono, last-note priority).
//    * A punchy amplitude envelope.
//    * A warm overdrive stage that adds low-end weight and harmonics.
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
const P_CUTOFF: i32 = 0;  // 0..1 -> base filter cutoff (sweeps the low rumble open)
const P_RES:    i32 = 1;  // 0..1 -> ladder resonance
const P_SUB:    i32 = 2;  // 0..1 -> sub-octave square level / weight
const P_GLIDE:  i32 = 3;  // 0..1 -> portamento time
const P_DECAY:  i32 = 4;  // 0..1 -> amp + filter decay/release time
const P_DRIVE:  i32 = 5;  // 0..1 -> warm overdrive amount
const P_LEVEL:  i32 = 6;  // 0..1 -> output level

// ---- engine state ----------------------------------------------------
let sampleRate: f32 = 48000.0;

// note / voice (mono, last-note priority)
let gate:     i32 = 0;     // 1 while a key is held
let note:     i32 = -1;    // currently sounding note id
let vel:      f32 = 0.9;   // velocity of the active note (0..1)
let targetHz: f32 = 55.0;  // pitch we are gliding toward
let curHz:    f32 = 41.2;  // current (glided) pitch

// oscillator phases (0..1)
let phSaw: f32 = 0.0;   // main saw
let phSqr: f32 = 0.25;  // main square
let phSub: f32 = 0.5;   // sub-octave square

// amplitude envelope
let ampEnv:   f32 = 0.0;
let ampStage: i32 = 0;     // 0=idle 1=attack 2=sustain 3=release

// filter envelope (slow)
let filtEnv:   f32 = 0.0;
let filtStage: i32 = 0;

// ladder filter state (4 cascaded one-pole stages)
let s0: f32 = 0.0;
let s1: f32 = 0.0;
let s2: f32 = 0.0;
let s3: f32 = 0.0;

// DC blocker on the output (essential for sub content)
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  gate = 0; note = -1; vel = 0.9;
  targetHz = 55.0; curHz = 41.2;
  phSaw = 0.0; phSqr = 0.25; phSub = 0.5;
  ampEnv = 0.0; ampStage = 0;
  filtEnv = 0.0; filtStage = 0;
  s0 = 0.0; s1 = 0.0; s2 = 0.0; s3 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_CUTOFF] = 0.40;
  params[P_RES]    = 0.30;
  params[P_SUB]    = 0.70;
  params[P_GLIDE]  = 0.30;
  params[P_DECAY]  = 0.45;
  params[P_DRIVE]  = 0.35;
  params[P_LEVEL]  = 0.80;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

// Host passes frequency in Hz; mono, last-note priority. Bass register: clamp
// the pitch LOW so the voice always tracks down into the sub range.
export function noteOn(id: i32, f: f32, v: f32): void {
  note = id;
  let hz: f32 = f > 1.0 ? f : 1.0;
  // Fold anything above ~165 Hz (E3) down by octaves — a pure bass pedal voice.
  while (hz > 165.0) hz = hz * 0.5;
  if (hz < 16.0) hz = 16.0;
  targetHz = hz;
  vel = v > 0.0 ? (v < 1.0 ? v : 1.0) : 0.0;
  if (gate == 0 && ampStage == 0) {
    curHz = targetHz * 0.5;   // first note: glide up from below
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

// PolyBLEP anti-aliasing correction at phase discontinuities.
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

// fast f32 tanh approximation (rational Padé), stays in f32.
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

export function process(n: i32): void {
  // ---- read + condition parameters ----
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resN:    f32 = clampf(params[P_RES], 0.0, 1.0);
  const subN:    f32 = clampf(params[P_SUB], 0.0, 1.0);
  const glideN:  f32 = clampf(params[P_GLIDE], 0.0, 1.0);
  const decayN:  f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const driveN:  f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // Envelopes: punchy fixed attack, decay/release tied to Decay knob.
  const attackT:  f32 = 0.004;                      // ~4 ms punch
  const decayT:   f32 = 0.05 + decayN * decayN * 2.5;  // 50 ms .. ~2.5 s
  const releaseT: f32 = 0.04 + decayN * decayN * 2.0;  // tail
  const aCoef: f32 = 1.0 - Mathf.exp(-1.0 / (attackT * sampleRate));
  const dCoef: f32 = 1.0 - Mathf.exp(-1.0 / (decayT * sampleRate));
  const rCoef: f32 = 1.0 - Mathf.exp(-1.0 / (releaseT * sampleRate));
  const sustain: f32 = 0.78;   // bass sits high & sustained

  // Slow filter envelope — a separate, deliberately sluggish sweep.
  const fAttackT: f32 = 0.03 + decayN * 0.20;        // slow open
  const fDecayT:  f32 = 0.20 + decayN * decayN * 3.0;
  const faCoef: f32 = 1.0 - Mathf.exp(-1.0 / (fAttackT * sampleRate));
  const fdCoef: f32 = 1.0 - Mathf.exp(-1.0 / (fDecayT * sampleRate));
  const fSustain: f32 = 0.45;

  // Glide: 0 -> ~1 ms (instant), 1 -> ~0.5 s portamento.
  const glideT: f32 = 0.001 + glideN * glideN * 0.5;
  const glCoef: f32 = 1.0 - Mathf.exp(-1.0 / (glideT * sampleRate));

  // Sub weight (square an octave down).
  const subLvl: f32 = subN * 1.15;

  // Resonance feedback (kept below self-oscillation blowup).
  const reso: f32 = resN * 4.0;
  const resComp: f32 = 1.0 + 0.4 * resN;

  // Warm overdrive: pre-gain into tanh, with makeup so it stays controlled.
  const drive: f32 = 1.0 + driveN * driveN * 9.0;     // 1 .. 10x
  const driveComp: f32 = 1.0 / (1.0 + driveN * 1.6);  // tame loudness

  // Output trim.
  const oscScale: f32 = 0.42;
  const outGain: f32 = level * 0.95;

  const nyq: f32 = sampleRate * 0.49;

  for (let f: i32 = 0; f < n; f++) {
    // ---- pitch glide ----
    curHz += glCoef * (targetHz - curHz);
    let hz: f32 = curHz;
    if (hz < 16.0) hz = 16.0;

    // ---- amplitude envelope ----
    if (ampStage == 1) {
      ampEnv += aCoef * (1.02 - ampEnv);
      if (ampEnv >= 0.999) { ampEnv = 1.0; ampStage = 2; }
    } else if (ampStage == 2) {
      ampEnv += dCoef * (sustain - ampEnv);
    } else if (ampStage == 3) {
      ampEnv += rCoef * (0.0 - ampEnv);
      if (ampEnv < 0.0001) { ampEnv = 0.0; ampStage = 0; }
    }

    // ---- slow filter envelope ----
    if (filtStage == 1) {
      filtEnv += faCoef * (1.02 - filtEnv);
      if (filtEnv >= 0.999) { filtEnv = 1.0; filtStage = 2; }
    } else if (filtStage == 2) {
      filtEnv += fdCoef * (fSustain - filtEnv);
    } else if (filtStage == 3) {
      filtEnv += fdCoef * (0.0 - filtEnv);
      if (filtEnv < 0.0001) { filtEnv = 0.0; filtStage = 0; }
    }

    // ---- oscillators (all tuned LOW) ----
    const dtSaw: f32 = hz / sampleRate;
    const dtSqr: f32 = hz / sampleRate;
    const subHz: f32 = hz * 0.5;                  // one octave down
    const dtSub: f32 = subHz / sampleRate;

    phSaw += dtSaw; if (phSaw >= 1.0) phSaw -= 1.0;
    phSqr += dtSqr; if (phSqr >= 1.0) phSqr -= 1.0;
    phSub += dtSub; if (phSub >= 1.0) phSub -= 1.0;

    // main band-limited saw
    let saw: f32 = 2.0 * phSaw - 1.0;
    saw -= polyBlep(phSaw, dtSaw);

    // main band-limited square (50% duty)
    let sqr: f32 = phSqr < 0.5 ? 1.0 : -1.0;
    sqr += polyBlep(phSqr, dtSqr);
    let phSqr2: f32 = phSqr - 0.5; if (phSqr2 < 0.0) phSqr2 += 1.0;
    sqr -= polyBlep(phSqr2, dtSqr);

    // sub-octave band-limited square
    let sub: f32 = phSub < 0.5 ? 1.0 : -1.0;
    sub += polyBlep(phSub, dtSub);
    let phSub2: f32 = phSub - 0.5; if (phSub2 < 0.0) phSub2 += 1.0;
    sub -= polyBlep(phSub2, dtSub);

    let oscMix: f32 = (saw * 0.85 + sqr * 0.55 + sub * subLvl) * oscScale;
    oscMix *= resComp;

    // ---- cutoff from base + slow filter envelope ----
    // map to a LOW range so the rumble lives in the bass: ~25 Hz .. ~4 kHz.
    let cutCtl: f32 = cutoffN + 0.55 * filtEnv;
    cutCtl = clampf(cutCtl, 0.0, 1.0);
    let fc: f32 = 25.0 * Mathf.exp(cutCtl * 5.08);   // 25 .. ~4k Hz
    if (fc > nyq) fc = nyq;
    if (fc < 18.0) fc = 18.0;

    let g: f32 = TWOPI * fc / sampleRate;
    if (g > 1.0) g = 1.0;
    const gc: f32 = g * (1.0 - 0.5 * g);

    // ---- 4-pole ladder with tanh saturation in the feedback loop ----
    let fbIn: f32 = oscMix - reso * s3;
    fbIn = tanhf(fbIn);
    s0 += gc * (fbIn - s0);
    s1 += gc * (s0 - s1);
    s2 += gc * (s1 - s2);
    s3 += gc * (s2 - s3);
    let lp: f32 = s3;

    // ---- warm overdrive (adds low-end weight + harmonics) ----
    let driven: f32 = tanhf(lp * drive) * driveComp;

    // ---- amplitude ----
    let voice: f32 = driven * ampEnv * vel;

    // DC blocker (R ~ 0.9975) — crucial for clean sub.
    let y: f32 = voice - dcX + 0.9975 * dcY;
    dcX = voice;
    dcY = y;

    let outS: f32 = y * outGain;
    if (outS > 1.0) outS = 1.0;
    if (outS < -1.0) outS = -1.0;

    outBuf[f] = outS;                 // left
    outBuf[MAX_FRAMES + f] = outS;    // right (mono synth)
  }
}
