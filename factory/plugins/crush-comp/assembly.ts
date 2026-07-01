// =====================================================================
//  CRUSH COMP — an aggressive FET-style compressor with built-in
//  distortion. A fast, stereo-linked peak detector drives a dB-domain
//  gain computer with a soft knee and ratios stepping from a gentle 2:1
//  up to a slamming "NUKE" all-buttons-in extreme. Attack/Release shape
//  punch with a program-dependent release that lets go faster on busy
//  material. A DIST stage adds asymmetric 2nd/3rd-harmonic FET grit that
//  grows as the compressor works (more reduction -> more colour), then a
//  dry/wet Mix blends it back. Punchy, gritty, in-your-face.
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
let peakState: f32 = 0.0;  // smoothed peak detector level (linear)
let fastState: f32 = 0.0;  // very-fast follower, for program-dependent release
let grDb: f32 = 0.0;       // current gain reduction in dB (>= 0), smoothed
let dcL: f32 = 0.0;        // DC blocker state (asymmetric clip adds DC)
let dcR: f32 = 0.0;
let dcXL: f32 = 0.0;
let dcXR: f32 = 0.0;

const P_THRESH:  i32 = 0;  // 0..1 -> threshold  -40..0 dBFS  (low = more comp)
const P_RATIO:   i32 = 1;  // 0..5 discrete -> 2,4,6,10,20:1, NUKE
const P_ATTACK:  i32 = 2;  // 0..1 -> attack     0.05..30 ms
const P_RELEASE: i32 = 3;  // 0..1 -> release    30..800 ms (program-dependent)
const P_DIST:    i32 = 4;  // 0..1 -> harmonic drive amount
const P_MIX:     i32 = 5;  // 0..1 -> dry/wet

const KNEE_DB: f32 = 8.0;        // soft knee width (dB)
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

// asymmetric tanh-ish saturator: stronger on the positive swing for a
// dominant 2nd harmonic, with 3rd-harmonic odd grit underneath.
@inline function fetSat(x: f32, drive: f32): f32 {
  const d: f32 = 1.0 + drive * 9.0;            // 1..10
  const bias: f32 = drive * 0.18;              // asymmetry -> 2nd harmonic
  const a: f32 = (x + bias) * d;
  // fast tanh approx (rational), bounded to ~[-1,1]
  const a2: f32 = a * a;
  const t: f32 = a * (27.0 + a2) / (27.0 + 9.0 * a2);
  const tb2: f32 = bias * d;
  const tb: f32 = tb2 * (27.0 + tb2 * tb2) / (27.0 + 9.0 * tb2 * tb2);
  return f32((t - tb) / d);                    // remove bias DC, normalise gain
}

