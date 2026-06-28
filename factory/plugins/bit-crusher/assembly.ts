// =====================================================================
//  BIT CRUSHER — lo-fi bit-depth quantizer + sample-rate decimator
//  Two classic digital-degradation stages in series: an amplitude
//  quantizer that rounds the signal to a variable bit depth (1..16),
//  and a sample-and-hold decimator that drops the effective sample
//  rate by an integer divisor (1..50) to introduce aliasing/grit.
//  A dry/wet Mix blends in the clean signal and Level trims output.
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

// per-channel decimator state: how many samples since last hold, and the held value
const holdCount: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const holdVal:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_BITS: i32 = 0;        // 0..1 -> bit depth 16..1 (more crush as it rises... see mapping)
const P_DOWNSAMPLE: i32 = 1;  // 0..1 -> rate divisor 1..50
const P_MIX: i32 = 2;         // 0..1 dry/wet
const P_LEVEL: i32 = 3;       // 0..1 -> 0..1.2 output

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) { holdCount[c] = 1.0e9; holdVal[c] = 0.0; }
  params[P_BITS] = 0.5; params[P_DOWNSAMPLE] = 0.3; params[P_MIX] = 1.0; params[P_LEVEL] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  const bitsN: f32 = clampf(params[P_BITS], 0.0, 1.0);
  const dsN: f32   = clampf(params[P_DOWNSAMPLE], 0.0, 1.0);
  const mix: f32   = clampf(params[P_MIX], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.2;

  // Bit depth: control 0 -> 16 bits (clean), control 1 -> 1 bit (max crush).
  // bits in [1,16]. Quantization step = 2 / (2^bits - 1) over a [-1,1] range.
  const bits: f32 = 16.0 - bitsN * 15.0;        // 16 .. 1
  const levels: f32 = Mathf.pow(2.0, bits) - 1.0; // 2^bits - 1, >= 1
  const safeLevels: f32 = levels < 1.0 ? 1.0 : levels;
  const stepInv: f32 = safeLevels * 0.5;          // x*stepInv then round then /stepInv
  const step: f32 = 1.0 / stepInv;

  // Downsample divisor: 1..50 (integer sample-and-hold period).
  let divisor: f32 = 1.0 + Mathf.round(dsN * 49.0); // 1 .. 50
  if (divisor < 1.0) divisor = 1.0;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let hc: f32 = holdCount[c];
    let hv: f32 = holdVal[c];
    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- sample-and-hold decimator ---
      hc = hc + 1.0;
      if (hc >= divisor) {
        hc = 0.0;
        hv = x;          // latch a new sample
      }
      let s: f32 = hv;

      // --- bit-depth quantizer ---
      // clamp to [-1,1] so quantization grid is well defined, then round to nearest step
      const cs: f32 = clampf(s, -1.0, 1.0);
      const q: f32 = f32(Mathf.round(cs * stepInv) * step);

      // dry/wet + output level
      const wet: f32 = q;
      const y: f32 = f32((x * (1.0 - mix) + wet * mix) * level);
      outBuf[base + f] = clampf(y, -1.2, 1.2);
    }
    holdCount[c] = hc;
    holdVal[c] = hv;
  }
}
