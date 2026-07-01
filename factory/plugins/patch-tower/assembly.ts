// =====================================================================
//  PATCH TOWER — colossal three-oscillator semi-modular mono synth
//
//  An original instrument in the lineage of the great modular tower
//  systems: three big detuned oscillators (band-limited saw / pulse /
//  triangle, blended thick), a white-noise source, hard oscillator SYNC
//  (osc2 -> osc1), and a fat 4-pole transistor-ladder low-pass with tanh
//  saturation in its feedback loop and its OWN sweeping envelope. A
//  last-note-priority monophonic voice with portamento glide and a grand,
//  towering output character.
//
//  Distinct from a Minimoog-style "Fat Mono": this is bigger and more
//  modular — three full-range oscillators (not a sub), a triangle voice,
//  hard sync, a dedicated noise channel and a regal, slightly overdriven
//  master stage.
//
//  Pure algorithm. No host imports. No allocation in process(). Every DSP
//  value is f32 (Mathf.* math, explicit f32() casts). Output is gain-staged
//  to stay below 1.0.
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
const P_CUTOFF: i32 = 0;  // 0..1  -> base ladder cutoff
const P_RES:    i32 = 1;  // 0..1  -> ladder resonance
const P_ENVAMT: i32 = 2;  // 0..1  -> filter envelope sweep amount
const P_DETUNE: i32 = 3;  // 0..1  -> 3-osc spread / fatness
const P_SYNC:   i32 = 4;  // 0..1  -> hard oscillator sync depth (osc2->osc1)
const P_NOISE:  i32 = 5;  // 0..1  -> white-noise blend
const P_GLIDE:  i32 = 6;  // 0..1  -> portamento time
const P_LEVEL:  i32 = 7;  // 0..1  -> master output level

// ---- engine state ----------------------------------------------------
let sampleRate: f32 = 48000.0;

// note / voice (last-note priority, monophonic)
let gate:     i32 = 0;
let note:     i32 = -1;
let vel:      f32 = 0.8;
let targetHz: f32 = 220.0;
let curHz:    f32 = 110.0;

// three oscillator phases (0..1)
let ph0: f32 = 0.0;   // saw   (reference)
let ph1: f32 = 0.27;  // pulse (sync slave)
let ph2: f32 = 0.61;  // triangle / sync master

// amplitude envelope (ADSR-ish, one-pole segments)
let ampEnv:   f32 = 0.0;
let ampStage: i32 = 0;   // 0 idle 1 attack 2 decay/sustain 3 release

// filter envelope (separate state)
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

