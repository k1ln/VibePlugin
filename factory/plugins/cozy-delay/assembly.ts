// =====================================================================
//  COZY DELAY — warm, dark, SHORT bucket-brigade-style analog delay
//  A compact BBD slapback-to-short-echo in the ~20..300 ms range. Each
//  repeat is rolled DARKER and SOFTER than the last: a one-pole low-pass
//  AND a high-pass sit inside the feedback loop to model the bandwidth
//  loss of a bucket-brigade chip, and the recirculating signal is gently
//  saturated so it compresses and warms with every pass. A whisper of
//  slow drift keeps it from sounding sterile. Short, intimate, cosy.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Delay line: short range, ~300 ms max + drift headroom. Sized for up to
// 96 kHz so 0.34 s * 96000 ≈ 32640 samples; round up generously.
const DELAY_LEN: i32 = 36864; // ~384 ms @ 96k, plenty for 300 ms + mod
const delayL: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
const delayR: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;

// per-channel feedback filter states (BBD darkening per pass)
let fbLpL: f32 = 0.0; // low-pass: rolls off highs each repeat
let fbLpR: f32 = 0.0;
let fbHpL: f32 = 0.0; // high-pass state: trims sub each repeat (intimacy)
let fbHpR: f32 = 0.0;

// smoothed delay time (samples) to avoid zipper noise
let smoothDelay: f32 = 3600.0;

// gentle drift (single slow LFO, very shallow — not a chorus)
let driftPhase: f32 = 0.0;

const P_TIME: i32 = 0;     // 0..1 -> 20..300 ms (short/slap range)
const P_FEEDBACK: i32 = 1; // 0..1 -> 0..0.92 (clamped)
const P_TONE: i32 = 2;     // 0..1 -> repeat darkness (LP cutoff in loop)
const P_MIX: i32 = 3;      // 0..1 dry/wet

const TWO_PI: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0;
  fbLpL = 0.0; fbLpR = 0.0;
  fbHpL = 0.0; fbHpR = 0.0;
  driftPhase = 0.0;
  for (let i = 0; i < DELAY_LEN; i++) { delayL[i] = 0.0; delayR[i] = 0.0; }
  smoothDelay = 0.12 * sampleRate; // ~120 ms default
  params[P_TIME] = 0.38;     // ~120 ms cosy short echo
  params[P_FEEDBACK] = 0.42;
  params[P_TONE] = 0.4;      // leans dark by default
  params[P_MIX] = 0.4;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

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

// soft, warm saturator — gentle, less aggressive than full tanh so quiet
// repeats stay clean and only the hot recirculation compresses.
@inline function warmSat(x: f32): f32 {
  const c: f32 = clampf(x, -2.5, 2.5);
  return f32(Mathf.tanh(c * 0.85)) * 1.12;
}

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fbN: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Time: 20..300 ms — short slapback to short echo only. Perceptual curve.
  const timeMs: f32 = 20.0 + timeN * timeN * 280.0;
  let targetDelay: f32 = timeMs * 0.001 * sampleRate;
  const maxDelay: f32 = f32(DELAY_LEN - 8);
  if (targetDelay > maxDelay) targetDelay = maxDelay;
  if (targetDelay < 4.0) targetDelay = 4.0;

  // Feedback gain — clamped to 0.92 so the repeats stack and ring but never
  // run away. The in-loop darkening + level loss keeps it tidy below that.
  const fbGain: f32 = clampf(fbN * 0.92, 0.0, 0.92);

  // Feedback low-pass: darker overall than a long-delay echo. Cutoff sweeps
  // ~520 Hz (very dark/cosy) .. ~4800 Hz (still soft, never bright/sizzly).
  const toneHz: f32 = 520.0 + toneN * toneN * 4280.0;
  let cTone: f32 = f32(1.0 - Mathf.exp(-TWO_PI * toneHz / sampleRate));
  cTone = clampf(cTone, 0.0, 1.0);

  // Feedback high-pass corner ~150 Hz — strips sub-bud from each repeat so
  // they sit back intimately instead of building boom. (one-pole HP coeff)
  const cHp: f32 = clampf(f32(1.0 - Mathf.exp(-TWO_PI * 150.0 / sampleRate)), 0.0, 1.0);

  // Very gentle drift: shallow, slow — adds analog life, not pitch warble.
  const driftDepth: f32 = 0.0009 * sampleRate; // ~0.9 ms max
  const driftRate: f32 = 0.45; // Hz
  const driftInc: f32 = TWO_PI * driftRate / sampleRate;

  // one-pole smoothing coeff for delay time (~10 Hz)
  const smoothCoeff: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 10.0 / sampleRate));

  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    driftPhase += driftInc; if (driftPhase >= TWO_PI) driftPhase -= TWO_PI;
    const drift: f32 = Mathf.sin(driftPhase) * driftDepth;

    smoothDelay += smoothCoeff * (targetDelay - smoothDelay);

    // slight per-channel drift offset for a touch of width
    let dL: f32 = smoothDelay + drift;
    let dR: f32 = smoothDelay - drift * 0.7;
    if (dL < 2.0) dL = 2.0; if (dL > maxDelay) dL = maxDelay;
    if (dR < 2.0) dR = 2.0; if (dR > maxDelay) dR = maxDelay;

    const xL: f32 = inBuf[f];
    const xR: f32 = stereo ? inBuf[MAX_FRAMES + f] : xL;

    // read the delayed (echo) signal
    const echoL: f32 = readDelay(delayL, dL);
    const echoR: f32 = readDelay(delayR, dR);

    // --- progressive darkening in the feedback path ---
    // low-pass: each pass loses highs
    fbLpL += cTone * (echoL - fbLpL);
    fbLpR += cTone * (echoR - fbLpR);
    // high-pass: subtract a slow integrator -> trims sub each pass
    fbHpL += cHp * (fbLpL - fbHpL);
    fbHpR += cHp * (fbLpR - fbHpR);
    const darkL: f32 = fbLpL - fbHpL; // band-limited, cosy repeat
    const darkR: f32 = fbLpR - fbHpR;

    // recirculate: dry input + warmly saturated, darkened feedback
    const fbInL: f32 = warmSat(xL + darkL * fbGain);
    const fbInR: f32 = warmSat(xR + darkR * fbGain);

    delayL[writePos] = fbInL;
    delayR[writePos] = fbInR;

    // wet tap = the band-limited darkened repeat (cosy character on the
    // first repeat too, not just deep in the tail)
    const wetL: f32 = darkL;
    const wetR: f32 = darkR;

    let oL: f32 = f32(xL * (1.0 - mix) + wetL * mix);
    let oR: f32 = f32(xR * (1.0 - mix) + wetR * mix);

    // safety clamp — keep peaks under ~1.0
    oL = clampf(oL, -1.0, 1.0);
    oR = clampf(oR, -1.0, 1.0);

    outBuf[f] = oL;
    if (stereo) outBuf[MAX_FRAMES + f] = oR;
    else outBuf[MAX_FRAMES + f] = oL;

    writePos++;
    if (writePos >= DELAY_LEN) writePos = 0;
  }
}
