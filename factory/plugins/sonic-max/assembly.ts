// =====================================================================
//  SONIC MAX — psychoacoustic phase + clarity enhancer
//  A "sonic maximizer" effect. The signal is split into three bands
//  (low / mid / high) with one-pole crossovers. The low band is delayed
//  a touch relative to the highs to re-align their group delay (the way
//  high frequencies naturally arrive "late" through speakers/rooms is
//  partly undone), restoring transient punch. "Process" lifts high-band
//  presence for air and definition; "Lo Contour" blooms the low band for
//  weight and body. The bands are recombined, then a soft output trim and
//  dry/wet Mix keep the result subtle and bounded. Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const PI: f32 = 3.14159265358979;

// --- per-channel filter / delay state -------------------------------
// Two cascaded one-poles define the low band; another pair the high band;
// the mid is what remains. lp1/lp2 = low-band low-passes; hp1 = high-band
// (input minus low-pass), smoothed by lpH for a gentle shelf.
const lpLowA: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lpLowB: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lpMid:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hpHi:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const bloomZ: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // low-band bloom resonator

// Short fractional delay line for the low band (phase/time alignment).
const DLEN: i32 = 256; // > max delay in samples; plenty of headroom
const lowDelay: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * DLEN);
const dWrite:   StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);

// --- parameter indices ----------------------------------------------
const P_PROCESS:   i32 = 0; // 0..1 -> high-frequency clarity / presence
const P_LOCONTOUR: i32 = 1; // 0..1 -> low-end bloom / weight
const P_OUTPUT:    i32 = 2; // 0..1 -> 0..1.4 output trim
const P_MIX:       i32 = 3; // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    lpLowA[c] = 0.0;
    lpLowB[c] = 0.0;
    lpMid[c]  = 0.0;
    hpHi[c]   = 0.0;
    bloomZ[c] = 0.0;
    dWrite[c] = 0;
    const db: i32 = c * DLEN;
    for (let i = 0; i < DLEN; i++) lowDelay[db + i] = 0.0;
  }
  params[P_PROCESS]   = 0.5;
  params[P_LOCONTOUR] = 0.5;
  params[P_OUTPUT]    = 0.55;
  params[P_MIX]       = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// gentle soft clip so heavy bloom/presence never blows past ~1
@inline function softClip(x: f32): f32 {
  const c: f32 = clampf(x, -1.5, 1.5);
  return f32(c - 0.14814815 * c * c * c); // c - c^3/6.75, flattens near edges
}

export function process(n: i32): void {
  const proc:  f32 = clampf(params[P_PROCESS],   0.0, 1.0);
  const contour: f32 = clampf(params[P_LOCONTOUR], 0.0, 1.0);
  const output: f32 = clampf(params[P_OUTPUT],   0.0, 1.0) * 1.4;
  const mix:    f32 = clampf(params[P_MIX],      0.0, 1.0);

  // crossover corners (one-pole coefficients)
  const lowHz:  f32 = 250.0;   // low / mid split
  const highHz: f32 = 3500.0;  // mid / high split
  const cLow:  f32 = f32(1.0 - Mathf.exp(-2.0 * PI * lowHz  / sampleRate));
  const cHigh: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * highHz / sampleRate));

  // low-band time alignment: delay lows up to ~0.6 ms behind the highs.
  // more Process = more re-alignment, so the high transients lead.
  let dSamp: f32 = proc * 0.0006 * sampleRate; // samples
  if (dSamp > f32(DLEN - 2)) dSamp = f32(DLEN - 2);
  const di: i32 = i32(dSamp);
  const dfrac: f32 = dSamp - f32(di);

  // band trims. Presence: +HF up to ~+5.5 dB. Bloom: +low up to ~+5 dB,
  // plus a touch of resonant lift around the low-band corner for "weight".
  const hiGain:   f32 = 1.0 + proc * 0.9;
  const loGain:   f32 = 1.0 + contour * 0.8;
  const bloomAmt: f32 = contour * 0.35;
  // bloom resonator coefficient (one-pole BP-ish around ~90 Hz)
  const cBloom: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * 90.0 / sampleRate));

  // overall gentle make-up so the recombined sum doesn't swell with settings
  const comp: f32 = f32(1.0 / (1.0 + 0.18 * (proc + contour)));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const db: i32 = c * DLEN;
    let lA: f32 = lpLowA[c];
    let lB: f32 = lpLowB[c];
    let lm: f32 = lpMid[c];
    let hz: f32 = hpHi[c];
    let bl: f32 = bloomZ[c];
    let wp: i32 = dWrite[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- 3-way split via cascaded one-poles ---
      lA = lA + cLow * (x - lA);       // 1st low-pass
      lB = lB + cLow * (lA - lB);      // 2nd -> steeper low band
      const low: f32 = lB;

      lm = lm + cHigh * (x - lm);      // low-pass at high corner
      const lowMidSum: f32 = lm;       // everything below high corner
      const high: f32 = x - lowMidSum; // high band
      const mid: f32 = lowMidSum - low; // mid band

      // --- low-band fractional delay (phase/time alignment) ---
      lowDelay[db + wp] = low;
      let r0: i32 = wp - di;       if (r0 < 0) r0 += DLEN;
      let r1: i32 = r0 - 1;        if (r1 < 0) r1 += DLEN;
      const dLow: f32 = lowDelay[db + r0] + (lowDelay[db + r1] - lowDelay[db + r0]) * dfrac;
      wp++; if (wp >= DLEN) wp -= DLEN;

      // --- low-end bloom resonator (adds weight under the lows) ---
      bl = bl + cBloom * (dLow - bl);
      const bloom: f32 = bl * bloomAmt;

      // --- high-band presence smoothing (gentle air shelf) ---
      hz = hz + 0.35 * (high - hz); // light smoothing of the high band
      const air: f32 = high + (high - hz) * proc * 0.6; // emphasise fast edges

      // --- recombine ---
      const wetRaw: f32 =
        (dLow * loGain + bloom) +
        mid +
        (air * hiGain);

      const wet: f32 = softClip(wetRaw * comp) * output;

      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }

    lpLowA[c] = lA;
    lpLowB[c] = lB;
    lpMid[c]  = lm;
    hpHi[c]   = hz;
    bloomZ[c] = bl;
    dWrite[c] = wp;
  }
}
