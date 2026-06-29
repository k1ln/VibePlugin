// =====================================================================
//  DIODE COMP — a diode-bridge style bus compressor
//  Models the smooth, slightly coloured compression of a classic British
//  diode-bridge dynamics unit. A stereo-linked peak/RMS detector feeds a
//  dB-domain gain computer with a soft (over-easy) knee; Attack/Release
//  shape the gain-reduction envelope. The signal passes through a gentle
//  diode-bridge transfer (an asymmetric soft-clip) that adds a touch of
//  even-harmonic warmth — louder inputs are squeezed and coloured more
//  than quiet ones for a classy, glued character. Output is bounded.
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
let dcL: f32 = 0.0;        // DC blockers after the asymmetric bridge stage
let dcR: f32 = 0.0;
let xpL: f32 = 0.0;        // DC blocker input memory
let xpR: f32 = 0.0;

const P_THRESH:  i32 = 0;  // 0..1 -> threshold  -42..0 dBFS  (low = more comp)
const P_RATIO:   i32 = 1;  // 0..1 -> ratio      1.5..12:1
const P_ATTACK:  i32 = 2;  // 0..1 -> attack     0.3..120 ms
const P_RELEASE: i32 = 3;  // 0..1 -> release    50..1500 ms
const P_MAKEUP:  i32 = 4;  // 0..1 -> makeup     0..+24 dB

const KNEE_DB: f32 = 8.0;        // wide, smooth over-easy knee (classy)
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

// Diode-bridge transfer: a gentle asymmetric soft-clip. The two diode legs
// of the bridge conduct slightly differently, biasing the curve so even
// harmonics appear — that is the bridge "warmth". Bounded to ~±1.
@inline function bridge(x: f32, amt: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  // tanh-like soft clip via a rational approximation (cheap, smooth)
  const s: f32 = c / f32(1.0 + 0.28 * c * c);
  // asymmetric second-order term -> even harmonics; scaled by amt (drive)
  const even: f32 = 0.12 * amt * (s * s - 0.18 * s);
  return f32(s + even);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  rmsState = 0.0;
  grDb = 0.0;
  dcL = 0.0; dcR = 0.0; xpL = 0.0; xpR = 0.0;
  params[P_THRESH]  = 0.32; // ~ -28.5 dBFS — bites on the test bed
  params[P_RATIO]   = 0.40; // ~ 5.7:1
  params[P_ATTACK]  = 0.30; // medium-fast
  params[P_RELEASE] = 0.35; // medium
  params[P_MAKEUP]  = 0.28; // ~ +6.7 dB makeup
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  // ---- map params to engineering units ----
  const tN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const threshDb: f32 = -42.0 + tN * 42.0;               // -42..0 dBFS

  const rN: f32 = clampf(params[P_RATIO], 0.0, 1.0);
  const ratio: f32 = 1.5 + rN * 10.5;                    // 1.5..12 : 1
  const slope: f32 = 1.0 - 1.0 / ratio;                  // ~0.33..0.92

  const aN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const atkMs: f32 = 0.3 + aN * aN * 119.7;              // 0.3..120 ms (curved)
  const relN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const relMs: f32 = 50.0 + relN * relN * 1450.0;        // 50..1500 ms (curved)

  // one-pole time-constant coefficients (per-sample) for the dB envelope
  const atkCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (atkMs * 0.001 * sampleRate)));
  const relCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (relMs * 0.001 * sampleRate)));

  // RMS detector window ~ 8 ms (smooth, programme-dependent feel)
  const rmsCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.008 * sampleRate)));

  const makeupDb: f32 = clampf(params[P_MAKEUP], 0.0, 1.0) * 24.0; // 0..+24 dB
  const makeup: f32 = db2lin(makeupDb);

  // DC blocker coefficient (~5 Hz) for the asymmetric bridge stage
  const dcCoef: f32 = f32(1.0 - 2.0 * 3.14159265 * 5.0 / sampleRate);

  const halfKnee: f32 = KNEE_DB * 0.5;

  let rms: f32 = rmsState;
  let gr: f32 = grDb;
  let bL: f32 = dcL, bR: f32 = dcR;
  let pL: f32 = xpL, pR: f32 = xpR;

  const baseL: i32 = 0;
  const baseR: i32 = MAX_FRAMES;
  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    const xL: f32 = inBuf[baseL + f];
    const xR: f32 = stereo ? inBuf[baseR + f] : xL;

    // ---- detector: stereo-linked peak with RMS floor (smooth + responsive) ----
    const peakL: f32 = (xL < 0.0 ? -xL : xL);
    const peakR: f32 = (xR < 0.0 ? -xR : xR);
    const pk: f32 = peakL > peakR ? peakL : peakR;

    const sq: f32 = (xL * xL + xR * xR) * 0.5;
    rms = rms + rmsCoef * (sq - rms);            // running mean square
    const rmsAmp: f32 = f32(Mathf.sqrt(rms));

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
      const t: f32 = over + halfKnee;            // 0..KNEE_DB
      targetGr = slope * (t * t) / (2.0 * KNEE_DB);
    }
    if (targetGr < 0.0) targetGr = 0.0;

    // ---- ballistics: attack when clamping down, release when letting go ----
    const coef: f32 = targetGr > gr ? atkCoef : relCoef;
    gr = gr + coef * (targetGr - gr);

    // ---- apply gain reduction + makeup ----
    const g: f32 = db2lin(-gr);
    // bridge "drive" tracks gain reduction: harder squeeze => warmer colour
    const drive: f32 = clampf(gr * 0.12, 0.0, 1.0);

    let yL: f32 = bridge(xL * g, drive) * makeup;
    let yR: f32 = stereo ? bridge(xR * g, drive) * makeup : yL;

    // DC-block the asymmetric bridge output so the even-harmonic bias
    // doesn't pump a DC offset into the bus
    const oL: f32 = yL - pL + dcCoef * bL;
    pL = yL; bL = oL;
    let outL: f32 = oL;
    let outR: f32 = yR;
    if (stereo) {
      const oR: f32 = yR - pR + dcCoef * bR;
      pR = yR; bR = oR;
      outR = oR;
    }

    // final safety clamp (bounded output)
    outBuf[baseL + f] = clampf(outL, -1.5, 1.5);
    if (stereo) outBuf[baseR + f] = clampf(outR, -1.5, 1.5);
  }

  rmsState = rms;
  grDb = gr;
  dcL = bL; dcR = bR; xpL = pL; xpR = pR;
}
