// =====================================================================
//  TWIN PHASER — a dual sweeping-notch phaser
//  Two INDEPENDENT 4-stage allpass phasers, each driven by its own LFO
//  running at its own rate. The two engines can be SUMMED (parallel) for
//  wide, beating notch patterns, or chained in SERIES for deep, stacked
//  8-notch sweeps. Per-engine feedback sharpens the notches into vocal
//  resonances. A steady tone shows several notches drifting at two rates.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// Per-engine, per-channel allpass state. 4 stages each.
// Layout: [engine * MAX_CHANNELS * STAGES + channel * STAGES + stage]
const STAGES: i32 = 4;
const apState: StaticArray<f32> = new StaticArray<f32>(2 * MAX_CHANNELS * STAGES);
// Per-engine, per-channel feedback memory.
const fbState: StaticArray<f32> = new StaticArray<f32>(2 * MAX_CHANNELS);

// LFO phases (per engine). Slight stereo offset gives a wide image.
let phaseA: f32 = 0.0;
let phaseB: f32 = 0.25;

const PI2: f32 = 6.2831853;

const P_RATE_A:   i32 = 0; // 0..1 -> 0.02..8 Hz
const P_RATE_B:   i32 = 1; // 0..1 -> 0.02..8 Hz
const P_DEPTH:    i32 = 2; // 0..1 sweep depth
const P_FEEDBACK: i32 = 3; // 0..1 -> 0..0.92 resonance
const P_MODE:     i32 = 4; // 0 = SUM (parallel), 1 = SERIES (chained)
const P_MIX:      i32 = 5; // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < 2 * MAX_CHANNELS * STAGES; i++) apState[i] = 0.0;
  for (let i = 0; i < 2 * MAX_CHANNELS; i++) fbState[i] = 0.0;
  phaseA = 0.0;
  phaseB = 0.25;
  params[P_RATE_A]   = 0.30;
  params[P_RATE_B]   = 0.55;
  params[P_DEPTH]    = 0.70;
  params[P_FEEDBACK] = 0.45;
  params[P_MODE]     = 0.0;
  params[P_MIX]      = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// map 0..1 to an LFO rate in Hz with a perceptual (quadratic) curve
@inline function rateHz(n: f32): f32 {
  const k: f32 = clampf(n, 0.0, 1.0);
  return f32(0.02 + k * k * 7.98);
}

