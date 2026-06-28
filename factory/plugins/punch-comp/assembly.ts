// =====================================================================
//  PUNCH COMP — a punchy VCA-style dynamics compressor
//  A stereo-linked RMS+peak detector feeds a dB-domain gain computer with
//  Threshold, Ratio and an over-easy (soft) knee. Attack/Release smooth the
//  gain-reduction envelope in the log domain for clean, musical control, and
//  a makeup Gain restores level. The result tightens loud transients while
//  leaving quiet passages untouched — clean, controlled and punchy.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// detector / envelope state (shared across the stereo pair = stereo-linked)
let rmsState: f32 = 0.0;   // running mean-square for the RMS detector
let grDb: f32 = 0.0;       // current gain reduction in dB (>= 0), smoothed

const P_THRESH:  i32 = 0;  // 0..1 -> threshold  -48..0 dBFS  (low = more comp)
const P_RATIO:   i32 = 1;  // 0..1 -> ratio      1..20:1
const P_ATTACK:  i32 = 2;  // 0..1 -> attack     0.1..80 ms
const P_RELEASE: i32 = 3;  // 0..1 -> release    20..1000 ms
const P_GAIN:    i32 = 4;  // 0..1 -> makeup     0..+24 dB

const KNEE_DB: f32 = 6.0;  // over-easy knee width (dB)
const LN10_20: f32 = 0.11512925; // ln(10)/20, for dB<->linear

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// linear amplitude -> dBFS (guarded), and back
@inline function lin2db(x: f32): f32 {
  const a: f32 = x < 1e-9 ? 1e-9 : x;
  return f32(8.6858896 * Mathf.log(a)); // 20/ln(10) * ln(a)
}
@inline function db2lin(db: f32): f32 {
  return f32(Mathf.exp(db * LN10_20));
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  rmsState = 0.0;
  grDb = 0.0;
  params[P_THRESH]  = 0.35; // ~ -16.8 dBFS — bites on the test bed
  params[P_RATIO]   = 0.30; // ~ 6.7:1
  params[P_ATTACK]  = 0.20; // fast-ish
  params[P_RELEASE] = 0.30; // medium
  params[P_GAIN]    = 0.32; // ~ +7.7 dB makeup
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  // ---- map params to engineering units ----
  const tN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const threshDb: f32 = -48.0 + tN * 48.0;               // -48..0 dBFS

  const rN: f32 = clampf(params[P_RATIO], 0.0, 1.0);
  const ratio: f32 = 1.0 + rN * 19.0;                    // 1..20 : 1
  const slope: f32 = 1.0 - 1.0 / ratio;                  // 0..~0.95

  const aN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const atkMs: f32 = 0.1 + aN * aN * 79.9;               // 0.1..80 ms (curved)
  const relN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const relMs: f32 = 20.0 + relN * relN * 980.0;         // 20..1000 ms (curved)

  // one-pole time-constant coefficients (per-sample) for the dB envelope
  const atkCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (atkMs * 0.001 * sampleRate)));
  const relCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (relMs * 0.001 * sampleRate)));

  // RMS detector window ~ 5 ms -> smoothing coefficient
  const rmsCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.005 * sampleRate)));

  const makeupDb: f32 = clampf(params[P_GAIN], 0.0, 1.0) * 24.0; // 0..+24 dB
  const makeup: f32 = db2lin(makeupDb);

  const halfKnee: f32 = KNEE_DB * 0.5;

  let rms: f32 = rmsState;
  let gr: f32 = grDb;

  const baseL: i32 = 0;
  const baseR: i32 = MAX_FRAMES;
  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    const xL: f32 = inBuf[baseL + f];
    const xR: f32 = stereo ? inBuf[baseR + f] : xL;

    // ---- detector: blend of stereo-linked peak and RMS (punch + body) ----
    const peak: f32 = (xL < 0.0 ? -xL : xL);
    const peakR: f32 = (xR < 0.0 ? -xR : xR);
    const pk: f32 = peak > peakR ? peak : peakR;

    const sq: f32 = (xL * xL + xR * xR) * 0.5;
    rms = rms + rmsCoef * (sq - rms);           // running mean square
    const rmsAmp: f32 = f32(Mathf.sqrt(rms));

    // detector level = mostly peak (punch) with RMS floor (stability)
    const det: f32 = pk > rmsAmp ? pk : rmsAmp;
    const detDb: f32 = lin2db(det);

    // ---- gain computer: over-easy knee static curve -> target GR (dB) ----
    const over: f32 = detDb - threshDb;
    let targetGr: f32;
    if (over <= -halfKnee) {
      targetGr = 0.0;                            // below knee: no reduction
    } else if (over >= halfKnee) {
      targetGr = slope * over;                   // above knee: full ratio
    } else {
      // quadratic interpolation across the knee (over-easy)
      const t: f32 = over + halfKnee;            // 0..KNEE_DB
      targetGr = slope * (t * t) / (2.0 * KNEE_DB);
    }
    if (targetGr < 0.0) targetGr = 0.0;

    // ---- ballistics: attack when clamping down, release when letting go ----
    const coef: f32 = targetGr > gr ? atkCoef : relCoef;
    gr = gr + coef * (targetGr - gr);

    // ---- apply: VCA gain = makeup * 10^(-gr/20) ----
    const g: f32 = makeup * db2lin(-gr);

    outBuf[baseL + f] = xL * g;
    if (stereo) outBuf[baseR + f] = xR * g;
  }

  rmsState = rms;
  grDb = gr;
}
