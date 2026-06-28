// =====================================================================
//  BIAS TREMOLO — amp-style amplitude tremolo
//  A low-frequency oscillator amplitude-modulates the signal, the way a
//  vintage combo amp's bias-vary tremolo pulses the output. SHAPE morphs
//  the LFO from a glassy sine sweep into a hard, choppy bias chop; STEREO
//  spreads the L/R LFO phase for a rotary-style image. A short smoothing
//  filter on the gain keeps the choppy setting click-free. Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const TWO_PI: f32 = 6.2831853;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel LFO phase (0..1) and per-channel gain smoother state
const lfoPhase:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const gainState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_RATE:   i32 = 0; // 0..1 -> 0.1..12 Hz
const P_DEPTH:  i32 = 1; // 0..1 modulation depth (0 = bypassed amplitude)
const P_SHAPE:  i32 = 2; // 0..1 smooth sine -> choppy bias square
const P_STEREO: i32 = 3; // 0..1 L/R LFO phase offset (0..0.5 of a cycle)
const P_OUTPUT: i32 = 4; // 0..1 -> 0..1.5 output gain

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    lfoPhase[c] = 0.0;
    gainState[c] = 1.0;
  }
  params[P_RATE] = 0.42;   // ~5 Hz
  params[P_DEPTH] = 0.7;
  params[P_SHAPE] = 0.3;
  params[P_STEREO] = 0.0;
  params[P_OUTPUT] = 0.7;  // -> ~0.84 gain, headroom below clip
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Unit-amplitude oscillator, ph in 0..1, morphing sine -> square as shape 0..1.
// Returned in -1..1; we map it to a gain below.
@inline function lfoShape(ph: f32, shape: f32): f32 {
  // smooth sine
  const sine: f32 = f32(Mathf.sin(ph * TWO_PI));
  // choppy: a soft-saturated sine -> approaches a square as drive rises.
  // tanh of a heavily-driven sine gives a rounded square with no aliasing-y edges.
  const driven: f32 = sine * 6.0;
  const square: f32 = f32(Mathf.tanh(driven));
  return sine + (square - sine) * shape;
}

export function process(n: i32): void {
  const rateN: f32 = clampf(params[P_RATE], 0.0, 1.0);
  const depth: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const shape: f32 = clampf(params[P_SHAPE], 0.0, 1.0);
  const stereo: f32 = clampf(params[P_STEREO], 0.0, 1.0);
  const outGain: f32 = clampf(params[P_OUTPUT], 0.0, 1.0) * 1.2;

  // 0.1..12 Hz, perceptually-spaced (quadratic)
  const rateHz: f32 = 0.1 + rateN * rateN * 11.9;
  const sr: f32 = sampleRate > 0.0 ? sampleRate : 48000.0;
  const phaseInc: f32 = rateHz / sr; // cycles per sample

  // L/R phase offset, up to half a cycle for full stereo width
  const stereoOff: f32 = stereo * 0.5;

  // gain smoothing: ~2 ms one-pole, removes clicks at the choppy/square setting
  const smoothC: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.002 * sr)));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let ph: f32 = lfoPhase[c];
    let g: f32 = gainState[c];
    // right channel rides ahead by the stereo offset
    const chOff: f32 = c == 1 ? stereoOff : 0.0;

    for (let f = 0; f < n; f++) {
      let p: f32 = ph + chOff;
      p -= Mathf.floor(p); // wrap to 0..1
      // LFO in -1..1 -> unipolar 0..1
      const lfo01: f32 = lfoShape(p, shape) * 0.5 + 0.5;
      // target gain: swings between (1-depth) and 1 -> Depth=0 leaves signal intact
      const targetG: f32 = 1.0 - depth * (1.0 - lfo01);
      g += smoothC * (targetG - g);

      outBuf[base + f] = inBuf[base + f] * g * outGain;

      ph += phaseInc;
      if (ph >= 1.0) ph -= 1.0;
    }
    lfoPhase[c] = ph;
    gainState[c] = g;
  }
}
