// =====================================================================
//  PITCH SHIFTER — delay-line harmonizer
//  A real-time pitch shifter built on a circular delay line read by TWO
//  read pointers that drift at a rate set by the pitch ratio. As each
//  pointer sweeps across the buffer it is crossfaded with the other using
//  a raised-cosine window, so the inevitable wrap discontinuity is masked
//  and the shifted voice stays click-free. The shifted voice is fed back
//  into the line (regeneration / arpeggiated cascades) and blended with
//  the dry signal. Shift sets the interval in semitones, Fine trims it in
//  cents, Feedback regenerates the shifted voice, Mix balances dry/wet.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Circular delay line per channel. ~90 ms window at 48 kHz is plenty for
// a smooth grain while keeping latency/comb artefacts musical.
const LINE_LEN: i32 = 8192;            // power-of-two-ish window per channel
const WINDOW: f32 = 4096.0;            // pointer travel before re-seed (samples)
const delayL: StaticArray<f32> = new StaticArray<f32>(LINE_LEN);
const delayR: StaticArray<f32> = new StaticArray<f32>(LINE_LEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;

// two read phases (0..WINDOW), offset by half a window so one is fading in
// while the other fades out.
let phaseA: f32 = 0.0;
let phaseB: f32 = WINDOW * 0.5;

// smoothed pitch ratio to avoid zipper noise when Shift/Fine move
let smoothRatio: f32 = 1.0;

const P_SHIFT: i32 = 0;     // -12..+12 semitones (integer selector, step 1)
const P_FINE: i32 = 1;      // -100..+100 cents (continuous)
const P_FEEDBACK: i32 = 2;  // 0..1 -> 0..0.85 regeneration
const P_MIX: i32 = 3;       // 0..1 dry/wet

const TWO_PI: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0;
  phaseA = 0.0;
  phaseB = WINDOW * 0.5;
  smoothRatio = 1.0;
  for (let i = 0; i < LINE_LEN; i++) { delayL[i] = 0.0; delayR[i] = 0.0; }
  params[P_SHIFT] = 7.0;     // a perfect fifth up — instantly hear the harmony
  params[P_FINE] = 0.0;
  params[P_FEEDBACK] = 0.0;
  params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// read a delay line at a fractional sample distance behind the write head,
// linear interpolation, wrap-safe.
@inline function readLine(line: StaticArray<f32>, delaySamples: f32): f32 {
  let rp: f32 = f32(writePos) - delaySamples;
  while (rp < 0.0) rp += f32(LINE_LEN);
  while (rp >= f32(LINE_LEN)) rp -= f32(LINE_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1;
  if (i1 >= LINE_LEN) i1 = 0;
  const frac: f32 = rp - f32(i0);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  // Shift: integer semitones, -12..+12.
  let semis: f32 = clampf(params[P_SHIFT], -12.0, 12.0);
  // Fine: cents, -100..+100.
  const cents: f32 = clampf(params[P_FINE], -100.0, 100.0);
  const fbN: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // target pitch ratio: 2^((semitones + cents/100) / 12)
  const totalSemis: f32 = semis + cents * 0.01;
  const targetRatio: f32 = f32(Mathf.pow(2.0, totalSemis / 12.0));

  // feedback gain — bounded well below 1 so cascades stay finite.
  const fbGain: f32 = fbN * 0.85;

  // The delay-tap pointers move at (1 - ratio) per sample relative to the
  // write head: when ratio > 1 (up) the read delay must SHRINK so the tap
  // reads faster than write (higher pitch); when ratio < 1 (down) the delay
  // grows. We sweep within [0, WINDOW] and wrap, masking the jump with the
  // raised-cosine crossfade window.

  // smoothing coeff for the ratio (~12 Hz corner) to avoid zipper noise.
  const smoothCoeff: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 12.0 / sampleRate));

  const stereo: bool = channels > 1;
  const invW: f32 = 1.0 / WINDOW;

  for (let f = 0; f < n; f++) {
    smoothRatio += smoothCoeff * (targetRatio - smoothRatio);
    const r: f32 = 1.0 - smoothRatio;

    const xL: f32 = inBuf[f];
    const xR: f32 = stereo ? inBuf[MAX_FRAMES + f] : xL;

    // raised-cosine crossfade weights from the two phases.
    const wA: f32 = f32(0.5 - 0.5 * Mathf.cos(TWO_PI * phaseA * invW));
    const wB: f32 = f32(0.5 - 0.5 * Mathf.cos(TWO_PI * phaseB * invW));

    // shifted voice = windowed sum of the two taps (small base delay keeps
    // the tap inside the line and away from the write head).
    const base: f32 = 2.0;
    const shiftedL: f32 = readLine(delayL, base + phaseA) * wA
                        + readLine(delayL, base + phaseB) * wB;
    const shiftedR: f32 = stereo
                        ? (readLine(delayR, base + phaseA) * wA
                         + readLine(delayR, base + phaseB) * wB)
                        : shiftedL;

    // write input + regenerated shifted voice back into the line.
    delayL[writePos] = f32(xL + shiftedL * fbGain);
    if (stereo) delayR[writePos] = f32(xR + shiftedR * fbGain);
    else delayR[writePos] = delayL[writePos];

    // advance phases; wrap within the window. The two phases stay a half
    // window apart so the crossfade is seamless.
    phaseA += r;
    phaseB += r;
    while (phaseA >= WINDOW) phaseA -= WINDOW;
    while (phaseA < 0.0) phaseA += WINDOW;
    while (phaseB >= WINDOW) phaseB -= WINDOW;
    while (phaseB < 0.0) phaseB += WINDOW;

    // gain-stage the wet voice a touch; the windowed sum has unity-ish gain.
    const wetL: f32 = shiftedL;
    const wetR: f32 = shiftedR;

    outBuf[f] = f32(xL * (1.0 - mix) + wetL * mix);
    if (stereo) outBuf[MAX_FRAMES + f] = f32(xR * (1.0 - mix) + wetR * mix);
    else outBuf[MAX_FRAMES + f] = outBuf[f];

    writePos++;
    if (writePos >= LINE_LEN) writePos = 0;
  }
}
