// =====================================================================
//  MULTIBAND — three-band dynamics processor (mastering-style)
//  The signal is split into LOW / MID / HIGH bands with two crossovers
//  (state-variable filters, ~220 Hz and ~2.5 kHz). Each band runs its own
//  peak-detecting compressor with an independent threshold, a shared ratio
//  and per-band attack/release ballistics, so the low band can pump hard
//  without dulling the highs. The compressed bands are recombined and a
//  final makeup/output gain trims the result. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// --- crossover filter state (two cascaded SVF-ish one-poles per split, per ch) ---
// We build the band split from a pair of one-pole low-passes per crossover.
// lp1 = low/mid split ~220 Hz, lp2 = mid/high split ~2.5 kHz. Two stages each
// (cascaded) give a steeper, cleaner Linkwitz-Riley-like slope.
const lpA1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // low split, stage 1
const lpA2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // low split, stage 2
const lpB1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // high split, stage 1
const lpB2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // high split, stage 2

// --- per-band compressor envelopes (one detector per band, mono-linked over ch) ---
const envLow:  StaticArray<f32> = new StaticArray<f32>(1);
const envMid:  StaticArray<f32> = new StaticArray<f32>(1);
const envHigh: StaticArray<f32> = new StaticArray<f32>(1);

// --- live gain-reduction readout (linear gain 0..1), exposed for the GUI meters ---
const grLow:  StaticArray<f32> = new StaticArray<f32>(1);
const grMid:  StaticArray<f32> = new StaticArray<f32>(1);
const grHigh: StaticArray<f32> = new StaticArray<f32>(1);

const P_LOW:   i32 = 0; // 0..1 -> low-band threshold (1 = open, 0 = squash)
const P_MID:   i32 = 1; // 0..1 -> mid-band threshold
const P_HIGH:  i32 = 2; // 0..1 -> high-band threshold
const P_RATIO: i32 = 3; // 0..1 -> ratio 1:1 .. ~12:1
const P_OUT:   i32 = 4; // 0..1 -> output / makeup 0..2x

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    lpA1[c] = 0.0; lpA2[c] = 0.0; lpB1[c] = 0.0; lpB2[c] = 0.0;
  }
  envLow[0] = 0.0; envMid[0] = 0.0; envHigh[0] = 0.0;
  grLow[0] = 1.0; grMid[0] = 1.0; grHigh[0] = 1.0;
  params[P_LOW]   = 0.5;
  params[P_MID]   = 0.5;
  params[P_HIGH]  = 0.5;
  params[P_RATIO] = 0.5;
  params[P_OUT]   = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// gain-reduction getters for the GUI (0..1 linear gain; lower = more reduction)
