// =====================================================================
//  STUDIO DELAY — pristine rackmount DIGITAL delay (effect)
//  A crystal-clear stereo delay: a fractionally-interpolated delay line
//  with feedback, an optional gentle modulation of the read head, and a
//  shelving high/low damping that gradually darkens (or brightens) the
//  repeats. A stereo offset spreads the left/right taps for width. This
//  is a CLEAN digital echo — no tape wow, no bucket-brigade grit — that
//  decays smoothly and stays bounded even near maximum feedback.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: ~2.0 s per channel at 96k is plenty (max time 1.5 s here).
const MAX_DELAY: i32 = 192000;           // 2.0 s @ 96k, per channel
const delayL: StaticArray<f32> = new StaticArray<f32>(MAX_DELAY);
const delayR: StaticArray<f32> = new StaticArray<f32>(MAX_DELAY);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;                    // shared circular write head
let smoothTimeL: f32 = 12000.0;           // smoothed delay length (samples), L
let smoothTimeR: f32 = 12000.0;           // smoothed delay length (samples), R
let lpStateL: f32 = 0.0;                  // damping low-pass state in feedback path
let lpStateR: f32 = 0.0;
let hpStateL: f32 = 0.0;                  // damping high-pass state in feedback path
let hpStateR: f32 = 0.0;
let modPhase: f32 = 0.0;                  // modulation LFO phase 0..1

// Parameter indices --------------------------------------------------
const P_TIME: i32 = 0;        // 0..1 -> 20 ms .. 1500 ms base delay
const P_FEEDBACK: i32 = 1;    // 0..1 -> 0 .. 0.95 regeneration
const P_MOD: i32 = 2;         // 0..1 -> modulation depth (subtle)
const P_DAMP: i32 = 3;        // 0..1 -> 0 = dark repeats .. 0.5 flat .. 1 = bright
const P_WIDTH: i32 = 4;       // 0..1 -> stereo offset between L/R taps
const P_MIX: i32 = 5;         // 0..1 -> dry/wet

const PI: f32 = 3.14159265;
const TWO_PI: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < MAX_DELAY; i++) { delayL[i] = 0.0; delayR[i] = 0.0; }
  writePos = 0;
  smoothTimeL = 0.25 * sampleRate;
  smoothTimeR = 0.25 * sampleRate;
  lpStateL = 0.0; lpStateR = 0.0;
  hpStateL = 0.0; hpStateR = 0.0;
  modPhase = 0.0;
  params[P_TIME] = 0.30;
  params[P_FEEDBACK] = 0.40;
  params[P_MOD] = 0.20;
  params[P_DAMP] = 0.55;
  params[P_WIDTH] = 0.35;
  params[P_MIX] = 0.35;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Read the delay line at a fractional sample distance behind the write head,
