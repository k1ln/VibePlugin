// =====================================================================
//  BUCKET ECHO — analog bucket-brigade-style delay
//  A modulated, interpolated delay line with a feedback path. Each repeat
//  is progressively darker: a one-pole low-pass sits inside the feedback
//  loop to mimic the bandwidth loss of a bucket-brigade device. A slow
//  wow/flutter LFO modulates the delay time for the unstable, vintage
//  pitch wander. Feedback is clamped so near-max self-oscillation stays
//  bounded. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: up to ~1.0 s per channel at 96 kHz keeps headroom for the
// 800 ms max time plus modulation depth.
const DELAY_LEN: i32 = 96000 + 8192;
const delayL: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
const delayR: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;

// per-channel feedback low-pass state (BBD darkening)
let fbLpL: f32 = 0.0;
let fbLpR: f32 = 0.0;

// smoothed delay time (samples) to avoid zipper noise on Time changes
let smoothDelay: f32 = 9600.0;

// wow/flutter LFOs (two slightly detuned phases per channel for organic drift)
let lfoPhase: f32 = 0.0;
let flutPhase: f32 = 0.0;

const P_TIME: i32 = 0;   // 0..1 -> 20..800 ms
const P_FEEDBACK: i32 = 1; // 0..1 -> 0..0.95 (clamped)
const P_TONE: i32 = 2;   // 0..1 -> repeat darkness (LP cutoff in feedback)
const P_MOD: i32 = 3;    // 0..1 -> wow depth
const P_MIX: i32 = 4;    // 0..1 dry/wet

const TWO_PI: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0;
  fbLpL = 0.0;
  fbLpR = 0.0;
  lfoPhase = 0.0;
  flutPhase = 0.0;
  for (let i = 0; i < DELAY_LEN; i++) { delayL[i] = 0.0; delayR[i] = 0.0; }
  smoothDelay = 0.18 * sampleRate; // ~180 ms default
  params[P_TIME] = 0.22;     // ~190 ms
  params[P_FEEDBACK] = 0.45;
  params[P_TONE] = 0.5;
  params[P_MOD] = 0.35;
  params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

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
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const modN: f32 = clampf(params[P_MOD], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Time: 20..800 ms (perceptual-ish curve), in samples.
  const timeMs: f32 = 20.0 + timeN * timeN * 780.0;
  let targetDelay: f32 = timeMs * 0.001 * sampleRate;
  const maxDelay: f32 = f32(DELAY_LEN - 4);
  if (targetDelay > maxDelay) targetDelay = maxDelay;
  if (targetDelay < 4.0) targetDelay = 4.0;

  // Feedback gain — strictly clamped to 0.95 so self-oscillation can ring
  // but never diverge.
  const fbGain: f32 = clampf(fbN * 0.95, 0.0, 0.95);

  // Feedback low-pass: brighter when Tone high, darker when low.
  // Cutoff ~700 Hz (dark) .. ~7000 Hz (bright).
  const toneHz: f32 = 700.0 + toneN * toneN * 6300.0;
  let cTone: f32 = f32(1.0 - Mathf.exp(-TWO_PI * toneHz / sampleRate));
  cTone = clampf(cTone, 0.0, 1.0);

  // Wow/flutter: depth scales with Mod. Keep modulation in samples small
  // relative to delay so it stays musical and never reads out of range.
  // depth up to ~6 ms wow + a faster, shallower flutter.
  const wowDepth: f32 = modN * 0.006 * sampleRate;     // samples
  const flutDepth: f32 = modN * 0.0012 * sampleRate;   // samples
  const wowRate: f32 = 0.7;   // Hz
  const flutRate: f32 = 6.3;  // Hz
  const wowInc: f32 = TWO_PI * wowRate / sampleRate;
  const flutInc: f32 = TWO_PI * flutRate / sampleRate;

  // one-pole smoothing coeff for delay time (~30 ms)
  const smoothCoeff: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 8.0 / sampleRate));

  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    // advance LFOs
    lfoPhase += wowInc; if (lfoPhase >= TWO_PI) lfoPhase -= TWO_PI;
    flutPhase += flutInc; if (flutPhase >= TWO_PI) flutPhase -= TWO_PI;
    const wow: f32 = Mathf.sin(lfoPhase);
    const flut: f32 = Mathf.sin(flutPhase);

    // smooth the base delay toward target
    smoothDelay += smoothCoeff * (targetDelay - smoothDelay);

    // modulated read distance (channels offset slightly for width)
    const modOffset: f32 = wow * wowDepth + flut * flutDepth;
    let dL: f32 = smoothDelay + modOffset;
    let dR: f32 = smoothDelay - modOffset * 0.85;
    if (dL < 2.0) dL = 2.0; if (dL > maxDelay) dL = maxDelay;
    if (dR < 2.0) dR = 2.0; if (dR > maxDelay) dR = maxDelay;

    const xL: f32 = inBuf[f];
    const xR: f32 = stereo ? inBuf[MAX_FRAMES + f] : xL;

    // read the delayed (echo) signal
    const echoL: f32 = readDelay(delayL, dL);
    const echoR: f32 = readDelay(delayR, dR);

    // darken the feedback signal (progressive bandwidth loss per repeat)
    fbLpL += cTone * (echoL - fbLpL);
    fbLpR += cTone * (echoR - fbLpR);

    // soft-saturate the feedback so runaway oscillation stays bounded and
    // gets the warm BBD compression character.
    let fbInL: f32 = xL + fbLpL * fbGain;
    let fbInR: f32 = xR + fbLpR * fbGain;
    fbInL = f32(Mathf.tanh(fbInL));
    fbInR = f32(Mathf.tanh(fbInR));

    // write into the delay line at the head
    delayL[writePos] = fbInL;
    delayR[writePos] = fbInR;

    // wet = the delayed signal (already tone-shaped reads come from line)
    const wetL: f32 = echoL;
    const wetR: f32 = echoR;

    outBuf[f] = f32(xL * (1.0 - mix) + wetL * mix);
    if (stereo) outBuf[MAX_FRAMES + f] = f32(xR * (1.0 - mix) + wetR * mix);
    else outBuf[MAX_FRAMES + f] = outBuf[f];

    writePos++;
    if (writePos >= DELAY_LEN) writePos = 0;
  }
}
