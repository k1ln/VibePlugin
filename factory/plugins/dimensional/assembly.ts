// =====================================================================
//  DIMENSIONAL — dimensional BBD-style stereo chorus
//  Two short bucket-brigade delay lines per channel, gently pitch-
//  modulated by quadrature LFOs and cross-fed L<->R. The modulation is
//  deliberately subtle: it widens and animates a mono source into a
//  spacious stereo image with very little obvious wobble. A Mode selector
//  (1..4) picks four intensity presets in the classic dimensional spirit.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay lines — one per channel. Sized for ~40 ms at 96 kHz (plenty).
const DLEN: i32 = 4096;
const DMASK: i32 = DLEN - 1;
const dlineL: StaticArray<f32> = new StaticArray<f32>(DLEN);
const dlineR: StaticArray<f32> = new StaticArray<f32>(DLEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// write head + per-channel LFO phases (quadrature => stereo motion)
let widx: i32 = 0;
let phaseL: f32 = 0.0;
let phaseR: f32 = 0.25; // 90° apart for stereo de-correlation

// one-pole smoothers for the modulated delay (BBD-ish gentle top loss)
let bbdL: f32 = 0.0;
let bbdR: f32 = 0.0;

const P_MODE:  i32 = 0;  // 0..3 (step 1) -> four intensity presets
const P_DEPTH: i32 = 1;  // 0..1 modulation depth
const P_WIDTH: i32 = 2;  // 0..1 stereo cross-feed / spread
const P_MIX:   i32 = 3;  // 0..1 dry/wet

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < DLEN; i++) { dlineL[i] = 0.0; dlineR[i] = 0.0; }
  widx = 0;
  phaseL = 0.0;
  phaseR = 0.25;
  bbdL = 0.0;
  bbdR = 0.0;
  params[P_MODE]  = 0.0;
  params[P_DEPTH] = 0.5;
  params[P_WIDTH] = 0.6;
  params[P_MIX]   = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// fractional read from a delay line, linear interpolation. `delay` in samples.
@inline function readDelay(line: StaticArray<f32>, wi: i32, delay: f32): f32 {
  let d: f32 = delay;
  if (d < 1.0) d = 1.0;
  const rp: f32 = f32(wi) - d;
  let i0: i32 = i32(Mathf.floor(rp));
  const frac: f32 = rp - f32(i0);
  i0 = i0 & DMASK; if (i0 < 0) i0 += DLEN;
  let i1: i32 = (i0 + 1) & DMASK;
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const mode: i32 = i32(clampf(params[P_MODE], 0.0, 3.0) + 0.5);
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Four intensity presets (rate Hz, base delay ms, sweep ms, cross-feed).
  // Higher modes = a touch faster + deeper + wider, in the dimensional spirit.
  let rateHz: f32 = 0.45;
  let baseMs: f32 = 4.0;
  let sweepMs: f32 = 1.4;
  let xfeed: f32 = 0.30;
  if (mode == 1) { rateHz = 0.55; baseMs = 5.0; sweepMs = 1.9; xfeed = 0.45; }
  else if (mode == 2) { rateHz = 0.72; baseMs = 6.5; sweepMs = 2.6; xfeed = 0.62; }
  else if (mode == 3) { rateHz = 0.95; baseMs = 8.0; sweepMs = 3.4; xfeed = 0.80; }

  const baseSmp: f32 = baseMs * 0.001 * sampleRate;
  const sweepSmp: f32 = sweepMs * 0.001 * sampleRate * depthN;
  const inc: f32 = rateHz / sampleRate;

  // cross-feed amount scaled by Width; the wet of each side mixes the
  // opposite channel's modulated tap to throw the image wide.
  const cross: f32 = xfeed * widthN;
  const direct: f32 = 1.0 - 0.5 * cross;

  // gentle BBD top-end softening coefficient (~one-pole LP near 6 kHz)
  const bbdC: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * 6000.0 / sampleRate)), 0.0, 1.0);

  const baseL: i32 = 0;
  const baseR: i32 = MAX_FRAMES;

  let pL: f32 = phaseL;
  let pR: f32 = phaseR;
  let wi: i32 = widx;
  let zL: f32 = bbdL;
  let zR: f32 = bbdR;

  for (let f = 0; f < n; f++) {
    const inL: f32 = inBuf[baseL + f];
    const inR: f32 = channels > 1 ? inBuf[baseR + f] : inL;

    // write into the delay lines
    dlineL[wi] = inL;
    dlineR[wi] = inR;

    // quadrature LFOs -> two opposing modulated delays
    const modL: f32 = Mathf.sin(PI2 * pL);
    const modR: f32 = Mathf.sin(PI2 * pR);
    const delL: f32 = baseSmp + sweepSmp * modL;
    const delR: f32 = baseSmp - sweepSmp * modR;

    let tapL: f32 = readDelay(dlineL, wi, delL);
    let tapR: f32 = readDelay(dlineR, wi, delR);

    // BBD softening
    zL = zL + bbdC * (tapL - zL);
    zR = zR + bbdC * (tapR - zR);
    tapL = zL;
    tapR = zR;

    // cross-feed for width: each side gets its own tap plus a slice of the other
    const wetL: f32 = direct * tapL + cross * tapR;
    const wetR: f32 = direct * tapR + cross * tapL;

    outBuf[baseL + f] = inL * (1.0 - mix) + wetL * mix;
    if (channels > 1) outBuf[baseR + f] = inR * (1.0 - mix) + wetR * mix;

    wi = (wi + 1) & DMASK;
    pL += inc; if (pL >= 1.0) pL -= 1.0;
    pR += inc; if (pR >= 1.0) pR -= 1.0;
  }

  phaseL = pL;
  phaseR = pR;
  widx = wi;
  bbdL = zL;
  bbdR = zR;
}
