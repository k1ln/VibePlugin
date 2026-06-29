// =====================================================================
//  BUS GLUE — VCA-style stereo bus compressor (the classic mix "glue")
//  A stereo-linked RMS detector feeds a dB-domain gain computer with a
//  gentle soft knee and three switchable ratios (2:1 / 4:1 / 10:1).
//  Stepped Attack and Release time constants (with an auto-release option
//  baked into the slowest setting) shape a smooth gain-reduction envelope;
//  a makeup gain restores level. Loud, dense material is gently pulled
//  together more than quiet passages — pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// detector / envelope state (mono-linked) ------------------------------
let rmsEnv: f32 = 0.0;   // smoothed mean-square of the link signal
let grEnv:  f32 = 1.0;   // current gain-reduction multiplier (1 = no GR)
let arEnv:  f32 = 0.0;   // slow envelope used for the auto-release mode

// exported scalar so the GUI could poll reduction if it wanted to
let lastGainReductionDb: f32 = 0.0;

const P_THRESH:  i32 = 0;  // 0..1 -> threshold  0 dB .. -40 dB
const P_RATIO:   i32 = 1;  // 0/1/2 -> 2:1 / 4:1 / 10:1
const P_ATTACK:  i32 = 2;  // 0..1 -> 30 ms .. 0.1 ms
const P_RELEASE: i32 = 3;  // 0..1 -> 0.1 s .. 1.2 s (top = auto)
const P_MAKEUP:  i32 = 4;  // 0..1 -> 0 .. +24 dB

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  rmsEnv = 0.0;
  grEnv = 1.0;
  arEnv = 0.0;
  lastGainReductionDb = 0.0;
  params[P_THRESH] = 0.45;
  params[P_RATIO] = 1.0;     // 4:1
  params[P_ATTACK] = 0.4;
  params[P_RELEASE] = 0.5;
  params[P_MAKEUP] = 0.3;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }
export function getGainReductionDb(): f32 { return lastGainReductionDb; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// fast-ish dB helpers in f32
@inline function lin2db(x: f32): f32 { return f32(8.6858896 * Mathf.log(x + 1e-9)); } // 20/ln10
@inline function db2lin(x: f32): f32 { return f32(Mathf.exp(x * 0.11512925)); }       // ln10/20

export function process(n: i32): void {
  const thN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const ratioSel: f32 = clampf(params[P_RATIO], 0.0, 2.0);
  const atN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const relN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const mkN: f32 = clampf(params[P_MAKEUP], 0.0, 1.0);

  // Threshold: 0 dB (clean) .. -40 dB (heavy glue)
  const threshDb: f32 = -40.0 * thN;

  // Discrete ratio selector -> 2 / 4 / 10
  const sel: i32 = i32(ratioSel + 0.5);
  let ratio: f32 = 4.0;
  if (sel <= 0) ratio = 2.0;
  else if (sel == 1) ratio = 4.0;
  else ratio = 10.0;
  const slope: f32 = f32(1.0 - 1.0 / ratio); // amount of dB pulled back per dB over

  // Soft knee width in dB (gentle bus-glue knee)
  const knee: f32 = 6.0;
  const halfKnee: f32 = knee * 0.5;

  // Attack: 30 ms (slow) .. 0.1 ms (fast). atN=1 -> fastest.
  const atkMs: f32 = 30.0 * f32(Mathf.pow(0.0033333, atN)); // 30 -> 0.1 ms
  const atkCoef: f32 = f32(Mathf.exp(-1.0 / (0.001 * atkMs * sampleRate)));

  // Release: 0.1 s .. 1.2 s; the very top is "auto" (program-dependent).
  const autoMode: bool = relN > 0.92;
  const relS: f32 = 0.1 + relN * 1.1;
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (relS * sampleRate)));
  // auto-release uses a dual time constant blended by recent activity
  const relFastCoef: f32 = f32(Mathf.exp(-1.0 / (0.08 * sampleRate)));
  const relSlowCoef: f32 = f32(Mathf.exp(-1.0 / (0.9 * sampleRate)));
  const arCoef: f32 = f32(Mathf.exp(-1.0 / (0.25 * sampleRate)));

  // RMS detector smoothing (~10 ms window)
  const rmsCoef: f32 = f32(Mathf.exp(-1.0 / (0.010 * sampleRate)));

  // Makeup 0..+24 dB
  const makeup: f32 = db2lin(24.0 * mkN);

  let rEnv: f32 = rmsEnv;
  let g: f32 = grEnv;
  let ar: f32 = arEnv;
  let maxGrDb: f32 = 0.0;

  const chan: i32 = channels;
  const baseR: i32 = MAX_FRAMES; // right-channel offset

  for (let f = 0; f < n; f++) {
    const l: f32 = inBuf[f];
    const r: f32 = chan > 1 ? inBuf[baseR + f] : l;

    // stereo-linked detector: mean of squares of the two channels
    const sq: f32 = (l * l + r * r) * 0.5;
    rEnv = rEnv * rmsCoef + sq * (1.0 - rmsCoef);
    const rms: f32 = f32(Mathf.sqrt(rEnv));
    const levelDb: f32 = lin2db(rms);

    // soft-knee gain computer (target gain reduction in dB, negative)
    const over: f32 = levelDb - threshDb;
    let grDb: f32 = 0.0;
    if (over <= -halfKnee) {
      grDb = 0.0;
    } else if (over >= halfKnee) {
      grDb = -slope * over;
    } else {
      // quadratic knee
      const x: f32 = over + halfKnee; // 0..knee
      grDb = -slope * (x * x) / (2.0 * knee);
    }

    const targetGain: f32 = db2lin(grDb); // <= 1

    // smooth toward target: fast attack when pulling down, slower release up
    if (targetGain < g) {
      g = atkCoef * g + (1.0 - atkCoef) * targetGain;
    } else {
      let rc: f32 = relCoef;
      if (autoMode) {
        // program-dependent: blend fast/slow by how much GR is being released
        ar = arCoef * ar + (1.0 - arCoef) * (targetGain - g);
        const blend: f32 = clampf(ar * 40.0, 0.0, 1.0);
        rc = relSlowCoef + (relFastCoef - relSlowCoef) * blend;
      }
      g = rc * g + (1.0 - rc) * targetGain;
    }

    const curGrDb: f32 = -lin2db(g);
    if (curGrDb > maxGrDb) maxGrDb = curGrDb;

    const gm: f32 = g * makeup;
    // gentle output saturator: ~unity for normal levels, soft-bounds to ±1
    const oL: f32 = f32(Mathf.tanh(l * gm));
    const oR: f32 = f32(Mathf.tanh(r * gm));

    outBuf[f] = oL;
    if (chan > 1) outBuf[baseR + f] = oR;
  }

  rmsEnv = rEnv;
  grEnv = g;
  arEnv = ar;
  lastGainReductionDb = maxGrDb;
}
