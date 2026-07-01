// =====================================================================
//  QUAD DIMENSION — button-mode dimensional stereo chorus
//
//  A clean, hi-fi dimensional widener with FOUR fixed MODE buttons instead
//  of rate/depth knobs. Each mode (1 = subtle .. 4 = widest) preselects a
//  dimensional "size": a pair of short, gently de-tuned delay taps per
//  channel feed an ANTI-PHASE side signal that decorrelates and widens a
//  source with almost no audible pitch wobble. The modulation is kept
//  extremely slow and shallow on purpose — it shimmers, it does not warble.
//
//  The wet image is built as MID + WIDTH * SIDE, where SIDE is the
//  anti-phase difference of the two modulated taps. This means even a mono
//  source is thrown wide (the taps differ between L and R), while the mono
//  sum stays stable. A tilt "Tone" adds top-end sparkle to the wet only.
//
//  Params:
//    0  Mode   stepped 1..4  -> four dimensional width presets
//    1  Width  0..1          -> stereo spread (scales the side signal)
//    2  Tone   0..1          -> dark .. bright tilt on the wet
//    3  Mix    0..1          -> dry/wet (Mix = 0 is exactly dry)
//
//  Pure algorithm, no samples. All f32, no alloc in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Two delay lines (one per channel). ~85 ms at 48 kHz — far more than needed.
const DLEN: i32 = 4096;
const DMASK: i32 = DLEN - 1;
const dlineL: StaticArray<f32> = new StaticArray<f32>(DLEN);
const dlineR: StaticArray<f32> = new StaticArray<f32>(DLEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let widx: i32 = 0;

// Quadrature LFO phases — deliberately VERY slow so there is essentially no
// audible pitch wobble; they only keep the comb from being perfectly static.
let phaseA: f32 = 0.0;
let phaseB: f32 = 0.25;

// Wet tilt smoothers (one-pole low-pass per channel for the bright/dark tilt).
let lpL: f32 = 0.0;
let lpR: f32 = 0.0;

// Smoothed control values (avoid zipper noise when a mode/knob changes).
let sSpread: f32 = 0.0;   // tap spread in samples
let sSweep:  f32 = 0.0;   // modulation depth in samples
let sSide:   f32 = 0.0;   // intrinsic anti-phase amount for the mode

const P_MODE:  i32 = 0;
const P_WIDTH: i32 = 1;
const P_TONE:  i32 = 2;
const P_MIX:   i32 = 3;

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < DLEN; i++) { dlineL[i] = 0.0; dlineR[i] = 0.0; }
  widx = 0;
  phaseA = 0.0;
  phaseB = 0.25;
  lpL = 0.0;
  lpR = 0.0;
  sSpread = 0.0;
  sSweep = 0.0;
  sSide = 0.0;
  params[P_MODE]  = 0.0;   // Mode 1 (presented 1..4, stored 0..3)
  params[P_WIDTH] = 0.7;
  params[P_TONE]  = 0.5;
  params[P_MIX]   = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Fractional read from a delay line (linear interpolation). `delay` in samples.