// ratio lookup for the stepped selector (last step = NUKE)
@inline function ratioForStep(step: i32): f32 {
  if (step <= 0) return 2.0;
  if (step == 1) return 4.0;
  if (step == 2) return 6.0;
  if (step == 3) return 10.0;
  if (step == 4) return 20.0;
  return 60.0;                                  // NUKE — brutal limiting
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  peakState = 0.0;
  fastState = 0.0;
  grDb = 0.0;
  dcL = 0.0; dcR = 0.0; dcXL = 0.0; dcXR = 0.0;
  params[P_THRESH]  = 0.30; // ~ -28 dBFS — bites on the test bed
  params[P_RATIO]   = 3.0;  // 10:1
  params[P_ATTACK]  = 0.15; // fast
  params[P_RELEASE] = 0.30; // medium
  params[P_DIST]    = 0.35; // some grit
  params[P_MIX]     = 1.0;  // fully wet
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function process(n: i32): void {
  // ---- map params to engineering units ----
  const tN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const threshDb: f32 = -40.0 + tN * 40.0;               // -40..0 dBFS

  let step: i32 = i32(params[P_RATIO] + 0.5);
  if (step < 0) step = 0;
  if (step > 5) step = 5;
  const ratio: f32 = ratioForStep(step);
  const slope: f32 = 1.0 - 1.0 / ratio;                  // 0.5..~0.98

  const aN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const atkMs: f32 = 0.05 + aN * aN * 29.95;             // 0.05..30 ms (curved)
  const relN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const relMs: f32 = 30.0 + relN * relN * 770.0;         // 30..800 ms (curved)

  // one-pole time-constant coefficients (per-sample) for the dB envelope
  const atkCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (atkMs * 0.001 * sampleRate)));
  const relCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (relMs * 0.001 * sampleRate)));

  // peak detector smoothing (fast attack, short hold via release)
  const detCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.001 * sampleRate)));     // ~1 ms
  const fastCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.0001 * sampleRate)));   // ~0.1 ms

  const distN: f32 = clampf(params[P_DIST], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // makeup compensates for the average reduction so NUKE/low-thresh stays usable
  const makeup: f32 = db2lin(slope * 6.0 + distN * 3.0);

  // DC blocker coefficient (~20 Hz)
  const dcCoef: f32 = f32(1.0 - 2.0 * 3.14159265 * 20.0 / sampleRate);

  const halfKnee: f32 = KNEE_DB * 0.5;

  let pk: f32 = peakState;
  let fast: f32 = fastState;
  let gr: f32 = grDb;

  const baseL: i32 = 0;
  const baseR: i32 = MAX_FRAMES;
  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    const xL: f32 = inBuf[baseL + f];
    const xR: f32 = stereo ? inBuf[baseR + f] : xL;

    // ---- stereo-linked peak detector ----
    const aL: f32 = xL < 0.0 ? -xL : xL;
    const aR: f32 = xR < 0.0 ? -xR : xR;
    const inLevel: f32 = aL > aR ? aL : aR;

    // smoothed peak (release-ish) and an ultra-fast follower
    pk = pk + (inLevel > pk ? 1.0 : detCoef) * (inLevel - pk);
    fast = fast + (inLevel > fast ? 1.0 : fastCoef) * (inLevel - fast);

    // program dependence: when the fast follower sits well above the slow
    // peak (busy/transient material) speed the release up.
    const busy: f32 = fast > pk ? (fast - pk) : 0.0;
    const progRel: f32 = relCoef + busy * relCoef * 6.0;

    const detDb: f32 = lin2db(pk);

    // ---- gain computer: soft-knee static curve -> target GR (dB) ----
    const over: f32 = detDb - threshDb;
    let targetGr: f32;
    if (over <= -halfKnee) {
      targetGr = 0.0;
    } else if (over >= halfKnee) {
      targetGr = slope * over;
    } else {
      const kt: f32 = over + halfKnee;          // 0..KNEE_DB
      targetGr = slope * (kt * kt) / (2.0 * KNEE_DB);
    }
    if (targetGr < 0.0) targetGr = 0.0;

    // ---- ballistics: attack down, program-dependent release up ----
    const coef: f32 = targetGr > gr ? atkCoef : progRel;
    gr = gr + coef * (targetGr - gr);
    if (gr < 0.0) gr = 0.0;

    const g: f32 = db2lin(-gr);

    // FET grit scales with both the DIST control and how hard we're working
    const driveAmt: f32 = clampf(distN * (0.35 + gr * 0.06), 0.0, 1.0);

    // ---- left ----
    let yL: f32 = xL * g;
    yL = fetSat(yL, driveAmt);
    // DC block
    const dL: f32 = yL - dcXL + dcCoef * dcL;
    dcXL = yL; dcL = dL;
    yL = dL * makeup;
    let wetL: f32 = clampf(yL, -1.2, 1.2);
    outBuf[baseL + f] = xL * (1.0 - mix) + wetL * mix;

    // ---- right ----
    if (stereo) {
      let yR: f32 = xR * g;
      yR = fetSat(yR, driveAmt);
      const dR: f32 = yR - dcXR + dcCoef * dcR;
      dcXR = yR; dcR = dR;
      yR = dR * makeup;
      let wetR: f32 = clampf(yR, -1.2, 1.2);
      outBuf[baseR + f] = xR * (1.0 - mix) + wetR * mix;
    }
  }

  peakState = pk;
  fastState = fast;
  grDb = gr;
}