// with linear interpolation. `dist` is in samples (>= 1).
@inline function readDelay(line: StaticArray<f32>, dist: f32): f32 {
  let d: f32 = dist;
  if (d < 1.0) d = 1.0;
  const fMax: f32 = f32(MAX_DELAY - 2);
  if (d > fMax) d = fMax;
  // read position = writePos - d (mod MAX_DELAY)
  let rp: f32 = f32(writePos) - d;
  while (rp < 0.0) rp += f32(MAX_DELAY);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1; if (i1 >= MAX_DELAY) i1 -= MAX_DELAY;
  const frac: f32 = rp - f32(i0);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fbN: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const modN: f32 = clampf(params[P_MOD], 0.0, 1.0);
  const dampN: f32 = clampf(params[P_DAMP], 0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Base delay 20 ms .. 1500 ms (quadratic feel for fine control on short times)
  const baseMs: f32 = 20.0 + timeN * timeN * 1480.0;
  let baseSamp: f32 = baseMs * 0.001 * sampleRate;
  const maxSamp: f32 = f32(MAX_DELAY - 4);
  if (baseSamp > maxSamp) baseSamp = maxSamp;
  if (baseSamp < 2.0) baseSamp = 2.0;

  // Stereo offset: spread R tap a little longer for a wider image.
  const offset: f32 = widthN * 0.020 * sampleRate;     // up to 20 ms spread
  let targetL: f32 = baseSamp;
  let targetR: f32 = baseSamp + offset;
  if (targetR > maxSamp) targetR = maxSamp;

  // Feedback up to 0.95 — bounded (never self-oscillates to infinity).
  const fb: f32 = fbN * 0.95;

  // Damping: a one-pole low-pass + a gentle high-pass in the feedback path.
  // dampN < 0.5 -> darker (lower LP cutoff); dampN > 0.5 -> brighter.
  // LP cutoff sweeps 1.2 kHz .. 18 kHz.
  const lpHz: f32 = 1200.0 + dampN * dampN * 16800.0;
  let lpC: f32 = f32(1.0 - Mathf.exp(-TWO_PI * lpHz / sampleRate));
  lpC = clampf(lpC, 0.0, 1.0);
  // Static high-pass ~110 Hz keeps low-end build-up out of the repeats.
  let hpC: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 110.0 / sampleRate));
  hpC = clampf(hpC, 0.0, 1.0);

  // Modulation: subtle ~0.35 Hz chorus-like detune of the read head.
  const modHz: f32 = 0.35;
  const modInc: f32 = modHz / sampleRate;
  const modDepth: f32 = modN * 0.0025 * sampleRate;     // up to ~2.5 ms swing

  // Per-sample smoothing coefficient for delay-time changes (zipper-free).
  const timeSmooth: f32 = 0.0008;

  let tL: f32 = smoothTimeL;
  let tR: f32 = smoothTimeR;
  let lpL: f32 = lpStateL;
  let lpR: f32 = lpStateR;
  let hpL: f32 = hpStateL;
  let hpR: f32 = hpStateR;
  let mph: f32 = modPhase;

  const baseL: i32 = 0;
  const baseR: i32 = MAX_FRAMES;

  for (let f = 0; f < n; f++) {
    const inL: f32 = inBuf[baseL + f];
    const inR: f32 = channels > 1 ? inBuf[baseR + f] : inL;

    // Smooth toward target delay lengths.
    tL += timeSmooth * (targetL - tL);
    tR += timeSmooth * (targetR - tR);

    // Modulation LFO (sine), L & R in slight quadrature for movement.
    mph += modInc; if (mph >= 1.0) mph -= 1.0;
    const modL: f32 = f32(Mathf.sin(TWO_PI * mph)) * modDepth;
    const modR: f32 = f32(Mathf.sin(TWO_PI * mph + 1.5708)) * modDepth;

    let distL: f32 = tL + modL;
    let distR: f32 = tR + modR;
    if (distL < 1.0) distL = 1.0;
    if (distR < 1.0) distR = 1.0;

    // Read the echoes.
    const echoL: f32 = readDelay(delayL, distL);
    const echoR: f32 = readDelay(delayR, distR);

    // Feedback signal = input + echo*fb, then damp before re-writing.
    let fbL: f32 = inL + echoL * fb;
    let fbR: f32 = inR + echoR * fb;

    // Low-pass (darken) in the feedback path.
    lpL += lpC * (fbL - lpL);
    lpR += lpC * (fbR - lpR);
    // High-pass = signal minus its slow component.
    hpL += hpC * (lpL - hpL);
    hpR += hpC * (lpR - hpR);
    const wL: f32 = lpL - hpL;
    const wR: f32 = lpR - hpR;

    // Safety soft-limit on what we feed back so it can't blow up.
    let writeL: f32 = wL;
    let writeR: f32 = wR;
    if (writeL > 1.5) writeL = 1.5; else if (writeL < -1.5) writeL = -1.5;
    if (writeR > 1.5) writeR = 1.5; else if (writeR < -1.5) writeR = -1.5;

    delayL[writePos] = writeL;
    delayR[writePos] = writeR;

    // Output: dry + wet echoes.
    const wetL: f32 = echoL;
    const wetR: f32 = echoR;
    let oL: f32 = inL * (1.0 - mix) + wetL * mix;
    let oR: f32 = inR * (1.0 - mix) + wetR * mix;

    // Final clean ceiling (keeps peak < ~1.0 even with stacked repeats).
    if (oL > 0.999) oL = 0.999; else if (oL < -0.999) oL = -0.999;
    if (oR > 0.999) oR = 0.999; else if (oR < -0.999) oR = -0.999;

    outBuf[baseL + f] = oL;
    outBuf[baseR + f] = oR;

    writePos++; if (writePos >= MAX_DELAY) writePos = 0;
  }

  smoothTimeL = tL;
  smoothTimeR = tR;
  lpStateL = lpL; lpStateR = lpR;
  hpStateL = hpL; hpStateR = hpR;
  modPhase = mph;
}
