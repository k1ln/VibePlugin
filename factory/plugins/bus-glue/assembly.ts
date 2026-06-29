// =====================================================================
//  BUS GLUE — stereo VCA bus compressor (the classic mix "glue")
//  A feed-forward, RMS-ish level detector watches the summed program and
//  drives a smooth soft-knee gain reduction computed in the dB domain.
//  The SAME gain is applied to L and R (stereo-linked) so the image never
//  wanders — it just gets tighter and punchier. A loud bus compresses
//  noticeably more than a quiet one; Makeup restores level and Mix blends
//  in the dry signal for parallel "New York" glue. No samples, no imports.
//
//  Params: Threshold, Ratio (stepped 2:1/4:1/10:1), Attack, Release,
//  Makeup, Mix.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// detector / envelope state (single linked detector for L+R) -----------
let rmsEnv: f32 = 0.0;   // smoothed mean-square of the side-chain
let grDb:   f32 = 0.0;   // current gain reduction in dB (>= 0)

// exported scalar so the GUI can poll gain reduction for the VU needle
let lastGrDb: f32 = 0.0;

const P_THRESH:  i32 = 0;  // 0..1 -> -40..0 dBFS threshold
const P_RATIO:   i32 = 1;  // 0/1/2 -> 2:1 / 4:1 / 10:1 (discrete)
const P_ATTACK:  i32 = 2;  // 0..1 -> 30 ms .. 0.1 ms (1 = fastest)
const P_RELEASE: i32 = 3;  // 0..1 -> 0.1 s .. 1.2 s
const P_MAKEUP:  i32 = 4;  // 0..1 -> 0 .. +24 dB
const P_MIX:     i32 = 5;  // 0..1 dry/wet (parallel)

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function lin2db(x: f32): f32 { return f32(8.6858896 * Mathf.log(x + 1.0e-9)); } // 20/ln10
@inline function db2lin(x: f32): f32 { return f32(Mathf.exp(x * 0.11512925)); }         // ln10/20

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  rmsEnv = 0.0;
  grDb = 0.0;
  lastGrDb = 0.0;
  params[P_THRESH]  = 0.45; // ~ -22 dB
  params[P_RATIO]   = 1.0;  // 4:1
  params[P_ATTACK]  = 0.40;
  params[P_RELEASE] = 0.40; // ~ 0.54 s
  params[P_MAKEUP]  = 0.30; // ~ +7.2 dB
  params[P_MIX]     = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }
export function getGainReductionDb(): f32 { return lastGrDb; }

export function process(n: i32): void {
  const thN:  f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const atN:  f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const relN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const mkN:  f32 = clampf(params[P_MAKEUP], 0.0, 1.0);
  const mix:  f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Threshold: -40 dBFS (heavy glue) .. 0 dBFS (clean)
  const threshDb: f32 = -40.0 + thN * 40.0;

  // Discrete ratio selector -> 2 / 4 / 10
  const sel: i32 = i32(clampf(params[P_RATIO], 0.0, 2.0) + 0.5);
  let ratio: f32 = 4.0;
  if (sel <= 0) ratio = 2.0;
  else if (sel == 1) ratio = 4.0;
  else ratio = 10.0;
  const slope: f32 = 1.0 - 1.0 / ratio; // dB pulled back per dB over threshold

  // Soft knee width in dB (gentle, classy bus-glue knee)
  const knee: f32 = 6.0;
  const halfKnee: f32 = knee * 0.5;

  // Attack: 30 ms (slow) .. 0.1 ms (fast). atN=1 -> fastest.
  const atkMs: f32 = 30.0 * f32(Mathf.pow(0.0033333, atN)); // 30 -> 0.1 ms
  const atkCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.001 * atkMs * sampleRate)));

  // Release: 0.1 s .. 1.2 s
  const relS: f32 = 0.1 + relN * 1.1;
  const relCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (relS * sampleRate)));

  // RMS detector smoothing (~10 ms window) for the "averaging" feel
  const rmsCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.010 * sampleRate)));

  // Makeup 0..+24 dB
  const makeup: f32 = db2lin(24.0 * mkN);

  let rEnv: f32 = rmsEnv;
  let gr: f32 = grDb;
  let maxGrDb: f32 = 0.0;

  const chan: i32 = channels;
  const baseR: i32 = MAX_FRAMES; // right-channel offset

  for (let f = 0; f < n; f++) {
    const l: f32 = inBuf[f];
    const r: f32 = chan > 1 ? inBuf[baseR + f] : l;

    // stereo-linked side-chain: mean of squares (RMS-ish), smoothed
    const sq: f32 = 0.5 * (l * l + r * r);
    rEnv += rmsCoef * (sq - rEnv);
    const det: f32 = rEnv > 1.0e-12 ? rEnv : 1.0e-12;

    // mean-square -> dBFS  (10*log10(ms) == 20*log10(rms))
    const levelDb: f32 = 0.5 * lin2db(det);

    // soft-knee static curve -> target gain reduction (dB, >= 0)
    const over: f32 = levelDb - threshDb;
    let targetGr: f32;
    if (over <= -halfKnee) {
      targetGr = 0.0;
    } else if (over >= halfKnee) {
      targetGr = slope * over;
    } else {
      const x: f32 = over + halfKnee; // 0..knee
      targetGr = slope * (x * x) / (2.0 * knee);
    }

    // attack when more reduction is wanted, release when less
    const coef: f32 = targetGr > gr ? atkCoef : relCoef;
    gr += coef * (targetGr - gr);
    if (gr < 0.0) gr = 0.0;
    if (gr > maxGrDb) maxGrDb = gr;

    // dB gain reduction -> linear gain, applied EQUALLY to L and R
    const g: f32 = db2lin(-gr) * makeup;
    const wetL: f32 = l * g;
    const wetR: f32 = r * g;

    // parallel blend; soft-bound to keep peaks < ~1.0
    const oL: f32 = l * (1.0 - mix) + wetL * mix;
    const oR: f32 = r * (1.0 - mix) + wetR * mix;
    outBuf[f] = f32(Mathf.tanh(oL * 0.85)) * 1.05;
    if (chan > 1) outBuf[baseR + f] = f32(Mathf.tanh(oR * 0.85)) * 1.05;
  }

  rmsEnv = rEnv;
  grDb = gr;
  lastGrDb = maxGrDb;
}
