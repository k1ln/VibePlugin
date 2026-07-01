// =====================================================================
//  GUSH PHASER — 4-stage OTA phaser (Small Stone lineage)
//  A chain of four first-order allpass filters whose break frequency is
//  swept by a triangle LFO (Rate/Depth move the notches up and down the
//  spectrum). A Color control routes part of the chain output back into
//  its input as resonant FEEDBACK, sharpening the notches into a vocal,
//  "gushing" whoosh. Bounded feedback (no runaway) and a dry/wet Mix.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const NSTAGES: i32 = 4;
// Allpass z-1 state per stage per channel: [channel * NSTAGES + stage]
const apState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NSTAGES);
// Feedback memory (one-sample) per channel
const fbState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
// LFO phase per channel (slight stereo offset for width)
const lfoPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_RATE:  i32 = 0;  // 0..1 -> 0.03 .. 9 Hz (log-ish)
const P_DEPTH: i32 = 1;  // 0..1 -> sweep span of the notches
const P_COLOR: i32 = 2;  // 0..1 -> feedback amount (0 -> intense resonance)
const P_MIX:   i32 = 3;  // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    for (let s = 0; s < NSTAGES; s++) apState[c * NSTAGES + s] = 0.0;
    fbState[c] = 0.0;
    lfoPhase[c] = c == 0 ? 0.0 : 0.25; // 90deg stereo offset
  }
  params[P_RATE] = 0.35; params[P_DEPTH] = 0.7; params[P_COLOR] = 0.5; params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  const rateN:  f32 = clampf(params[P_RATE],  0.0, 1.0);
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const colorN: f32 = clampf(params[P_COLOR], 0.0, 1.0);
  const mix:    f32 = clampf(params[P_MIX],   0.0, 1.0);

  // Rate: exponential map 0.03 .. 9 Hz
  const rateHz: f32 = f32(0.03 * Mathf.exp(rateN * 5.7)); // 0.03 .. ~9
  const lfoInc: f32 = rateHz / sampleRate; // phase per sample (0..1 cycle)

  // Sweep range of the allpass break frequency (Hz). Depth widens/deepens.
  const fLo: f32 = 120.0;
  const fHi: f32 = 120.0 + depthN * 2400.0; // up to ~2.5 kHz top
  const fMid: f32 = f32(Mathf.sqrt(fLo * fHi));

  // Feedback gain, bounded < 0.95 to stay stable & avoid runaway
  const fb: f32 = colorN * 0.92;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const sBase: i32 = c * NSTAGES;
    let ph: f32 = lfoPhase[c];
    let z0: f32 = apState[sBase + 0];
    let z1: f32 = apState[sBase + 1];
    let z2: f32 = apState[sBase + 2];
    let z3: f32 = apState[sBase + 3];
    let fbk: f32 = fbState[c];

    for (let f = 0; f < n; f++) {
      // triangle LFO 0..1 from phase
      const tri: f32 = ph < 0.5 ? (ph * 2.0) : (2.0 - ph * 2.0);
      // log-sweep the break frequency between fLo and fHi
      const fc: f32 = f32(fLo * Mathf.exp(tri * Mathf.log(fHi / fLo)));
      // first-order allpass coefficient: a = (1 - tanFc) / (1 + tanFc)
      const t: f32 = f32(Mathf.tan(PI * fc / sampleRate));
      const a: f32 = (1.0 - t) / (1.0 + t);

      const x: f32 = inBuf[base + f];
      // inject bounded feedback from previous chain output
      let v: f32 = x + fbk * fb;

      // 4 cascaded allpass stages: y = -a*x + z ; z = x + a*y
      let y0: f32 = -a * v + z0;  z0 = v + a * y0;
      let y1: f32 = -a * y0 + z1; z1 = y0 + a * y1;
      let y2: f32 = -a * y1 + z2; z2 = y1 + a * y2;
      let y3: f32 = -a * y2 + z3; z3 = y2 + a * y3;

      fbk = y3; // store for next-sample feedback

      // Classic phaser = dry + phase-shifted (notches at cancellations)
      const wet: f32 = (x + y3) * 0.5;
      const o: f32 = x * (1.0 - mix) + wet * mix;
      outBuf[base + f] = clampf(o, -1.0, 1.0);

      ph += lfoInc;
      if (ph >= 1.0) ph -= 1.0;
    }

    lfoPhase[c] = ph;
    apState[sBase + 0] = z0;
    apState[sBase + 1] = z1;
    apState[sBase + 2] = z2;
    apState[sBase + 3] = z3;
    fbState[c] = fbk;
  }
}
