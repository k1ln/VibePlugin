// =====================================================================
//  STEEL FLANGER — extreme, metallic, jet-engine flanger (effect)
//  A swept short delay with STRONG regeneration. Where a gentle flanger
//  whispers, this one screams: a very wide manual/sweep range lets the
//  comb dive into clangy, almost-pitched metallic resonance. A triangle
//  LFO modulates a fractional (linear-interpolated) delay around a Manual
//  base position. Bipolar Feedback feeds the delayed signal back through
//  the line — positive gives a bright stainless ring, negative a hollow
//  through-zero hiss. A soft tanh-ish saturator inside the feedback path
//  keeps the resonance bounded while preserving the aggressive character.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: wide range. Up to ~20 ms @ 96k -> 1920 samples. 4096 is ample.
const DLY_LEN: i32 = 4096;
const dline:  StaticArray<f32> = new StaticArray<f32>(DLY_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const lfoPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // 0..1
const fbState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // last fed-back delayed out
const dampState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // one-pole tone in regen

const P_RATE:     i32 = 0;  // 0..1 -> 0.02..10 Hz (exp)
const P_DEPTH:    i32 = 1;  // 0..1 sweep depth
const P_MANUAL:   i32 = 2;  // 0..1 -> base delay 0.1..14 ms (wide!)
const P_FEEDBACK: i32 = 3;  // 0..1 -> -0.97..0.97 regen (bipolar, metallic)
const P_MIX:      i32 = 4;  // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    writePos[c] = 0;
    lfoPhase[c] = c == 1 ? 0.3 : 0.0;   // stereo offset for width
    fbState[c] = 0.0;
    dampState[c] = 0.0;
  }
  for (let i = 0; i < DLY_LEN * MAX_CHANNELS; i++) dline[i] = 0.0;
  params[P_RATE] = 0.22; params[P_DEPTH] = 0.85; params[P_MANUAL] = 0.25;
  params[P_FEEDBACK] = 0.78; params[P_MIX] = 0.55;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// soft saturator — bounds the regen so high feedback stays metallic, not blown
@inline function sat(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return c - (c * c * c) * f32(0.111111); // ~tanh-ish cubic, |out| < ~1.0 near edges
}

export function process(n: i32): void {
  const rateN: f32     = clampf(params[P_RATE], 0.0, 1.0);
  const depthN: f32    = clampf(params[P_DEPTH], 0.0, 1.0);
  const manualN: f32   = clampf(params[P_MANUAL], 0.0, 1.0);
  const feedbackN: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const mix: f32       = clampf(params[P_MIX], 0.0, 1.0);

  // LFO rate: exponential 0.02..10 Hz
  const rateHz: f32 = f32(0.02 * Mathf.pow(500.0, rateN));
  const phInc: f32  = rateHz / sampleRate;

  // VERY wide delay range for the extreme metallic A/DA-style sweep.
  const minMs: f32  = 0.1;
  const baseMs: f32 = minMs + manualN * 13.9;           // 0.1..14.0 ms base
  const sweepMs: f32 = depthN * 9.0;                    // up to +9 ms of sweep
  const baseSamp: f32  = baseMs  * sampleRate * 0.001;
  const sweepSamp: f32 = sweepMs * sampleRate * 0.001;

  // Bipolar feedback -0.97..0.97 — strong regeneration => clangy resonance
  const fb: f32 = clampf(feedbackN * 1.94 - 0.97, -0.97, 0.97);

  // light damping in the regen path so the very top doesn't run away
  const damp: f32 = 0.35;

  for (let c = 0; c < channels; c++) {
    const cbase: i32 = c * DLY_LEN;
    let wp: i32 = writePos[c];
    let ph: f32 = lfoPhase[c];
    let fbs: f32 = fbState[c];
    let dmp: f32 = dampState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[c * MAX_FRAMES + f];

      // Triangle LFO 0..1 — symmetric sweep edges suit the jet character
      const tri: f32 = ph < 0.5 ? (ph * 2.0) : (2.0 - ph * 2.0);
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

      // damp the fed-back signal a touch (one-pole LP) and saturate it
      dmp = dmp + damp * (delayed - dmp);
      const fbSig: f32 = sat(x + dmp * fb);

      // write input + saturated feedback into the line
      dline[cbase + wp] = fbSig;

      // flanger sum: equal dry+wet keeps comb peaks bounded
      const wet: f32 = x * 0.6 + delayed * 0.7;
      outBuf[c * MAX_FRAMES + f] = clampf(x * (1.0 - mix) + wet * mix, -1.0, 1.0);

      fbs = delayed;

      wp++;
      if (wp >= DLY_LEN) wp = 0;
      ph += phInc;
      if (ph >= 1.0) ph -= 1.0;
    }

    writePos[c] = wp;
    lfoPhase[c] = ph;
    fbState[c] = fbs;
    dampState[c] = dmp;
  }
}