export function process(n: i32): void {
  const rA: f32 = rateHz(params[P_RATE_A]);
  const rB: f32 = rateHz(params[P_RATE_B]);
  const depth: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const fb: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0) * 0.92;
  const series: bool = params[P_MODE] >= 0.5;
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  const incA: f32 = rA / sampleRate;
  const incB: f32 = rB / sampleRate;

  // Allpass break frequency sweeps between ~200 Hz and ~1600 Hz.
  // Convert to the one-pole allpass coefficient g = (1 - t) / (1 + t),
  // t = tan(pi * fc / sr). We sweep in a normalised domain and rebuild g
  // per sample (cheap, only a few mul/div) so notches glide smoothly.
  const baseLo: f32 = 200.0;
  const baseHi: f32 = 1600.0;
  const span: f32 = (baseHi - baseLo) * depth;

  // small stereo phase offset so L/R notches differ -> wide image
  const stOff: f32 = 0.05;

  let pA: f32 = phaseA;
  let pB: f32 = phaseB;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const stPh: f32 = c == 1 ? stOff : 0.0;
    const apBaseA: i32 = (0 * MAX_CHANNELS + c) * STAGES;
    const apBaseB: i32 = (1 * MAX_CHANNELS + c) * STAGES;
    const fbIdxA: i32 = 0 * MAX_CHANNELS + c;
    const fbIdxB: i32 = 1 * MAX_CHANNELS + c;

    let lpA: f32 = pA;
    let lpB: f32 = pB;

    let s0A: f32 = apState[apBaseA + 0];
    let s1A: f32 = apState[apBaseA + 1];
    let s2A: f32 = apState[apBaseA + 2];
    let s3A: f32 = apState[apBaseA + 3];
    let s0B: f32 = apState[apBaseB + 0];
    let s1B: f32 = apState[apBaseB + 1];
    let s2B: f32 = apState[apBaseB + 2];
    let s3B: f32 = apState[apBaseB + 3];
    let zfA: f32 = fbState[fbIdxA];
    let zfB: f32 = fbState[fbIdxB];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- LFO A (triangle) -> break frequency -> coefficient gA ---
      let triA: f32 = lpA + stPh; triA -= Mathf.floor(triA);
      let tA: f32 = triA < 0.5 ? triA * 2.0 : 2.0 - triA * 2.0; // 0..1
      const fcA: f32 = baseLo + span * tA;
      const tanA: f32 = Mathf.tan(3.14159265 * fcA / sampleRate);
      const gA: f32 = (1.0 - tanA) / (1.0 + tanA);

      // --- LFO B (triangle) -> break frequency -> coefficient gB ---
      let triB: f32 = lpB + stPh; triB -= Mathf.floor(triB);
      let tB: f32 = triB < 0.5 ? triB * 2.0 : 2.0 - triB * 2.0;
      const fcB: f32 = baseLo + span * tB;
      const tanB: f32 = Mathf.tan(3.14159265 * fcB / sampleRate);
      const gB: f32 = (1.0 - tanB) / (1.0 + tanB);

      // ===== Engine A =====
      let inA: f32 = x + zfA * fb;
      let yA: f32 = inA;
      // stage 1
      let aOut: f32 = f32(-gA * yA + s0A); s0A = f32(yA + gA * aOut); yA = aOut;
      aOut = f32(-gA * yA + s1A); s1A = f32(yA + gA * aOut); yA = aOut;
      aOut = f32(-gA * yA + s2A); s2A = f32(yA + gA * aOut); yA = aOut;
      aOut = f32(-gA * yA + s3A); s3A = f32(yA + gA * aOut); yA = aOut;
      zfA = yA;
      const phA: f32 = f32(0.5 * (inA + yA)); // classic phaser sum

      // ===== Engine B =====
      // In SERIES mode B processes A's notched output; in SUM it processes dry.
      const srcB: f32 = series ? phA : x;
      let inB: f32 = srcB + zfB * fb;
      let yB: f32 = inB;
      let bOut: f32 = f32(-gB * yB + s0B); s0B = f32(yB + gB * bOut); yB = bOut;
      bOut = f32(-gB * yB + s1B); s1B = f32(yB + gB * bOut); yB = bOut;
      bOut = f32(-gB * yB + s2B); s2B = f32(yB + gB * bOut); yB = bOut;
      bOut = f32(-gB * yB + s3B); s3B = f32(yB + gB * bOut); yB = bOut;
      zfB = yB;
      const phB: f32 = f32(0.5 * (inB + yB));

      // Combine: SERIES -> phB already carries both; SUM -> average A & B.
      let wet: f32 = series ? phB : f32(0.5 * (phA + phB));
      // gentle safety clip
      if (wet > 1.5) wet = 1.5; else if (wet < -1.5) wet = -1.5;

      outBuf[base + f] = f32(x * (1.0 - mix) + wet * mix);

      lpA += incA; if (lpA >= 1.0) lpA -= 1.0;
      lpB += incB; if (lpB >= 1.0) lpB -= 1.0;
    }

    apState[apBaseA + 0] = s0A; apState[apBaseA + 1] = s1A;
    apState[apBaseA + 2] = s2A; apState[apBaseA + 3] = s3A;
    apState[apBaseB + 0] = s0B; apState[apBaseB + 1] = s1B;
    apState[apBaseB + 2] = s2B; apState[apBaseB + 3] = s3B;
    fbState[fbIdxA] = zfA;
    fbState[fbIdxB] = zfB;
  }

  phaseA = pA + incA * f32(n); phaseA -= Mathf.floor(phaseA);
  phaseB = pB + incB * f32(n); phaseB -= Mathf.floor(phaseB);
}
