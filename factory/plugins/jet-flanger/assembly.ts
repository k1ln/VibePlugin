// =====================================================================
//  JET FLANGER — modulated short-delay flanger with regeneration
//  A swept fractional delay (~0.2..10 ms) is read with linear
//  interpolation and summed with the dry signal to form a moving comb
//  filter. A bipolar Regen (feedback) control feeds the delayed signal
//  back into the line; negative values give the hollow through-zero-style
//  metallic "jet" sweep. A triangle LFO modulates the delay around a
//  Manual base time. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: max 12 ms @ 96k -> 1152 samples; give generous headroom.
const DLY_LEN: i32 = 2048;          // power-of-two-ish ring per channel
const dline:  StaticArray<f32> = new StaticArray<f32>(DLY_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const lfoPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // 0..1
const fbState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // last delayed out (for feedback)

const P_RATE:   i32 = 0;  // 0..1 -> 0.05..8 Hz
const P_DEPTH:  i32 = 1;  // 0..1 sweep depth
const P_REGEN:  i32 = 2;  // 0..1 -> -0.9..0.9 feedback (bipolar)
const P_MANUAL: i32 = 3;  // 0..1 -> base delay 0.2..6 ms
const P_MIX:    i32 = 4;  // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    writePos[c] = 0;
    lfoPhase[c] = c == 1 ? 0.25 : 0.0;   // slight stereo offset
    fbState[c] = 0.0;
  }
  for (let i = 0; i < DLY_LEN * MAX_CHANNELS; i++) dline[i] = 0.0;
  params[P_RATE] = 0.25; params[P_DEPTH] = 0.7; params[P_REGEN] = 0.65;
  params[P_MANUAL] = 0.2; params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  const rateN: f32   = clampf(params[P_RATE], 0.0, 1.0);
  const depthN: f32  = clampf(params[P_DEPTH], 0.0, 1.0);
  const regenN: f32  = clampf(params[P_REGEN], 0.0, 1.0);
  const manualN: f32 = clampf(params[P_MANUAL], 0.0, 1.0);
  const mix: f32     = clampf(params[P_MIX], 0.0, 1.0);

  // LFO rate: gentle exponential map 0.05..8 Hz
  const rateHz: f32 = f32(0.05 * Mathf.pow(160.0, rateN));
  const phInc: f32  = rateHz / sampleRate;

  // Delay times in SAMPLES.
  const minMs: f32  = 0.2;
  const baseMs: f32 = minMs + manualN * 5.8;            // 0.2..6.0 ms base
  const sweepMs: f32 = depthN * 4.0;                    // up to +4 ms of sweep
  const baseSamp: f32  = baseMs  * sampleRate * 0.001;
  const sweepSamp: f32 = sweepMs * sampleRate * 0.001;

  // Bipolar feedback -0.9..0.9
  const fb: f32 = clampf(regenN * 1.8 - 0.9, -0.9, 0.9);

  for (let c = 0; c < channels; c++) {
    const cbase: i32 = c * DLY_LEN;
    let wp: i32 = writePos[c];
    let ph: f32 = lfoPhase[c];
    let fbs: f32 = fbState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[c * MAX_FRAMES + f];

      // Triangle LFO 0..1 (smoother than sine for symmetric jet sweep edges)
      const tri: f32 = ph < 0.5 ? (ph * 2.0) : (2.0 - ph * 2.0);
      // delay in samples for this frame
      let dSamp: f32 = baseSamp + tri * sweepSamp;
      const maxD: f32 = f32(DLY_LEN - 2);
      dSamp = clampf(dSamp, 1.0, maxD);

      // fractional read position behind the write pointer
      let rp: f32 = f32(wp) - dSamp;
      while (rp < 0.0) rp += f32(DLY_LEN);
      const i0: i32 = i32(rp);
      const frac: f32 = rp - f32(i0);
      let i1: i32 = i0 + 1;
      if (i1 >= DLY_LEN) i1 -= DLY_LEN;
      const s0: f32 = dline[cbase + i0];
      const s1: f32 = dline[cbase + i1];
      const delayed: f32 = s0 + (s1 - s0) * frac;

      // write input + feedback of the delayed signal
      dline[cbase + wp] = x + delayed * fb;

      // flanger sum: 0.7 dry + 0.7 wet keeps the comb peaks below clipping
      const wet: f32 = x * 0.7 + delayed * 0.7;
      outBuf[c * MAX_FRAMES + f] = x * (1.0 - mix) + wet * mix;

      fbs = delayed;

      wp++;
      if (wp >= DLY_LEN) wp = 0;
      ph += phInc;
      if (ph >= 1.0) ph -= 1.0;
    }

    writePos[c] = wp;
    lfoPhase[c] = ph;
    fbState[c] = fbs;
  }
}
