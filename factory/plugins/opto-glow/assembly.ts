// =====================================================================
//  OPTO GLOW — gentle optical leveling amplifier
//  An original model of a classic photocell leveling compressor. A light
//  source driven by the program illuminates a resistive photocell whose
//  resistance lags the signal: slow, program-dependent attack and the
//  characteristic TWO-STAGE opto release (a quick initial recovery plus a
//  long, slow tail). A frequency-aware sidechain (gentle low-frequency
//  de-emphasis) keeps bass from pumping, and a soft knee makes the onset
//  smooth. Controls mirror the original: Peak Reduction, Gain (makeup),
//  and a Compress/Limit emphasis blend. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// --- opto cell state: two release time-constants summed (fast + slow tail) ---
let cellFast: f32 = 0.0;   // quick-recovery photocell component (linear gain-reduction units)
let cellSlow: f32 = 0.0;   // long memory tail component
let attackEnv: f32 = 0.0;  // smoothed sidechain drive into the cell

// --- sidechain detector state ---
const scHpL: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // low-freq de-emphasis (high-pass) state
const scRect: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // smoothed rectified level per channel (unused tail, kept stable)

const PI: f32 = 3.14159265358979;

const P_PEAK: i32 = 0;   // 0..1  Peak Reduction (compression amount)
const P_GAIN: i32 = 1;   // 0..1  Makeup gain   -> 0..+24 dB
const P_EMPH: i32 = 2;   // 0..1  Compress(0) .. Limit(1) emphasis
const P_MIX: i32 = 3;    // 0..1  dry/wet (parallel)

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  cellFast = 0.0; cellSlow = 0.0; attackEnv = 0.0;
  for (let c = 0; c < MAX_CHANNELS; c++) { scHpL[c] = 0.0; scRect[c] = 0.0; }
  params[P_PEAK] = 0.5;
  params[P_GAIN] = 0.35;
  params[P_EMPH] = 0.25;
  params[P_MIX]  = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// one-pole smoothing coefficient for a given time constant (seconds)
@inline function tcCoeff(seconds: f32, sr: f32): f32 {
  const t: f32 = seconds > 0.00001 ? seconds : f32(0.00001);
  return f32(1.0 - Mathf.exp(f32(-1.0) / (t * sr)));
}

export function process(n: i32): void {
  const peak: f32 = clampf(params[P_PEAK], 0.0, 1.0);
  const makeupDb: f32 = clampf(params[P_GAIN], 0.0, 1.0) * 24.0;
  const makeup: f32 = f32(Mathf.pow(10.0, makeupDb / 20.0));
  const emph: f32 = clampf(params[P_EMPH], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // --- threshold drops as Peak Reduction rises (more of the signal squeezed) ---
  // peak=0 -> ~ -6 dBFS (almost nothing), peak=1 -> ~ -34 dBFS (heavy leveling)
  const threshDb: f32 = f32(-6.0) - peak * 28.0;
  const thresh: f32 = f32(Mathf.pow(10.0, threshDb / 20.0));
  // soft-knee width in dB (wider knee -> smoother, more "optical")
  const kneeDb: f32 = 6.0;

  // --- compression ratio: Compress emphasis ~ gentle (≈3:1); Limit ~ firm (≈10:1) ---
  const ratio: f32 = f32(3.0) + emph * 7.0;
  const slope: f32 = f32(1.0) - f32(1.0) / ratio; // gain-reduction slope in dB/dB above knee

  // --- opto timing. Attack is slow + program dependent; Limit emphasis quickens it. ---
  const atkSec: f32 = f32(0.012) - emph * 0.008;           // ~12 ms .. ~4 ms
  const aAtk: f32 = tcCoeff(atkSec, sampleRate);
  // two-stage release: fast component recovers quickly, slow tail lingers
  const relFastSec: f32 = f32(0.08) + (1.0 - emph) * 0.04;  // ~80..120 ms
  const relSlowSec: f32 = f32(1.4) + (1.0 - emph) * 1.1;    // ~1.4..2.5 s long tail
  const rFast: f32 = tcCoeff(relFastSec, sampleRate);
  const rSlow: f32 = tcCoeff(relSlowSec, sampleRate);

  // sidechain low-frequency de-emphasis (high-pass ~90 Hz) so bass doesn't pump
  const cHp: f32 = f32(1.0 - Mathf.exp(f32(-2.0) * PI * 90.0 / sampleRate));

  // gentle output trim to keep broadband peaks under control
  const outTrim: f32 = 0.92;

  let cf: f32 = cellFast;
  let cs: f32 = cellSlow;
  let ae: f32 = attackEnv;

  for (let f = 0; f < n; f++) {
    // ---- build a mono-ish, frequency-aware sidechain detector ----
    let sc: f32 = 0.0;
    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      const x: f32 = inBuf[base + f];
      // de-emphasise lows in the detector only
      let lo: f32 = scHpL[c];
      lo = lo + cHp * (x - lo);
      scHpL[c] = lo;
      const hp: f32 = x - lo * 0.85; // partial low cut (keep some body)
      const a: f32 = hp < 0.0 ? -hp : hp;
      if (a > sc) sc = a;            // peak across channels
    }

    // smooth the detector a touch (removes sample-to-sample jitter)
    const detTc: f32 = tcCoeff(0.002, sampleRate);
    ae = ae + detTc * (sc - ae);
    const det: f32 = ae > 0.0000001 ? ae : f32(0.0000001);

    // ---- soft-knee static gain-reduction TARGET (in dB, positive = reduction) ----
    const detDb: f32 = f32(20.0) * f32(Mathf.log10(det));
    const over: f32 = detDb - threshDb; // dB above threshold
    let grDb: f32 = 0.0;
    if (over <= -kneeDb * 0.5) {
      grDb = 0.0;
    } else if (over >= kneeDb * 0.5) {
      grDb = slope * over;
    } else {
      // quadratic soft knee
      const t: f32 = over + kneeDb * 0.5; // 0..kneeDb
      grDb = slope * (t * t) / (2.0 * kneeDb);
    }
    // linear target reduction (>=1 means "no reduction" multiplier of 1)
    const targetGain: f32 = f32(Mathf.pow(10.0, -grDb / 20.0)); // 0..1, 1 = no reduction

    // ---- opto cell: track target with slow attack, two-stage release ----
    // The cell stores REDUCTION amount = (1 - gain). More reduction => darker cell.
    const targetRed: f32 = f32(1.0) - targetGain; // 0..1
    // fast component
    if (targetRed > cf) cf = cf + aAtk * (targetRed - cf);
    else                cf = cf + rFast * (targetRed - cf);
    // slow tail follows the fast component but with a long memory
    if (cf > cs) cs = cs + aAtk * (cf - cs);
    else         cs = cs + rSlow * (cf - cs);

    // combined cell reduction: mostly fast, with the slow tail adding sustain
    let red: f32 = 0.65 * cf + 0.35 * cs;
    if (red < 0.0) red = 0.0;
    if (red > 0.97) red = 0.97; // never fully close the cell
    const gr: f32 = f32(1.0) - red; // final smooth gain multiplier (0.03..1)

    // ---- apply to both channels ----
    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      const x: f32 = inBuf[base + f];
      const comp: f32 = x * gr * makeup;
      const y: f32 = x * (1.0 - mix) + comp * mix;
      outBuf[base + f] = f32(y * outTrim);
    }
  }

  cellFast = cf;
  cellSlow = cs;
  attackEnv = ae;
}
