// =====================================================================
//  MASTER GLUE — classic British console-style "glue" bus compressor (effect)
//
//  The classic British mix-bus glue: a feed-forward, stereo-LINKED VCA
//  compressor with STEPPED ratios (2:1 / 4:1 / 10:1), STEPPED attack
//  times, and a program-dependent AUTO-RELEASE that "breathes" with the
//  music. A loud, dense mix is smoothly leveled and gelled into a single
//  cohesive whole; the stereo image stays put because one detector drives
//  both channels. Makeup restores level, Mix blends parallel dry, and a
//  soft output stage keeps the bus bounded. Pure algorithm, no samples.
//
//  - Detector: peak-ish smoothed level of the SUM of both channels, so the
//    image is rock-solid (no L/R drift).
//  - Gain computer in the dB domain with a soft knee and stepped ratio.
//  - Attack: 4 stepped positions (0.1 / 0.3 / 1 / 3 / 10 ms feel — mapped
//    to one-pole coefficients).
//  - Release: 4 fixed positions (0.1 / 0.3 / 0.6 / 1.2 s) PLUS an AUTO
//    position (max) where two release time-constants are blended by the
//    amount of gain reduction — the program-dependent "breathing" release.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// detector / envelope state (mono, stereo-linked)
let det: f32 = 0.0;      // smoothed detector level (linear)
let envDb: f32 = 0.0;    // current gain reduction in dB (>= 0)
let rel2: f32 = 0.0;     // slow release reservoir for AUTO breathing

const P_THRESH: i32 = 0; // 0..1 -> threshold dBFS  (-30..0)
const P_RATIO:  i32 = 1; // 0/1/2 -> 2:1 / 4:1 / 10:1   (stepped)
const P_ATTACK: i32 = 2; // 0..3 -> stepped attack times (stepped)
const P_RELEASE:i32 = 3; // 0..4 -> 0.1/0.3/0.6/1.2s + AUTO (stepped)
const P_MAKEUP: i32 = 4; // 0..1 -> 0..+18 dB
const P_MIX:    i32 = 5; // 0..1 dry/wet

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  det = 0.0;
  envDb = 0.0;
  rel2 = 0.0;
  params[P_THRESH]  = 0.5;
  params[P_RATIO]   = 1.0;  // 4:1
  params[P_ATTACK]  = 1.0;  // medium attack
  params[P_RELEASE] = 4.0;  // AUTO
  params[P_MAKEUP]  = 0.3;
  params[P_MIX]     = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