// white-noise rng (xorshift32, deterministic)
let rngState: u32 = 0x9e3779b9;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  gate = 0; note = -1; vel = 0.8;
  targetHz = 220.0; curHz = 110.0;
  ph0 = 0.0; ph1 = 0.27; ph2 = 0.61;
  ampEnv = 0.0; ampStage = 0;
  filtEnv = 0.0; filtStage = 0;
  s0 = 0.0; s1 = 0.0; s2 = 0.0; s3 = 0.0;
  dcX = 0.0; dcY = 0.0;
  rngState = 0x9e3779b9;

  params[P_CUTOFF] = 0.42;
  params[P_RES]    = 0.5;
  params[P_ENVAMT] = 0.65;
  params[P_DETUNE] = 0.4;
  params[P_SYNC]   = 0.25;
  params[P_NOISE]  = 0.15;
  params[P_GLIDE]  = 0.2;
  params[P_LEVEL]  = 0.7;
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
  if (gate == 0 && ampStage == 0) {
    curHz = targetHz * 0.5;   // audible glide on the first note
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

// One-pole PolyBLEP correction to tame naive-saw / pulse aliasing.
@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) {
    const x: f32 = t / dt;
    return x + x - x * x - 1.0;
  } else if (t > 1.0 - dt) {
    const x: f32 = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

// white noise in [-1,1]
@inline function noiseSample(): f32 {
  let x: u32 = rngState;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  rngState = x;
  return f32(x) * f32(2.3283064e-10) * 2.0 - 1.0; // x/2^32*2-1
}

// fast f32 tanh approximation (rational Padé), all f32.
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
  const resN:    f32 = clampf(params[P_RES],    0.0, 1.0);
  const envAmt:  f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const detune:  f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const syncN:   f32 = clampf(params[P_SYNC],   0.0, 1.0);
  const noiseN:  f32 = clampf(params[P_NOISE],  0.0, 1.0);
  const glideN:  f32 = clampf(params[P_GLIDE],  0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // Envelopes: fixed-ish musical times so the dedicated filter sweep sings.
  const attackT:  f32 = 0.012;
  const decayT:   f32 = 0.35;
  const releaseT: f32 = 0.45;
  const aCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (attackT  * sampleRate)));
  const dCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (decayT   * sampleRate)));
  const rCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (releaseT * sampleRate)));
  const sustain: f32 = 0.6;

  // Glide: 0 -> ~1 ms ; 1 -> ~0.6 s
  const glideT: f32 = 0.001 + glideN * glideN * 0.6;
  const glCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (glideT * sampleRate)));

  // Detune spread (cents) -> ratios. osc1 sharp, osc2 flat for a wide stack.
  const cents: f32 = detune * 22.0;                       // up to ~22 cents
  const det1: f32 = f32(Mathf.exp( cents * 0.0005776227)); // 2^(+c/1200)
  const det2: f32 = f32(Mathf.exp(-cents * 0.0005776227)); // 2^(-c/1200)

  // Sync: how strongly osc2 (master) hard-resets osc1 (slave). At 0 the two
  // run free (just detuned); as it rises the slave is forced to the master's
  // period, giving the classic metallic sweep.
  const syncAmt: f32 = syncN;
  // sync master is pitched up so the reset sweep is dramatic
  const syncRatio: f32 = 1.0 + syncN * 1.5;               // 1.0 .. 2.5x

  // Noise blend (equal-ish power so the tonal core stays present).
  const noiseGain: f32 = noiseN * 0.9;
  const oscBlend:  f32 = 1.0 - 0.4 * noiseN;

  // Resonance feedback (kept below blow-up) + low-end compensation.
  const reso: f32 = resN * 4.3;
  const resComp: f32 = 1.0 + 0.55 * resN;

  // Output trim: three oscillators + noise summed -> scale, then user Level.
  const oscScale: f32 = 0.26;
  const outGain: f32 = 0.2 + level * 0.85;

  for (let f: i32 = 0; f < n; f++) {
    // ---- pitch glide ----
    curHz += glCoef * (targetHz - curHz);
    let hz: f32 = curHz;
    if (hz < 1.0) hz = 1.0;

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

    // ---- filter envelope ----
    if (filtStage == 1) {
      filtEnv += aCoef * (1.02 - filtEnv);
      if (filtEnv >= 0.999) { filtEnv = 1.0; filtStage = 2; }
    } else if (filtStage == 2) {
      filtEnv += dCoef * (sustain - filtEnv);
    } else if (filtStage == 3) {
      filtEnv += rCoef * (0.0 - filtEnv);
      if (filtEnv < 0.0001) { filtEnv = 0.0; filtStage = 0; }
    }

    // ---- oscillator phase increments ----
    const dt0: f32 = hz / sampleRate;
    const dt1: f32 = hz * det1 / sampleRate;
    const dt2: f32 = hz * det2 * syncRatio / sampleRate;

    // advance phases
    ph0 += dt0; if (ph0 >= 1.0) ph0 -= 1.0;

    // osc2 is the SYNC master / triangle voice
    ph2 += dt2;
    let masterWrap: bool = false;
    if (ph2 >= 1.0) { ph2 -= 1.0; masterWrap = true; }

    // osc1 is the sync slave (pulse). Advance, then if the master wrapped and
    // sync is engaged, hard-reset the slave phase proportionally to depth.
    ph1 += dt1; if (ph1 >= 1.0) ph1 -= 1.0;
    if (masterWrap && syncAmt > 0.0) {
      // blend between free phase and a hard reset to 0 by the sync amount
      ph1 = ph1 * (1.0 - syncAmt);
      if (ph1 < 0.0) ph1 = 0.0;
    }

    // osc0: band-limited saw
    let saw0: f32 = 2.0 * ph0 - 1.0;
    saw0 -= polyBlep(ph0, dt0);

    // osc1: band-limited pulse (~45% duty), the sync slave
    const duty: f32 = 0.45;
    let pul1: f32 = ph1 < duty ? 1.0 : -1.0;
    pul1 += polyBlep(ph1, dt1);
    let ph1b: f32 = ph1 - duty; if (ph1b < 0.0) ph1b += 1.0;
    pul1 -= polyBlep(ph1b, dt1);

    // osc2: triangle (integrated, smooth) — adds body without harsh edges
    let tri2: f32 = 4.0 * Mathf.abs(ph2 - 0.5) - 1.0;   // -1..1 triangle

    // ---- blend the three oscillators ----
    let osc: f32 = (saw0 * 1.0 + pul1 * 0.85 + tri2 * 0.8) * oscScale;

    // ---- noise channel ----
    const nz: f32 = noiseSample();
    let mix: f32 = osc * oscBlend + nz * noiseGain * oscScale * 1.4;
    mix *= resComp;

    // ---- cutoff from base + filter envelope ----
    let cutCtl: f32 = cutoffN + envAmt * filtEnv;
    cutCtl = clampf(cutCtl, 0.0, 1.0);
    let fc: f32 = f32(28.0 * Mathf.exp(cutCtl * 6.6));   // ~28 Hz .. ~20 kHz
    const nyq: f32 = sampleRate * 0.49;
    if (fc > nyq) fc = nyq;
    if (fc < 20.0) fc = 20.0;

    // transistor-ladder one-pole coefficient (mild pre-warp)
    let g: f32 = TWOPI * fc / sampleRate;
    if (g > 1.0) g = 1.0;
    const gc: f32 = g * (1.0 - 0.5 * g);

    // ---- 4-pole ladder with tanh saturation in the feedback loop ----
    let drive: f32 = mix - reso * s3;
    drive = tanhf(drive);
    s0 += gc * (drive - s0);
    s1 += gc * (s0 - s1);
    s2 += gc * (s1 - s2);
    s3 += gc * (s2 - s3);
    const lp: f32 = s3;

    // ---- amplitude + master ----
    let voice: f32 = lp * ampEnv * vel;

    // DC blocker
    const y: f32 = voice - dcX + 0.9975 * dcY;
    dcX = voice;
    dcY = y;

    // grand, slightly overdriven master stage
    let outS: f32 = tanhf(y * 1.25) * outGain;
    if (outS > 1.0) outS = 1.0;
    if (outS < -1.0) outS = -1.0;

    outBuf[f] = outS;                 // left
    outBuf[MAX_FRAMES + f] = outS;    // right (mono synth)
  }
}
