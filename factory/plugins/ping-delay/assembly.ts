// =====================================================================
//  PING DELAY — stereo ping-pong / multi-tap delay
//  A cross-fed stereo delay: the wet signal bounces between the left and
//  right channels so each repeat alternates sides. On top of the main
//  ping-pong echo sit extra rhythmic taps (the Taps control adds and
//  pans a chain of fractional-time echoes), a one-pole tone low-pass that
//  darkens every repeat, and a width control that spreads the bounce. A
//  tanh saturator in the feedback path keeps near-max feedback ringing but
//  bounded. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: up to ~1.5 s per channel at 48 kHz plus headroom. The base
// ping-pong time tops out at ~1 s and the extra taps read further back, so
// the line must be long enough for the longest tap.
const DELAY_LEN: i32 = 96000 + 8192;
const delayL: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
const delayR: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;

// feedback tone-LP state (per channel)
let fbLpL: f32 = 0.0;
let fbLpR: f32 = 0.0;

// smoothed delay time (samples) to avoid zipper noise on Time changes
let smoothDelay: f32 = 9600.0;

const P_TIME: i32 = 0;     // 0..1 -> 30..1000 ms
const P_FEEDBACK: i32 = 1; // 0..1 -> 0..0.92 (clamped)
const P_TAPS: i32 = 2;     // 0..1 -> density/level of extra rhythmic taps
const P_TONE: i32 = 3;     // 0..1 -> repeat darkness (LP cutoff in feedback)
const P_WIDTH: i32 = 4;    // 0..1 -> stereo spread of the bounce
const P_MIX: i32 = 5;      // 0..1 dry/wet

const TWO_PI: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0;
  fbLpL = 0.0;
  fbLpR = 0.0;
  for (let i = 0; i < DELAY_LEN; i++) { delayL[i] = 0.0; delayR[i] = 0.0; }
  smoothDelay = 0.3 * sampleRate; // ~300 ms default
  params[P_TIME] = 0.33;     // ~300 ms
  params[P_FEEDBACK] = 0.45;
  params[P_TAPS] = 0.4;
  params[P_TONE] = 0.55;
  params[P_WIDTH] = 0.8;
  params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// read a delay line at a fractional sample distance behind the write head,
// linear interpolation, wrap-safe.
@inline function readDelay(line: StaticArray<f32>, delaySamples: f32): f32 {
  let rp: f32 = f32(writePos) - delaySamples;
  while (rp < 0.0) rp += f32(DELAY_LEN);
  while (rp >= f32(DELAY_LEN)) rp -= f32(DELAY_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1;
  if (i1 >= DELAY_LEN) i1 = 0;
  const frac: f32 = rp - f32(i0);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fbN: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const tapsN: f32 = clampf(params[P_TAPS], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Time: 30..1000 ms (perceptual-ish curve), in samples.
  const timeMs: f32 = 30.0 + timeN * timeN * 970.0;
  let targetDelay: f32 = timeMs * 0.001 * sampleRate;
  const maxDelay: f32 = f32(DELAY_LEN - 8);
  // The longest extra tap reads at ~1.85x the base time, so cap the base so
  // every tap stays inside the line.
  const tapMax: f32 = maxDelay / 1.9;
  if (targetDelay > tapMax) targetDelay = tapMax;
  if (targetDelay < 8.0) targetDelay = 8.0;

  // Feedback gain — clamped so the ping-pong can ring near self-oscillation
  // but never diverges.
  const fbGain: f32 = clampf(fbN * 0.92, 0.0, 0.92);

  // Feedback tone low-pass: brighter when Tone high, darker when low.
  // Cutoff ~600 Hz (dark) .. ~9000 Hz (bright).
  const toneHz: f32 = 600.0 + toneN * toneN * 8400.0;
  let cTone: f32 = f32(1.0 - Mathf.exp(-TWO_PI * toneHz / sampleRate));
  cTone = clampf(cTone, 0.0, 1.0);

  // one-pole smoothing coeff for delay time (~8 Hz corner)
  const smoothCoeff: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 8.0 / sampleRate));

  // Width: 0 = mono-ish (taps centred), 1 = hard ping-pong with the extra
  // taps thrown wide. Used to scale the L/R spread of every wet component.
  const spread: f32 = widthN;

  // Taps: a chain of three extra echoes between the main repeats, panned
  // alternately. Their overall level rises with the Taps control so the knob
  // audibly thickens the pattern; at 0 only the clean ping-pong remains.
  const tapLvl: f32 = tapsN;

  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    // smooth the base delay toward target
    smoothDelay += smoothCoeff * (targetDelay - smoothDelay);
    const d: f32 = smoothDelay;

    const xL: f32 = inBuf[f];
    const xR: f32 = stereo ? inBuf[MAX_FRAMES + f] : xL;
    const xMono: f32 = (xL + xR) * 0.5;

    // --- main ping-pong tap (one full delay back) ---
    const echoL: f32 = readDelay(delayL, d);
    const echoR: f32 = readDelay(delayR, d);

    // --- extra rhythmic taps at fractional sub-divisions, alternately panned.
    // tap A at 1/2 d (centre-ish), tap B at 5/4 d (left), tap C at 7/4 d (right)
    const tA: f32 = readDelay(delayL, d * 0.5) * 0.6;
    const tB: f32 = readDelay(delayR, d * 1.25) * 0.5;
    const tC: f32 = readDelay(delayL, d * 1.75) * 0.42;

    // pan the extra taps: A centre, B to the left, C to the right; the spread
    // pushes them outward as Width rises.
    const tapL: f32 = tapLvl * (tA + tB * (0.5 + 0.5 * spread) + tC * (0.5 - 0.5 * spread));
    const tapR: f32 = tapLvl * (tA + tB * (0.5 - 0.5 * spread) + tC * (0.5 + 0.5 * spread));

    // --- wet bus: ping-pong cross-fed echoes plus the extra taps.
    // Width crossfades each side between the centre sum (narrow) and the
    // opposite-channel bounce (wide ping-pong).
    const sumLR: f32 = (echoL + echoR) * 0.5;
    const wetL: f32 = (sumLR + (echoR - sumLR) * spread) + tapL;
    const wetR: f32 = (sumLR + (echoL - sumLR) * spread) + tapR;

    // --- feedback path: cross-couple L<->R so repeats bounce sides, darken
    // with the tone LP, and soft-saturate so high feedback stays bounded.
    fbLpL += cTone * (echoR - fbLpL); // note the cross: L line fed by R echo
    fbLpR += cTone * (echoL - fbLpR);

    let fbInL: f32 = xMono + fbLpL * fbGain;
    let fbInR: f32 = xMono + fbLpR * fbGain;
    fbInL = f32(Mathf.tanh(fbInL));
    fbInR = f32(Mathf.tanh(fbInR));

    delayL[writePos] = fbInL;
    delayR[writePos] = fbInR;

    // gain-stage the wet a touch so dense taps + feedback stay below full-scale
    const wL: f32 = wetL * 0.7;
    const wR: f32 = wetR * 0.7;

    outBuf[f] = f32(xL * (1.0 - mix) + wL * mix);
    if (stereo) outBuf[MAX_FRAMES + f] = f32(xR * (1.0 - mix) + wR * mix);
    else outBuf[MAX_FRAMES + f] = outBuf[f];

    writePos++;
    if (writePos >= DELAY_LEN) writePos = 0;
  }
}