// one-pole coefficient for a given time constant in seconds
@inline function tcCoef(seconds: f32, sr: f32): f32 {
  if (seconds <= 0.0) return 1.0;
  return f32(1.0 - Mathf.exp(-1.0 / (seconds * sr)));
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- threshold ----
  const thN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const threshDb: f32 = -30.0 + thN * 30.0;          // -30..0 dBFS

  // ---- ratio (stepped: 2 / 4 / 10) ----
  const ratioSel: i32 = i32(clampf(params[P_RATIO], 0.0, 2.0) + 0.5);
  let ratio: f32 = 4.0;
  if (ratioSel == 0) ratio = 2.0;
  else if (ratioSel == 2) ratio = 10.0;
  const slope: f32 = 1.0 - 1.0 / ratio;               // dB out per dB over

  // ---- attack (stepped: 0.1 / 0.3 / 1 / 3 ms feel) ----
  const atkSel: i32 = i32(clampf(params[P_ATTACK], 0.0, 3.0) + 0.5);
  let atkMs: f32 = 1.0;
  if (atkSel == 0) atkMs = 0.1;
  else if (atkSel == 1) atkMs = 0.3;
  else if (atkSel == 2) atkMs = 3.0;
  else atkMs = 10.0;
  const atkCoef: f32 = tcCoef(atkMs * 0.001, sr);

  // ---- release (stepped: 0.1 / 0.3 / 0.6 / 1.2 s + AUTO) ----
  const relSel: i32 = i32(clampf(params[P_RELEASE], 0.0, 4.0) + 0.5);
  const isAuto: bool = (relSel == 4);
  let relMs: f32 = 600.0;
  if (relSel == 0) relMs = 100.0;
  else if (relSel == 1) relMs = 300.0;
  else if (relSel == 2) relMs = 600.0;
  else if (relSel == 3) relMs = 1200.0;
  // AUTO: blend a fast (~150 ms) and slow (~2 s) release by GR depth
  const relFastCoef: f32 = tcCoef(0.15, sr);
  const relSlowCoef: f32 = tcCoef(2.0, sr);
  const relFixedCoef: f32 = tcCoef(relMs * 0.001, sr);

  // detector smoothing (fast, peak-ish)
  const detCoef: f32 = tcCoef(0.003, sr);

  // ---- makeup & mix ----
  const makeupDb: f32 = clampf(params[P_MAKEUP], 0.0, 1.0) * 18.0;
  const makeup: f32 = f32(Mathf.exp(makeupDb * 0.11512925)); // 10^(dB/20)
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  const ln10over20: f32 = 0.11512925; // ln(10)/20
  const c20overln10: f32 = 8.6858896; // 20/ln(10)
  const knee: f32 = 6.0; // dB soft knee (half-width handled below)

  let d: f32 = det;
  let gDb: f32 = envDb;
  let r2: f32 = rel2;

  for (let f = 0; f < n; f++) {
    // stereo-linked detector: peak of |L|+|R| average
    const l: f32 = inBuf[f];
    const r: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : l;
    let mono: f32 = (l + r) * 0.5;
    if (mono < 0.0) mono = -mono;

    // smooth detector toward the input magnitude (attack-fast, gentle decay)
    if (mono > d) d = d + detCoef * (mono - d);
    else d = d + detCoef * 0.25 * (mono - d);

    // level in dB
    const lvlDb: f32 = c20overln10 * f32(Mathf.log(d + 1e-9));
    const over: f32 = lvlDb - threshDb;

    // soft-knee gain computer -> target reduction (dB, >= 0)
    let targetGr: f32 = 0.0;
    if (over <= -knee * 0.5) {
      targetGr = 0.0;
    } else if (over >= knee * 0.5) {
      targetGr = slope * over;
    } else {
      const x: f32 = over + knee * 0.5; // 0..knee
      targetGr = slope * (x * x) / (2.0 * knee);
    }

    // envelope: fast attack toward more reduction, program release back
    if (targetGr > gDb) {
      gDb = gDb + atkCoef * (targetGr - gDb);
    } else {
      if (isAuto) {
        // dual time-constant breathing release:
        // r2 is a slow reservoir that lags gDb; blend fast/slow by depth.
        r2 = r2 + relSlowCoef * (gDb - r2);
        const depth: f32 = clampf(gDb * 0.15, 0.0, 1.0); // deeper GR -> slower
        const relCoef: f32 = relFastCoef + (relSlowCoef - relFastCoef) * depth;
        // breathe: release toward a level pulled up by the slow reservoir
        const floorGr: f32 = targetGr < r2 ? r2 * 0.0 : targetGr;
        gDb = gDb + relCoef * (floorGr - gDb);
      } else {
        gDb = gDb + relFixedCoef * (targetGr - gDb);
      }
    }
    if (gDb < 0.0) gDb = 0.0;

    // linear gain from reduction dB
    const gain: f32 = f32(Mathf.exp(-gDb * ln10over20)) * makeup;

    const wetL: f32 = l * gain;
    const wetR: f32 = r * gain;

    // soft output clamp keeps the bus bounded (~±1)
    const outL: f32 = l * (1.0 - mix) + wetL * mix;
    const outR: f32 = r * (1.0 - mix) + wetR * mix;

    outBuf[f] = f32(Mathf.tanh(outL * 0.92)) * 1.02;
    if (channels > 1) outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(outR * 0.92)) * 1.02;
  }

  det = d;
  envDb = gDb;
  rel2 = r2;
}
