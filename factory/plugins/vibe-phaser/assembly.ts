// =====================================================================
//  VIBE PHASER — photocell vibe / phaser (Uni-Vibe-style modulation)
//  A 4-stage first-order all-pass phase-shift network swept by a slow,
//  ASYMMETRIC "photocell" LFO (a lamp seen through a light-dependent
//  resistor: fast warm-up, slow cool-down). Each all-pass stage centres
//  on a different frequency and is modulated by a slightly staggered,
//  exponentially-shaped sweep, so the notches glide unevenly — the watery,
//  throbbing movement of a vintage optical vibe. Two voices:
//    • CHORUS   — phase-shifted path mixed back with the dry input
//                 (comb-like notches sweep → shimmering "vibe").
//    • VIBRATO  — 100% wet all-pass output (pure pitch/phase wobble).
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const STAGES: i32 = 4;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// all-pass z-1 state per channel per stage  (channel * STAGES + stage)
const apState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * STAGES);
// LFO phase per channel (stereo spread keeps the two sides drifting apart)
const lfoPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// Per-stage nominal centre frequencies (Hz). A real vibe staggers its four
// photocell-driven all-pass cells across the spectrum; these glide together.
const stageHz: StaticArray<f32> = new StaticArray<f32>(STAGES);
// Per-stage sweep span (Hz) — deeper stages move more, like the staggered cells.
const stageSpan: StaticArray<f32> = new StaticArray<f32>(STAGES);

const P_RATE: i32 = 0;      // 0..1 -> ~0.05 .. 12 Hz throb
const P_DEPTH: i32 = 1;     // 0..1 -> how far the cells sweep
const P_MODE: i32 = 2;      // <0.5 chorus, >=0.5 vibrato (100% wet)
const P_INTENSITY: i32 = 3; // 0..1 -> how hard the lamp drives (sweep curvature / range)
const P_MIX: i32 = 4;       // 0..1 dry/wet (chorus only; vibrato is always 100% wet)

const TWO_PI: f32 = 6.2831853;
const PI: f32 = 3.14159265;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < MAX_CHANNELS * STAGES; i++) apState[i] = 0.0;
  // start the two channels a quarter cycle apart for a wide, living image
  lfoPhase[0] = 0.0;
  lfoPhase[1] = 0.25;

  // four staggered cells, low → high; spans chosen so notches stay musical
  stageHz[0] = 220.0;  stageSpan[0] = 180.0;
  stageHz[1] = 520.0;  stageSpan[1] = 420.0;
  stageHz[2] = 1150.0; stageSpan[2] = 900.0;
  stageHz[3] = 2400.0; stageSpan[3] = 1700.0;

  params[P_RATE] = 0.32;
  params[P_DEPTH] = 0.7;
  params[P_MODE] = 0.0;
  params[P_INTENSITY] = 0.6;
  params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

export function process(n: i32): void {
  const rate01: f32 = clampf(params[P_RATE], 0.0, 1.0);
  const depth01: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const vibrato: bool = params[P_MODE] >= 0.5;
  const intensity: f32 = clampf(params[P_INTENSITY], 0.0, 1.0);
  const mix01: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Rate: exponential 0.05 .. ~12 Hz so the knob feels musical end-to-end.
  const rateHz: f32 = f32(0.05 * Mathf.exp(rate01 * 5.48)); // 0.05 .. ~12 Hz
  const lfoInc: f32 = rateHz / sampleRate;                  // cycles per sample

  // Intensity widens the sweep range and (via the photocell shaping below)
  // bends the optical curve so the throb gets harder and more asymmetric.
  const sweep: f32 = depth01 * (0.45 + 0.55 * intensity); // 0..1 fraction of each span

  // Wet level trim: 4 cascaded all-passes are unity-gain, but the chorus
  // sum (dry+wet) can reach ~2× at the comb peaks — trim so peak stays <1.
  const wetTrim: f32 = vibrato ? 1.0 : 0.5;
  const dryTrim: f32 = vibrato ? 0.0 : 0.5;
  // small safety so blended peaks never exceed ~1.0
  const outGain: f32 = 0.96;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const sbase: i32 = c * STAGES;
    let phase: f32 = lfoPhase[c];

    for (let f = 0; f < n; f++) {
      // --- photocell LFO -------------------------------------------------
      // Start from a sine, then bias it through an exponential transfer so
      // the rise is faster than the fall (lamp heats quick, cools slow):
      // an asymmetric, throbbing 0..1 control voltage.
      const s: f32 = f32(Mathf.sin(phase * TWO_PI)); // -1..1
      const u: f32 = 0.5 + 0.5 * s;                   // 0..1 raw
      // optical shaping: gamma-like curve, asymmetric about the midpoint
      const shaped: f32 = f32(Mathf.pow(u, 1.0 + intensity * 1.4));
      // blend raw + shaped so low intensity stays near a clean sweep
      const cv: f32 = (1.0 - intensity * 0.6) * u + (intensity * 0.6) * shaped;

      // advance LFO
      phase += lfoInc;
      if (phase >= 1.0) phase -= 1.0;

      const x: f32 = inBuf[base + f];

      // --- 4-stage all-pass cascade, each cell swept by the photocell ----
      let y: f32 = x;
      for (let st = 0; st < STAGES; st++) {
        // staggered modulation: deeper stages lag a touch via curve shaping
        const m: f32 = sweep * cv;                 // 0..1 sweep position
        let fc: f32 = stageHz[st] + stageSpan[st] * m * (0.6 + 0.4 * f32(st) / 3.0);
        // keep coefficient stable & below Nyquist
        const nyq: f32 = sampleRate * 0.45;
        if (fc > nyq) fc = nyq;
        if (fc < 20.0) fc = 20.0;
        // first-order all-pass coefficient from tan of the warped corner
        const t: f32 = f32(Mathf.tan(PI * fc / sampleRate));
        let a: f32 = (t - 1.0) / (t + 1.0);
        if (a > 0.999) a = 0.999;
        if (a < -0.999) a = -0.999;
        const z: f32 = apState[sbase + st];
        const ap: f32 = a * y + z;          // all-pass output
        apState[sbase + st] = y - a * ap;   // update state
        y = ap;
      }

      let wet: f32;
      let outv: f32;
      if (vibrato) {
        // VIBRATO: 100% wet — pure swept all-pass (phase/pitch wobble).
        wet = y;
        outv = wet * wetTrim;
      } else {
        // CHORUS: blend dry + phase-shifted path; the sweeping notches give
        // the shimmering optical "vibe". Mix scales the wet contribution.
        wet = x * dryTrim + y * wetTrim;
        outv = x * (1.0 - mix01) + wet * mix01;
      }

      outBuf[base + f] = clampf(outv * outGain, -1.0, 1.0);
    }

    lfoPhase[c] = phase;
  }
}