@inline function readDelay(line: StaticArray<f32>, wi: i32, delay: f32): f32 {
  let d: f32 = delay;
  if (d < 1.0) d = 1.0;
  const rp: f32 = f32(wi) - d;
  let i0: i32 = i32(Mathf.floor(rp));
  const frac: f32 = rp - f32(i0);
  i0 = i0 & DMASK; if (i0 < 0) i0 += DLEN;
  const i1: i32 = (i0 + 1) & DMASK;
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const mode: i32 = i32(clampf(params[P_MODE], 0.0, 3.0) + 0.5);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Four dimensional presets. Each picks a base delay, a tap SPREAD (the
  // L/R offset that builds the anti-phase side), an intrinsic side gain,
  // and an LFO rate. Higher mode = wider + thicker (more spread + side),
  // but the LFO stays slow throughout so the pitch stays clean.
  let baseMs:  f32 = 8.0;
  let spreadMs: f32 = 2.0;   // half-difference between the two taps (ms)
  let sideAmt: f32 = 0.35;   // intrinsic anti-phase contribution
  let sweepMs: f32 = 0.35;   // modulation depth (ms) — tiny on purpose
  let rateHz:  f32 = 0.12;
  if (mode == 1)      { baseMs = 9.0;  spreadMs = 3.2; sideAmt = 0.55; sweepMs = 0.45; rateHz = 0.16; }
  else if (mode == 2) { baseMs = 11.0; spreadMs = 4.6; sideAmt = 0.78; sweepMs = 0.55; rateHz = 0.21; }
  else if (mode == 3) { baseMs = 13.0; spreadMs = 6.2; sideAmt = 1.00; sweepMs = 0.65; rateHz = 0.27; }

  const baseSmp:   f32 = baseMs   * 0.001 * sampleRate;
  const spreadSmp: f32 = spreadMs * 0.001 * sampleRate;
  const sweepSmp:  f32 = sweepMs  * 0.001 * sampleRate;
  const inc: f32 = rateHz / sampleRate;

  // Wet tilt: blend between a low-passed (dark) and a high-shelf-boosted
  // (bright/sparkle) version of the wet. one-pole corner ~ tied to Tone.
  const toneHz: f32 = 1200.0 + toneN * 6000.0;
  const tc: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * toneHz / sampleRate)), 0.0, 1.0);
  // sparkle gain on the high band; brighter Tone => more top
  const hiGain: f32 = 0.6 + toneN * 1.1;

  // Side gain: mode intrinsic amount scaled by Width. Bounded so the widest
  // mode at full Width still keeps the mono sum and peaks in check.
  const sideGain: f32 = sideAmt * (0.35 + 0.65 * widthN);

  // one-pole smoothing of control values (per-block, gentle)
  const smc: f32 = 0.002;
  sSpread += smc * (spreadSmp - sSpread);
  sSweep  += smc * (sweepSmp  - sSweep);
  sSide   += smc * (sideGain  - sSide);

  const baseL: i32 = 0;
  const baseR: i32 = MAX_FRAMES;

  let pA: f32 = phaseA;
  let pB: f32 = phaseB;
  let wi: i32 = widx;
  let zL: f32 = lpL;
  let zR: f32 = lpR;

  for (let f = 0; f < n; f++) {
    const inL: f32 = inBuf[baseL + f];
    const inR: f32 = channels > 1 ? inBuf[baseR + f] : inL;

    // write current input
    dlineL[wi] = inL;
    dlineR[wi] = inR;

    // mid (mono sum) preserved straight through the wet path
    const mid: f32 = 0.5 * (inL + inR);

    // two quadrature, very slow LFOs
    const modA: f32 = Mathf.sin(PI2 * pA);
    const modB: f32 = Mathf.sin(PI2 * pB);

    // The two taps sit on opposite sides of the base delay (spread) and
    // move in opposite directions under the slow LFO. Their DIFFERENCE is
    // the anti-phase side; their average tracks the mid colour.
    const sp: f32 = sSpread;
    const sw: f32 = sSweep;
    const tap1: f32 = readDelay(dlineL, wi, baseSmp - sp + sw * modA);
    const tap2: f32 = readDelay(dlineR, wi, baseSmp + sp - sw * modB);

    // anti-phase side signal (decorrelated, opposite on L vs R)
    const side: f32 = sSide * (tap1 - tap2) * 0.5;

    // wet image = preserved mid +/- side
    let wetL: f32 = mid + side;
    let wetR: f32 = mid - side;

    // Tone tilt applied to the wet: split into low (one-pole) and high
    // (residual) bands and re-weight the highs for clean sparkle.
    zL = zL + tc * (wetL - zL);
    zR = zR + tc * (wetR - zR);
    const hiL: f32 = wetL - zL;
    const hiR: f32 = wetR - zR;
    wetL = zL + hiL * hiGain;
    wetR = zR + hiR * hiGain;

    // gentle output trim so the widest mode stays comfortably below 1.0
    wetL *= 0.85;
    wetR *= 0.85;

    outBuf[baseL + f] = inL * (1.0 - mix) + wetL * mix;
    if (channels > 1) outBuf[baseR + f] = inR * (1.0 - mix) + wetR * mix;

    wi = (wi + 1) & DMASK;
    pA += inc; if (pA >= 1.0) pA -= 1.0;
    pB += inc; if (pB >= 1.0) pB -= 1.0;
  }

  phaseA = pA;
  phaseB = pB;
  widx = wi;
  lpL = zL;
  lpR = zR;
}
