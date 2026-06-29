// =====================================================================
//  BRICKWALL — look-ahead brickwall limiter
//  A short look-ahead delay feeds a fast peak detector that computes the
//  exact gain reduction needed so the output never exceeds the Ceiling.
//  The reduction is reached BEFORE the peak arrives (because the audio is
//  delayed by the look-ahead window), then recovers over an adjustable
//  Release. Threshold sets the input drive into the limiter and Gain is a
//  post makeup trim. Transparent on quiet input, an absolute wall on loud.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// look-ahead ring buffer (per channel) + a shared envelope of the peak that
// is "coming up" within the look-ahead window.
const LOOKAHEAD: i32 = 256;                 // ~5.3 ms @ 48k look-ahead window
const delayBuf: StaticArray<f32> = new StaticArray<f32>(LOOKAHEAD * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;       // ring write index (0..LOOKAHEAD-1)
let gainEnv: f32 = 1.0;      // current applied gain (gain reduction, <= 1)
let attackCoef: f32 = 0.0;   // smoothing toward a deeper reduction

const P_THRESHOLD: i32 = 0;  // 0..1 -> input drive 0..+24 dB into the limiter
const P_CEILING: i32 = 1;    // 0..1 -> output ceiling -24..0 dB (linear 0.063..1.0)
const P_RELEASE: i32 = 2;    // 0..1 -> release 1..600 ms
const P_GAIN: i32 = 3;       // 0..1 -> makeup -12..+12 dB

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < LOOKAHEAD * MAX_CHANNELS; i++) delayBuf[i] = 0.0;
  writePos = 0;
  gainEnv = 1.0;
  // attack reaches the target reduction across the look-ahead window so the
  // gain is fully down by the time the peak emerges from the delay line.
  attackCoef = f32(1.0 - Mathf.exp(-5.0 / f32(LOOKAHEAD)));
  params[P_THRESHOLD] = 0.0;
  params[P_CEILING] = 1.0;
  params[P_RELEASE] = 0.25;
  params[P_GAIN] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// dB (decibels) -> linear amplitude
@inline function dbToLin(db: f32): f32 { return f32(Mathf.exp(db * 0.11512925)); }

export function process(n: i32): void {
  const thrN: f32 = clampf(params[P_THRESHOLD], 0.0, 1.0);
  const ceilN: f32 = clampf(params[P_CEILING], 0.0, 1.0);
  const relN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const gainN: f32 = clampf(params[P_GAIN], 0.0, 1.0);

  // input drive into the limiter: 0..+24 dB
  const drive: f32 = dbToLin(thrN * 24.0);
  // output ceiling: -24..0 dB  -> linear 0.0631..1.0
  const ceiling: f32 = dbToLin(-24.0 + ceilN * 24.0);
  // makeup: -12..+12 dB
  const makeup: f32 = dbToLin(-12.0 + gainN * 24.0);

  // release time 1..600 ms -> one-pole recovery coefficient
  const relMs: f32 = 1.0 + relN * relN * 599.0;
  const relSamples: f32 = clampf(relMs * 0.001 * sampleRate, 1.0, 1.0e6);
  const releaseCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / relSamples));

  let g: f32 = gainEnv;
  let wp: i32 = writePos;

  for (let f = 0; f < n; f++) {
    // 1) drive the (interleaved-by-channel) input and find this frame's peak
    //    across channels, then push the driven samples into the delay line.
    let peak: f32 = 0.0;
    for (let c = 0; c < channels; c++) {
      const x: f32 = inBuf[c * MAX_FRAMES + f] * drive;
      delayBuf[c * LOOKAHEAD + wp] = x;
      const a: f32 = x < 0.0 ? -x : x;
      if (a > peak) peak = a;
    }

    // 2) target gain so the upcoming peak lands exactly on the ceiling.
    let target: f32 = 1.0;
    if (peak > ceiling) target = ceiling / peak;   // peak > 0 here, safe divide

    // 3) attack instantly (over the look-ahead window) toward a deeper cut,
    //    release slowly back up — classic limiter envelope.
    if (target < g) {
      g += attackCoef * (target - g);
    } else {
      g += releaseCoef * (target - g);
    }

    // 4) read the delayed sample (oldest in the ring) and apply gain + makeup.
    //    the write just happened at wp, so the oldest is the NEXT slot.
    const readPos: i32 = wp + 1 >= LOOKAHEAD ? 0 : wp + 1;
    for (let c = 0; c < channels; c++) {
      let y: f32 = delayBuf[c * LOOKAHEAD + readPos] * g * makeup;
      // hard brickwall safety clamp: never let makeup push past the ceiling.
      if (y > ceiling) y = ceiling;
      else if (y < -ceiling) y = -ceiling;
      outBuf[c * MAX_FRAMES + f] = y;
    }

    wp = wp + 1 >= LOOKAHEAD ? 0 : wp + 1;
  }

  gainEnv = g;
  writePos = wp;
}
