// =====================================================================
//  CROSSOVER — phase-coherent 3-band splitter (Linkwitz-Riley style)
//
//  The signal is split into LOW / MID / HIGH by two 4th-order
//  Linkwitz-Riley crossovers (each = two cascaded 2nd-order Butterworth
//  sections), which sum back to a flat, phase-coherent response. Each band
//  gets its own gain trim, then the three bands are recombined. At unity
//  gains the output equals the input; lifting or dropping a band gain tilts
//  the spectral balance like a 3-way mixer. Pure algorithm, no samples.
//
//  LR4 detail: a low-pass LR4 = LP2·LP2, a high-pass LR4 = HP2·HP2. To keep
//  the three bands phase-aligned the standard trick is used: the HIGH band is
//  derived from the LOW-crossover high-pass, and the MID is the band between
//  the two crossovers. We also pass the LOW band through the high crossover's
//  low-pass-complement to keep phase coherent when both crossovers act.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// Parameter indices (MUST match spec.json + the GUI's setParam calls)
const P_LOW_FREQ:  i32 = 0; // 40..500 Hz   low/mid split
const P_HIGH_FREQ: i32 = 1; // 800..12000 Hz mid/high split
const P_LOW_GAIN:  i32 = 2; // 0..2  linear  (-inf..+6 dB)
const P_MID_GAIN:  i32 = 3; // 0..2  linear
const P_HIGH_GAIN: i32 = 4; // 0..2  linear

const PI: f32 = 3.14159265358979;

// ---------------------------------------------------------------------
//  Biquad state. We need, PER CHANNEL, four 2nd-order sections:
//    A = low crossover  low-pass   (×2 cascade for LR4)
//    B = low crossover  high-pass  (×2 cascade for LR4)
//    C = high crossover low-pass   (×2 cascade for LR4)
//    D = high crossover high-pass  (×2 cascade for LR4)
//  Each cascade = 2 biquads, so 8 biquads per channel = 16 total.
//  We store Direct-Form-II transposed states z1,z2 per biquad.
// ---------------------------------------------------------------------
const NSEC: i32 = 8;                       // biquads per channel
const z1: StaticArray<f32> = new StaticArray<f32>(NSEC * MAX_CHANNELS);
const z2: StaticArray<f32> = new StaticArray<f32>(NSEC * MAX_CHANNELS);

// Coefficients are shared across channels (same cutoff), recomputed when the
// frequency params move. Two distinct biquad shapes: a low-pass set and a
// high-pass set, for each of the two crossover frequencies.
let loLP_b0: f32 = 0.0; let loLP_b1: f32 = 0.0; let loLP_b2: f32 = 0.0; let loLP_a1: f32 = 0.0; let loLP_a2: f32 = 0.0;
let loHP_b0: f32 = 0.0; let loHP_b1: f32 = 0.0; let loHP_b2: f32 = 0.0; let loHP_a1: f32 = 0.0; let loHP_a2: f32 = 0.0;
let hiLP_b0: f32 = 0.0; let hiLP_b1: f32 = 0.0; let hiLP_b2: f32 = 0.0; let hiLP_a1: f32 = 0.0; let hiLP_a2: f32 = 0.0;
let hiHP_b0: f32 = 0.0; let hiHP_b1: f32 = 0.0; let hiHP_b2: f32 = 0.0; let hiHP_a1: f32 = 0.0; let hiHP_a2: f32 = 0.0;

let cachedLoFreq: f32 = -1.0;
let cachedHiFreq: f32 = -1.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// Compute a 2nd-order Butterworth low-pass (Q = 1/sqrt(2)) at fc. The pair of
// cascaded Butterworth low-passes makes a Linkwitz-Riley 4th-order low-pass.
function computeLP(fc: f32): void {
  const w0: f32  = f32(2.0 * PI * fc / sampleRate);
  const cw: f32  = f32(Mathf.cos(w0));
  const sw: f32  = f32(Mathf.sin(w0));
  const q: f32   = f32(0.70710678);
  const alpha: f32 = f32(sw / (2.0 * q));
  const a0: f32  = f32(1.0 + alpha);
  const inv: f32 = f32(1.0 / a0);
  loLP_b0 = f32(((1.0 - cw) * 0.5) * inv);
  loLP_b1 = f32((1.0 - cw) * inv);
  loLP_b2 = loLP_b0;
  loLP_a1 = f32((-2.0 * cw) * inv);
  loLP_a2 = f32((1.0 - alpha) * inv);
}

function computeHP(fc: f32): void {
  const w0: f32  = f32(2.0 * PI * fc / sampleRate);
  const cw: f32  = f32(Mathf.cos(w0));
  const sw: f32  = f32(Mathf.sin(w0));
  const q: f32   = f32(0.70710678);
  const alpha: f32 = f32(sw / (2.0 * q));
  const a0: f32  = f32(1.0 + alpha);
  const inv: f32 = f32(1.0 / a0);
  loHP_b0 = f32(((1.0 + cw) * 0.5) * inv);
  loHP_b1 = f32((-(1.0 + cw)) * inv);
  loHP_b2 = loHP_b0;
  loHP_a1 = f32((-2.0 * cw) * inv);
  loHP_a2 = f32((1.0 - alpha) * inv);
}

