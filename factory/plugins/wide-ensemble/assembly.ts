// =====================================================================
//  WIDE ENSEMBLE — lush BBD stereo chorus ensemble + vibrato
//
//  A mono-summed input is fanned into a WIDE stereo chorus: two BBD-style
//  modulated delay lines (L / R) swept by the SAME LFO but in ANTI-PHASE,
//  so the two channels swirl against each other for a big ensemble image.
//  A Mode control morphs from CHORUS (dry + modulated taps) to VIBRATO
//  (pure modulated tap → the whole signal pitch-wobbles). A BBD-darkness
//  Tone low-passes the delayed (wet) path for warm analog character, and
//  a soft saturation on the delay line emulates BBD companding grit.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

// modulated delay line length (per channel). BBD chorus uses short delays;
// ~30 ms max @ 48k -> 1536 samples; round up generously.
const DLINE: i32 = 2048;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// two delay lines (L, R), each DLINE long
const dL: StaticArray<f32> = new StaticArray<f32>(DLINE);
const dR: StaticArray<f32> = new StaticArray<f32>(DLINE);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writeIdx: i32 = 0;
let lfoPhase: f32 = 0.0;
let toneL: f32 = 0.0;   // BBD tone low-pass state (wet path) per channel
let toneR: f32 = 0.0;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const P_RATE: i32 = 0;  // 0..1 -> LFO 0.05..6 Hz
const P_DEPTH: i32 = 1; // 0..1 -> sweep depth
const P_MODE: i32 = 2;  // 0..1 -> chorus(0) <-> vibrato(1) blend
const P_TONE: i32 = 3;  // 0..1 -> BBD darkness (wet LP 700..9000 Hz)
const P_MIX: i32 = 4;   // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < DLINE; i++) { dL[i] = 0.0; dR[i] = 0.0; }
  writeIdx = 0;
  lfoPhase = 0.0;
  toneL = 0.0; toneR = 0.0;
  params[P_RATE] = 0.32; params[P_DEPTH] = 0.55; params[P_MODE] = 0.0;
  params[P_TONE] = 0.45; params[P_MIX] = 0.85;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// soft saturation emulating BBD compander grit; bounded to ~±1
@inline function bbdSat(x: f32): f32 {
  const c: f32 = clampf(x, -1.5, 1.5);
  return c - 0.16666667 * c * c * c;
}

// fractional read from a delay line, linear interpolation, wrapping
@inline function readFrac(d: StaticArray<f32>, w: i32, delay: f32): f32 {
  let rp: f32 = f32(w) - delay;
  while (rp < 0.0) rp += f32(DLINE);
  const i0: i32 = i32(rp);
  const frac: f32 = rp - f32(i0);
  let i1: i32 = i0 + 1; if (i1 >= DLINE) i1 -= DLINE;
  let ii0: i32 = i0; if (ii0 >= DLINE) ii0 -= DLINE;
  return d[ii0] + (d[i1] - d[ii0]) * frac;
}

export function process(n: i32): void {
  const rateN:  f32 = clampf(params[P_RATE], 0.0, 1.0);
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const modeN:  f32 = clampf(params[P_MODE], 0.0, 1.0);
  const toneN:  f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix:    f32 = clampf(params[P_MIX], 0.0, 1.0);

  // LFO rate: 0.05 .. 6 Hz, exponential feel
  const rateHz: f32 = 0.05 + rateN * rateN * 5.95;
  const phInc: f32 = TWO_PI * rateHz / sampleRate;

  // BBD base delay (~7 ms) and sweep span. Vibrato deepens the sweep.
  const baseMs: f32 = 7.0;
  const baseSamp: f32 = baseMs * 0.001 * sampleRate;
  // depth in samples; vibrato mode pushes a deeper sweep for stronger pitch wobble
  const depthSamp: f32 = (0.6 + 3.4 * depthN) * 0.001 * sampleRate * (1.0 + 1.4 * modeN);

  // BBD tone low-pass on the wet path: darker (700 Hz) .. brighter (9000 Hz)
  const toneHz: f32 = 700.0 + toneN * toneN * 8300.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-TWO_PI * toneHz / sampleRate));

  // mode blend: chorus keeps dry-in-wet, vibrato removes it (pure modulated)
  const dryInWet: f32 = 1.0 - modeN; // 1 at chorus, 0 at vibrato

  let ph: f32 = lfoPhase;
  let w: i32 = writeIdx;
  let tL: f32 = toneL;
  let tR: f32 = toneR;

  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    const xl: f32 = inBuf[f];
    const xr: f32 = stereo ? inBuf[MAX_FRAMES + f] : xl;
    // mono sum drives the ensemble (a mono input fanned wide)
    const mono: f32 = (xl + xr) * 0.5;

    // write input (with gentle BBD saturation) into both delay lines
    const din: f32 = bbdSat(mono);
    dL[w] = din;
    dR[w] = din;

    // anti-phase LFO: L uses +sin, R uses -sin → opposite swirl = WIDE image
    const sinv: f32 = f32(Mathf.sin(ph));
    const delL: f32 = baseSamp + depthSamp * (0.5 + 0.5 * sinv);
    const delR: f32 = baseSamp + depthSamp * (0.5 - 0.5 * sinv);

    let wetL: f32 = readFrac(dL, w, delL);
    let wetR: f32 = readFrac(dR, w, delR);

    // BBD darkness tone shaping on the wet path
    tL = tL + cTone * (wetL - tL);
    tR = tR + cTone * (wetR - tR);
    wetL = tL;
    wetR = tR;

    // chorus = dry + wet; vibrato = wet only. modeN morphs between them.
    // normalise so chorus and vibrato sit at similar level (chorus ≈ /1.6).
    const ensL: f32 = (dryInWet * mono + wetL) * (1.0 / (1.0 + 0.6 * dryInWet));
    const ensR: f32 = (dryInWet * mono + wetR) * (1.0 / (1.0 + 0.6 * dryInWet));

    // dry/wet mix against the ORIGINAL (true-stereo) input
    outBuf[f]              = xl * (1.0 - mix) + ensL * mix;
    if (stereo) outBuf[MAX_FRAMES + f] = xr * (1.0 - mix) + ensR * mix;

    // advance
    ph += phInc; if (ph >= TWO_PI) ph -= TWO_PI;
    w++; if (w >= DLINE) w = 0;
  }

  lfoPhase = ph;
  writeIdx = w;
  toneL = tL;
  toneR = tR;
}