export function getGrLow(): f32  { return grLow[0]; }
export function getGrMid(): f32  { return grMid[0]; }
export function getGrHigh(): f32 { return grHigh[0]; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  // --- thresholds: param 1 = open (high threshold), 0 = aggressive (low threshold) ---
  // Map each band threshold knob to a linear amplitude threshold.
  // 0 -> 0.02 (squashes almost everything), 1 -> 0.9 (barely touches peaks).
  const thrLow:  f32 = 0.02 + clampf(params[P_LOW],  0.0, 1.0) * 0.88;
  const thrMid:  f32 = 0.02 + clampf(params[P_MID],  0.0, 1.0) * 0.88;
  const thrHigh: f32 = 0.02 + clampf(params[P_HIGH], 0.0, 1.0) * 0.88;

  // shared ratio 1:1 .. ~12:1
  const ratio: f32 = 1.0 + clampf(params[P_RATIO], 0.0, 1.0) * 11.0;
  const slope: f32 = 1.0 - 1.0 / ratio; // amount of excess pulled back

  const out: f32 = clampf(params[P_OUT], 0.0, 1.0) * 1.6;

  // crossover coefficients (one-pole), cascaded twice for a steeper slope
  const fLowHz:  f32 = 220.0;
  const fHighHz: f32 = 2500.0;
  const cLow:  f32 = clampf(f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * fLowHz  / sampleRate)), 0.0, 1.0);
  const cHigh: f32 = clampf(f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * fHighHz / sampleRate)), 0.0, 1.0);

  // ballistics: fast attack, band-dependent release (lows release slower → pump)
  const atk: f32 = clampf(f32(1.0 - Mathf.exp(-1.0 / (0.004 * sampleRate))), 0.0, 1.0);
  const relLow:  f32 = clampf(f32(1.0 - Mathf.exp(-1.0 / (0.180 * sampleRate))), 0.0, 1.0);
  const relMid:  f32 = clampf(f32(1.0 - Mathf.exp(-1.0 / (0.090 * sampleRate))), 0.0, 1.0);
  const relHigh: f32 = clampf(f32(1.0 - Mathf.exp(-1.0 / (0.040 * sampleRate))), 0.0, 1.0);

  // makeup so reducing the threshold (more squash) still feels level-matched,
  // scaled by ratio so high ratios don't just collapse the level.
  const makeup: f32 = 1.0 + slope * 0.6;

  let eLow:  f32 = envLow[0];
  let eMid:  f32 = envMid[0];
  let eHigh: f32 = envHigh[0];

  // track the minimum (deepest) gain reduction across the block for the meters
  let mGrLow:  f32 = 1.0;
  let mGrMid:  f32 = 1.0;
  let mGrHigh: f32 = 1.0;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let a1: f32 = lpA1[c];
    let a2: f32 = lpA2[c];
    let b1: f32 = lpB1[c];
    let b2: f32 = lpB2[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- crossover split (cascaded one-pole low-passes) ---
      a1 = a1 + cLow * (x - a1);
      a2 = a2 + cLow * (a1 - a2);
      const low: f32 = a2;                 // below ~220 Hz

      b1 = b1 + cHigh * (x - b1);
      b2 = b2 + cHigh * (b1 - b2);
      const lowMid: f32 = b2;              // below ~2.5 kHz

      const mid: f32  = lowMid - low;      // 220 Hz .. 2.5 kHz
      const high: f32 = x - lowMid;        // above ~2.5 kHz

      // --- per-band peak detection + static compression curve ---
      // LOW band
      const dl: f32 = low < 0.0 ? -low : low;
      const cl: f32 = dl > eLow ? atk : relLow;
      eLow = eLow + cl * (dl - eLow);
      let gLow: f32 = 1.0;
      if (eLow > thrLow) {
        const over: f32 = eLow / thrLow;            // >1
        gLow = f32(Mathf.pow(over, -slope));        // gain reduction
      }
      gLow = clampf(gLow, 0.02, 1.0);
      if (gLow < mGrLow) mGrLow = gLow;

      // MID band
      const dm: f32 = mid < 0.0 ? -mid : mid;
      const cm: f32 = dm > eMid ? atk : relMid;
      eMid = eMid + cm * (dm - eMid);
      let gMid: f32 = 1.0;
      if (eMid > thrMid) {
        const over: f32 = eMid / thrMid;
        gMid = f32(Mathf.pow(over, -slope));
      }
      gMid = clampf(gMid, 0.02, 1.0);
      if (gMid < mGrMid) mGrMid = gMid;

      // HIGH band
      const dh: f32 = high < 0.0 ? -high : high;
      const ch2: f32 = dh > eHigh ? atk : relHigh;
      eHigh = eHigh + ch2 * (dh - eHigh);
      let gHigh: f32 = 1.0;
      if (eHigh > thrHigh) {
        const over: f32 = eHigh / thrHigh;
        gHigh = f32(Mathf.pow(over, -slope));
      }
      gHigh = clampf(gHigh, 0.02, 1.0);
      if (gHigh < mGrHigh) mGrHigh = gHigh;

      // --- recombine + makeup + output ---
      const y: f32 = (low * gLow + mid * gMid + high * gHigh) * makeup * out;
      outBuf[base + f] = clampf(y, -1.0, 1.0);
    }

    lpA1[c] = a1; lpA2[c] = a2; lpB1[c] = b1; lpB2[c] = b2;
  }

  envLow[0] = eLow; envMid[0] = eMid; envHigh[0] = eHigh;
  grLow[0]  = mGrLow; grMid[0]  = mGrMid; grHigh[0] = mGrHigh;
}
