// =====================================================================
//  SOFT OPTO — a smooth optical leveling amplifier (generic opto-comp
//  model). A slow photocell-style detector gives gentle, program-dependent
//  gain reduction with a soft knee and a touch of warmth; gentler and
//  slower than the factory's other compressors. Controls: Threshold,
//  Ratio, Makeup, Tone (post tilt), Mix. No host imports, no allocation in
//  process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let env: f32 = 0.0;        // linked opto detector
let gr: f32 = 1.0;         // smoothed gain
let tiltL: f32 = 0.0; let tiltR: f32 = 0.0;

const P_THRESH: i32 = 0; const P_RATIO: i32 = 1; const P_MAKEUP: i32 = 2; const P_TONE: i32 = 3; const P_MIX: i32 = 4;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  env = 0.0; gr = 1.0; tiltL = 0.0; tiltR = 0.0;
  params[P_THRESH] = 0.5; params[P_RATIO] = 0.5; params[P_MAKEUP] = 0.5; params[P_TONE] = 0.5; params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  const threshN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const ratioN: f32 = clampf(params[P_RATIO], 0.0, 1.0);
  const makeupN: f32 = clampf(params[P_MAKEUP], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // threshold ~ -36..0 dB (linear), ratio 1.2:1 .. 8:1
  const thr: f32 = f32(Mathf.exp((threshN - 1.0) * 4.0));   // 0.018 .. 1.0
  const ratio: f32 = 1.2 + ratioN * 6.8;
  const slope: f32 = 1.0 - 1.0 / ratio;
  // opto-style smoothing (slow, program-dependent)
  const atk: f32 = f32(Mathf.exp(-1.0 / (0.008 * sampleRate)));
  const rel: f32 = f32(Mathf.exp(-1.0 / (0.18 * sampleRate)));
  const makeup: f32 = 0.6 + makeupN * 1.7;
  const tilt: f32 = (toneN - 0.5) * 1.4;
  const tco: f32 = 0.2;
  const dry: f32 = 1.0 - mix;
  const stereo: i32 = 1;

  for (let i = 0; i < n; i++) {
    const xl: f32 = inBuf[i];
    const xr: f32 = stereo ? inBuf[MAX_FRAMES + i] : xl;
    const det: f32 = (xl < 0.0 ? -xl : xl) + (xr < 0.0 ? -xr : xr);
    // smooth detector
    env = det > env ? env * atk + det * (1.0 - atk) : env * rel + det * (1.0 - rel);
    // soft-knee gain reduction (work in a gentle log-ish domain)
    let target: f32 = 1.0;
    if (env > thr) {
      const over: f32 = env / thr;     // >1
      target = f32(Mathf.pow(over, -slope));
    }
    gr += (target - gr) * 0.02;        // extra opto smoothing
    let yl: f32 = xl * gr * makeup;
    let yr: f32 = xr * gr * makeup;
    // tone tilt
    tiltL += (yl - tiltL) * tco; const hl: f32 = yl - tiltL;
    yl = yl + (tilt > 0.0 ? hl * tilt : tiltL * (-tilt));
    tiltR += (yr - tiltR) * tco; const hr: f32 = yr - tiltR;
    yr = yr + (tilt > 0.0 ? hr * tilt : tiltR * (-tilt));
    let ol: f32 = xl * dry + yl * mix;
    let orr: f32 = xr * dry + yr * mix;
    if (ol > 1.5) ol = 1.5; else if (ol < -1.5) ol = -1.5;
    if (orr > 1.5) orr = 1.5; else if (orr < -1.5) orr = -1.5;
    outBuf[i] = ol; outBuf[MAX_FRAMES + i] = orr;
  }
}