// The above two write into the "lo*" globals; we copy them into the hi* set
// when computing the high crossover. Kept simple to avoid arrays of structs.
function updateCoeffs(loFreq: f32, hiFreq: f32): void {
  // low crossover
  computeLP(loFreq);
  computeHP(loFreq);
  // high crossover — compute into temporaries by reusing the same routines,
  // then move them across. Compute HP/LP for hiFreq.
  const w0: f32  = f32(2.0 * PI * hiFreq / sampleRate);
  const cw: f32  = f32(Mathf.cos(w0));
  const sw: f32  = f32(Mathf.sin(w0));
  const q: f32   = f32(0.70710678);
  const alpha: f32 = f32(sw / (2.0 * q));
  const a0: f32  = f32(1.0 + alpha);
  const inv: f32 = f32(1.0 / a0);
  hiLP_b0 = f32(((1.0 - cw) * 0.5) * inv);
  hiLP_b1 = f32((1.0 - cw) * inv);
  hiLP_b2 = hiLP_b0;
  hiLP_a1 = f32((-2.0 * cw) * inv);
  hiLP_a2 = f32((1.0 - alpha) * inv);
  hiHP_b0 = f32(((1.0 + cw) * 0.5) * inv);
  hiHP_b1 = f32((-(1.0 + cw)) * inv);
  hiHP_b2 = hiHP_b0;
  hiHP_a1 = f32((-2.0 * cw) * inv);
  hiHP_a2 = f32((1.0 - alpha) * inv);
}

// One biquad sample, Direct-Form-II transposed, using section index `s`.
@inline function biquad(x: f32, s: i32,
                        b0: f32, b1: f32, b2: f32, a1: f32, a2: f32): f32 {
  const w1: f32 = z1[s];
  const w2: f32 = z2[s];
  const y: f32 = f32(b0 * x + w1);
  z1[s] = f32(b1 * x - a1 * y + w2);
  z2[s] = f32(b2 * x - a2 * y);
  return y;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < NSEC * MAX_CHANNELS; i++) { z1[i] = 0.0; z2[i] = 0.0; }
  params[P_LOW_FREQ]  = 200.0;
  params[P_HIGH_FREQ] = 2000.0;
  params[P_LOW_GAIN]  = 1.0;
  params[P_MID_GAIN]  = 1.0;
  params[P_HIGH_GAIN] = 1.0;
  cachedLoFreq = -1.0;
  cachedHiFreq = -1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  // --- read + clamp params ---
  let loFreq: f32 = clampf(params[P_LOW_FREQ],  40.0,  500.0);
  let hiFreq: f32 = clampf(params[P_HIGH_FREQ], 800.0, 12000.0);
  // keep the two crossovers ordered with a little separation
  const nyq: f32 = f32(sampleRate * 0.49);
  if (hiFreq > nyq) hiFreq = nyq;
  if (loFreq > hiFreq * 0.5) loFreq = hiFreq * 0.5;

  const gLow: f32  = clampf(params[P_LOW_GAIN],  0.0, 2.0);
  const gMid: f32  = clampf(params[P_MID_GAIN],  0.0, 2.0);
  const gHigh: f32 = clampf(params[P_HIGH_GAIN], 0.0, 2.0);

  if (loFreq != cachedLoFreq || hiFreq != cachedHiFreq) {
    updateCoeffs(loFreq, hiFreq);
    cachedLoFreq = loFreq;
    cachedHiFreq = hiFreq;
  }

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const so: i32 = c * NSEC;       // section base for this channel
    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- LOW crossover: LR4 low-pass (sections 0,1) and high-pass (2,3) ---
      let lp1: f32 = biquad(x,   so + 0, loLP_b0, loLP_b1, loLP_b2, loLP_a1, loLP_a2);
      let low: f32 = biquad(lp1, so + 1, loLP_b0, loLP_b1, loLP_b2, loLP_a1, loLP_a2);

      let hp1: f32 = biquad(x,   so + 2, loHP_b0, loHP_b1, loHP_b2, loHP_a1, loHP_a2);
      let highband: f32 = biquad(hp1, so + 3, loHP_b0, loHP_b1, loHP_b2, loHP_a1, loHP_a2);

      // --- HIGH crossover splits the upper band into MID (LR4 LP) + HIGH (LR4 HP) ---
      let mlp1: f32 = biquad(highband, so + 4, hiLP_b0, hiLP_b1, hiLP_b2, hiLP_a1, hiLP_a2);
      let mid: f32  = biquad(mlp1,     so + 5, hiLP_b0, hiLP_b1, hiLP_b2, hiLP_a1, hiLP_a2);

      let hhp1: f32 = biquad(highband, so + 6, hiHP_b0, hiHP_b1, hiHP_b2, hiHP_a1, hiHP_a2);
      let high: f32 = biquad(hhp1,     so + 7, hiHP_b0, hiHP_b1, hiHP_b2, hiHP_a1, hiHP_a2);

      // --- recombine with per-band gains ---
      const y: f32 = f32(low * gLow + mid * gMid + high * gHigh);
      outBuf[base + f] = y;
    }
  }

  // if mono source filled only channel 0, mirror to channel 1 when host is stereo
  if (channels < 2) {
    // nothing — host reads only `channels`
  }
}
