// =====================================================================
//  SWEEP PHASER — 4-stage analog-style phaser
//  A cascade of four first-order all-pass sections whose break frequency
//  is swept by a sine LFO. Mixing the all-pass output with the dry signal
//  produces two moving notches; a feedback/resonance path sharpens them.
//  Controls: Rate, Depth, Feedback, Mix. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const STAGES: i32 = 4;
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// Per-channel all-pass state: STAGES one-pole memories per channel.
const apState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * STAGES);
// Per-channel feedback memory (last wet sample fed back into the chain).
const fbState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
// LFO phase (shared so both channels sweep together, like a true analog unit).
let lfoPhase: f32 = 0.0;

const P_RATE: i32 = 0;  // 0..1 -> 0.05..8 Hz LFO sweep speed
const P_DEPTH: i32 = 1; // 0..1 -> how far the notches sweep
const P_FB: i32 = 2;    // 0..1 -> resonance/feedback amount (sharper notches)
const P_MIX: i32 = 3;   // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  if (channels < 1) channels = 1;
  for (let i = 0; i < MAX_CHANNELS * STAGES; i++) apState[i] = 0.0;
  for (let c = 0; c < MAX_CHANNELS; c++) fbState[c] = 0.0;
  lfoPhase = 0.0;
  params[P_RATE] = 0.35; params[P_DEPTH] = 0.7; params[P_FB] = 0.5; params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  const rateN: f32  = clampf(params[P_RATE], 0.0, 1.0);
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const fbN: f32    = clampf(params[P_FB], 0.0, 1.0);
  const mix: f32    = clampf(params[P_MIX], 0.0, 1.0);

  // LFO speed: 0.05 .. 8 Hz, exponential feel for musical control.
  const rateHz: f32 = 0.05 + rateN * rateN * 7.95;
  const lfoInc: f32 = TWO_PI * rateHz / sampleRate;

  // Feedback: keep < 1 for stability; resonance up to ~0.9.
  const feedback: f32 = fbN * 0.9;

  // All-pass break-frequency sweep range (Hz). The LFO modulates the corner
  // logarithmically between a low and high bound; Depth scales the excursion.
  const fLo: f32 = 200.0;
  const fHiMax: f32 = 1600.0;
  // Depth widens the upper bound of the sweep; min half-octave for audible motion.
  const fHi: f32 = fLo * f32(Mathf.exp((0.35 + depthN * 1.65) * f32(Mathf.log(fHiMax / fLo)) / 2.0));
  const logLo: f32 = f32(Mathf.log(fLo));
  const logHi: f32 = f32(Mathf.log(fHi));
  const logMid: f32 = 0.5 * (logLo + logHi);
  const logRange: f32 = 0.5 * (logHi - logLo);

  const nyq: f32 = sampleRate * 0.5;

  for (let f = 0; f < n; f++) {
    // Sine LFO -> sweep all-pass corner frequency (log domain).
    const lfo: f32 = f32(Mathf.sin(lfoPhase));
    const logF: f32 = logMid + logRange * lfo;
    let fc: f32 = f32(Mathf.exp(logF));
    if (fc > nyq * 0.99) fc = nyq * 0.99;
    if (fc < 20.0) fc = 20.0;

    // First-order all-pass coefficient from tan() bilinear warp.
    const t: f32 = f32(Mathf.tan(PI * fc / sampleRate));
    const a: f32 = (t - 1.0) / (t + 1.0); // in (-1, 1)

    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      const sBase: i32 = c * STAGES;
      const dry: f32 = inBuf[base + f];

      // Inject feedback from previous wet output of this channel.
      let s: f32 = dry + feedback * fbState[c];

      // 4 cascaded first-order all-pass sections (transposed direct form 1):
      //   y[n] = a*x[n] + x[n-1] - a*y[n-1]
      for (let k = 0; k < STAGES; k++) {
        const idx: i32 = sBase + k;
        const z: f32 = apState[idx];
        const y: f32 = a * s + z;
        apState[idx] = s - a * y;
        s = y;
      }

      fbState[c] = s;
      // Notches form where the 4-stage phase-shifted signal sums with dry.
      const wet: f32 = 0.5 * (dry + s);
      let o: f32 = dry + mix * (wet - dry);
      // Safety clamp (feedback can briefly overshoot on transients).
      o = clampf(o, -1.5, 1.5);
      outBuf[base + f] = o;
    }

    lfoPhase += lfoInc;
    if (lfoPhase >= TWO_PI) lfoPhase -= TWO_PI;
  }
}
