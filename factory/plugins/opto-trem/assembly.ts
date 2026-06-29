// =====================================================================
//  OPTO TREM — optical multi-shape stereo tremolo (clean amplitude mod)
//  A photocell-style amplitude modulator: an LFO drives a smoothed
//  "lamp brightness" that opens/closes a gain cell. The cell smoothing
//  models the lag of a real photo-resistor (LDR), so even a square LFO
//  pulses musically rather than clicking. A selectable LFO SHAPE
//  (sine / triangle / square / ramp), variable Rate and Depth, and a
//  Stereo control that morphs from a mono tremolo to an auto-pan where
//  the L/R cells run in anti-phase to sweep the image side to side.
//  Pure algorithm, no samples, fully clean (no distortion).
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// LFO phase (0..1) shared; the R channel reads an offset phase in pan mode.
let phase: f32 = 0.0;
// Per-channel smoothed photocell "brightness" (the LDR lag state).
const cellState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_RATE:   i32 = 0; // 0..1 -> 0.1 .. 12 Hz
const P_DEPTH:  i32 = 1; // 0..1 modulation depth
const P_SHAPE:  i32 = 2; // 0..3 stepped: 0 sine, 1 triangle, 2 square, 3 ramp
const P_STEREO: i32 = 3; // 0..1: 0 mono trem -> 1 auto-pan (anti-phase)
const P_MIX:    i32 = 4; // 0..1 dry/wet

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  phase = 0.0;
  for (let c = 0; c < MAX_CHANNELS; c++) cellState[c] = 1.0;
  params[P_RATE] = 0.4;
  params[P_DEPTH] = 0.7;
  params[P_SHAPE] = 0.0;
  params[P_STEREO] = 0.0;
  params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Evaluate the LFO shape at phase p (0..1) -> a unipolar 0..1 brightness,
// where 1 = lamp fully bright (unity gain) and 0 = fully dimmed.
@inline function lfoShape(p: f32, shape: i32): f32 {
  if (shape == 0) {
    // sine: smooth, glassy
    return f32(0.5 - 0.5 * Mathf.cos(PI2 * p));
  } else if (shape == 1) {
    // triangle: linear up/down
    return f32(p < 0.5 ? p * 2.0 : 2.0 - p * 2.0);
  } else if (shape == 2) {
    // square: on/off (cell lag softens the edges)
    return f32(p < 0.5 ? 1.0 : 0.0);
  } else {
    // ramp (sawtooth): bright snap then linear fade down
    return f32(1.0 - p);
  }
}

export function process(n: i32): void {
  const rateN: f32  = clampf(params[P_RATE], 0.0, 1.0);
  const depth: f32  = clampf(params[P_DEPTH], 0.0, 1.0);
  const stereo: f32 = clampf(params[P_STEREO], 0.0, 1.0);
  const mix: f32    = clampf(params[P_MIX], 0.0, 1.0);

  // stepped shape selector -> integer 0..3
  let shapeI: i32 = i32(clampf(params[P_SHAPE], 0.0, 3.0) + 0.5);
  if (shapeI < 0) shapeI = 0;
  if (shapeI > 3) shapeI = 3;

  // Rate maps 0.1..12 Hz (perceptual, slightly curved for slow-end control)
  const rate: f32 = f32(0.1 + rateN * rateN * 11.9);
  const inc: f32 = rate / sampleRate;

  // Photocell lag: faster smoothing as rate rises so fast settings stay
  // crisp while slow settings stay buttery. ~25..220 Hz one-pole corner.
  const lagHz: f32 = f32(25.0 + rate * 16.0);
  const cellCoef: f32 = f32(1.0 - Mathf.exp(-PI2 * lagHz / sampleRate));

  // In pan mode the R channel LFO is phase-shifted toward anti-phase (0.5).
  const phaseOffR: f32 = f32(0.5 * stereo);
  // Gentle gain make-up so a deep tremolo doesn't feel quieter overall.
  const makeup: f32 = f32(1.0 + 0.35 * depth);

  let cl: f32 = cellState[0];
  let cr: f32 = cellState[1];
  let ph: f32 = phase;

  for (let f = 0; f < n; f++) {
    // target brightness for each cell from the LFO
    const bL: f32 = lfoShape(ph, shapeI);
    let pr: f32 = ph + phaseOffR;
    if (pr >= 1.0) pr -= 1.0;
    const bR: f32 = lfoShape(pr, shapeI);

    // smooth toward target (LDR lag)
    cl = f32(cl + cellCoef * (bL - cl));
    cr = f32(cr + cellCoef * (bR - cr));

    // map brightness to a gain that dips by `depth` at minimum brightness
    const gL: f32 = f32((1.0 - depth) + depth * cl);
    const gR: f32 = f32((1.0 - depth) + depth * cr);

    const xL: f32 = inBuf[f];
    const xR: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : xL;

    const wL: f32 = f32(xL * gL * makeup);
    const wR: f32 = f32(xR * gR * makeup);

    outBuf[f] = f32(xL * (1.0 - mix) + wL * mix);
    outBuf[MAX_FRAMES + f] = f32(xR * (1.0 - mix) + wR * mix);

    ph += inc;
    if (ph >= 1.0) ph -= 1.0;
  }

  cellState[0] = cl;
  cellState[1] = cr;
  phase = ph;
}
