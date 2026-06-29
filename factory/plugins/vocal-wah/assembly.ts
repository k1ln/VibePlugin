// =====================================================================
//  VOCAL WAH — inductor-style resonant wah / auto-wah
//  A state-variable band-pass whose centre frequency is swept either by
//  a manual Pedal position OR by an envelope follower (Auto mode). The
//  resonant peak rides over a musical range with adjustable Q. Models the
//  vocal "wah" sweep of a classic rocking treadle, voiced as an original
//  algorithm. Pure DSP, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// State-variable filter state (per channel)
const svLow:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const svBand: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// Envelope follower (shared mono detector drives the auto sweep)
let envFollow: f32 = 0.0;
// Smoothed sweep position so Pedal moves and Auto tracking are click-free
let sweepSmooth: f32 = 0.0;

const P_PEDAL: i32 = 0;  // 0..1 manual treadle position (heel..toe)
const P_Q: i32 = 1;      // 0..1 -> resonance / sharpness of the peak
const P_RANGE: i32 = 2;  // 0..1 -> how far the sweep travels
const P_MODE: i32 = 3;   // 0 = manual, 1 = auto (envelope), integer step
const P_MIX: i32 = 4;    // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) { svLow[c] = 0.0; svBand[c] = 0.0; }
  envFollow = 0.0;
  sweepSmooth = 0.0;
  params[P_PEDAL] = 0.5;
  params[P_Q] = 0.6;
  params[P_RANGE] = 0.7;
  params[P_MODE] = 0.0;
  params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function process(n: i32): void {
  const pedal: f32 = clampf(params[P_PEDAL], 0.0, 1.0);
  const qN: f32 = clampf(params[P_Q], 0.0, 1.0);
  const rangeN: f32 = clampf(params[P_RANGE], 0.0, 1.0);
  const mode: i32 = params[P_MODE] >= 0.5 ? 1 : 0;
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Sweep span: low corner is fixed; Range opens the top of the travel.
  // f_min ~ 320 Hz, f_max ~ 320 + (up to ~2200) Hz.
  const fMin: f32 = 320.0;
  const fSpan: f32 = 400.0 + rangeN * 2200.0;

  // Resonance: damping factor. Higher Q -> lower damping -> sharper peak.
  // Keep a floor so the SVF stays stable and never self-oscillates wildly.
  const damp: f32 = 0.30 - qN * 0.26;            // 0.30 .. 0.04
  const dampClamped: f32 = damp < 0.04 ? 0.04 : damp;

  // Envelope follower coefficients (attack faster than release).
  const atkC: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.005 * sampleRate)));
  const relC: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.120 * sampleRate)));

  // Position smoothing toward the target (manual pedal or auto envelope).
  const posC: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.012 * sampleRate)));

  // Output trim: a resonant band-pass can peak, so pull the wet level down
  // as Q rises to keep the gain stage bounded below ~1.0.
  const wetTrim: f32 = 0.55 - qN * 0.33;          // 0.55 .. 0.22

  for (let f = 0; f < n; f++) {
    // --- Mono detector for the auto sweep (sum of available channels) ---
    let det: f32 = inBuf[f];
    if (channels > 1) det = (det + inBuf[MAX_FRAMES + f]) * 0.5;
    const rect: f32 = det < 0.0 ? -det : det;
    const coef: f32 = rect > envFollow ? atkC : relC;
    envFollow = envFollow + coef * (rect - envFollow);

    // --- Target sweep position in 0..1 ---
    let target: f32 = pedal;
    if (mode == 1) {
      // Auto: louder input pushes the peak upward. Scale the envelope.
      let e: f32 = envFollow * 6.0;
      if (e > 1.0) e = 1.0;
      target = e;
    }
    sweepSmooth = sweepSmooth + posC * (target - sweepSmooth);

    // Map position to centre frequency (perceptually exponential).
    const fc: f32 = fMin + fSpan * sweepSmooth * sweepSmooth;
    let fcc: f32 = fc;
    const fcMax: f32 = sampleRate * 0.45;
    if (fcc > fcMax) fcc = fcMax;
    if (fcc < 20.0) fcc = 20.0;

    // SVF tuning coefficient (Chamberlin form).
    let g: f32 = f32(2.0 * Mathf.sin(3.14159265 * fcc / sampleRate));
    if (g > 0.99) g = 0.99;

    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      const x: f32 = inBuf[base + f];

      let low: f32 = svLow[c];
      let band: f32 = svBand[c];

      // One state-variable iteration.
      low = low + g * band;
      const high: f32 = x - low - dampClamped * band;
      band = band + g * high;

      // Clamp band state to keep the resonator bounded.
      if (band > 4.0) band = 4.0; else if (band < -4.0) band = -4.0;
      if (low > 4.0) low = 4.0; else if (low < -4.0) low = -4.0;

      svLow[c] = low;
      svBand[c] = band;

      // Soft saturation on the resonant peak keeps output bounded below ~1.0.
      let wet: f32 = band * wetTrim;
      if (wet > 1.0) wet = 1.0; else if (wet < -1.0) wet = -1.0;
      wet = 1.5 * wet - 0.5 * wet * wet * wet;
      const out: f32 = x * (1.0 - mix) + wet * mix;
      outBuf[base + f] = out * 0.92;
    }
  }
}
