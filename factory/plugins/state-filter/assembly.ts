// =====================================================================
//  STATE FILTER — a 2-pole multimode state-variable filter
//  A classic two-integrator state-variable topology produces low-pass,
//  high-pass, band-pass and notch outputs simultaneously from a single
//  recursion; a Mode selector taps which one is heard. Resonance can be
//  pushed all the way to self-oscillation while a soft saturator inside
//  the resonance path keeps the peak bounded. A gentle input Drive adds
//  harmonic warmth before the filter. Pure algorithm, no samples.
//
//  The integrator coefficient f = 2*sin(pi*fc/fs) is the textbook form;
//  it is only stable up to fc ≈ fs/6, so the whole filter runs at 2x
//  oversampling (with a tiny half-band smoother) to keep high cutoffs
//  clean and the response well-behaved across the full sweep.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel SVF integrator state (the two "state variables")
const svLow:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // low-pass integrator
const svBand: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // band-pass integrator
// per-channel upsample hold + post-decimation smoother
const upZ:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // last input (linear up)
const downZ:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // half-band smoother

const P_CUTOFF: i32 = 0; // 0..1 -> ~30 Hz .. ~18 kHz (exp)
const P_RES:    i32 = 1; // 0..1 -> resonance, climbs to self-oscillation
const P_MODE:   i32 = 2; // 0..3 step 1 -> 0 LP, 1 HP, 2 BP, 3 Notch
const P_DRIVE:  i32 = 3; // 0..1 -> pre-filter drive / warmth
const P_MIX:    i32 = 4; // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    svLow[c] = 0.0; svBand[c] = 0.0; upZ[c] = 0.0; downZ[c] = 0.0;
  }
  params[P_CUTOFF] = 0.5;
  params[P_RES]    = 0.35;
  params[P_MODE]   = 0.0;
  params[P_DRIVE]  = 0.2;
  params[P_MIX]    = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// smooth bounded saturator: tanh-like, keeps the resonance loop stable
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resN:    f32 = clampf(params[P_RES], 0.0, 1.0);
  const mode:    i32 = i32(clampf(params[P_MODE], 0.0, 3.0) + 0.5);
  const driveN:  f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const mix:     f32 = clampf(params[P_MIX], 0.0, 1.0);

  // running at 2x oversampling, so design against twice the rate
  const fsOver: f32 = sampleRate * 2.0;

  // exponential cutoff map ~30 Hz .. ~18 kHz
  let fcHz: f32 = f32(30.0 * Mathf.exp(cutoffN * 6.396929655)); // 30 * (600)^cutoff
  const fcMax: f32 = fsOver * 0.18; // stay within stable region of this SVF form
  if (fcHz > fcMax) fcHz = fcMax;
  if (fcHz < 10.0) fcHz = 10.0;

  // SVF tuning coefficient f = 2*sin(pi*fc/fs)
  const fCoef: f32 = f32(2.0 * Mathf.sin(3.14159265358979 * fcHz / fsOver));

  // damping q = 1/Q. At resN=1 -> near 0 -> self-oscillation, but floored so
  // the loop never goes fully undamped (kept stable & bounded by the saturator).
  const q: f32 = f32(1.0 - resN * 0.97) + 0.02; // 1.0 .. ~0.05

  // input drive: 1x .. ~6x, with output compensation so it stays musical
  const drive: f32 = 1.0 + driveN * 5.0;
  const comp: f32 = f32(1.0 / (1.0 + driveN * 1.5));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let low: f32 = svLow[c];
    let band: f32 = svBand[c];
    let prevIn: f32 = upZ[c];
    let dz: f32 = downZ[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];
      const driven: f32 = satf(x * drive) * comp;

      // 2x oversampled SVF: two sub-steps, input linearly interpolated
      let outOver: f32 = 0.0;
      for (let k: i32 = 0; k < 2; k++) {
        // linear upsample between previous and current driven sample
        const frac: f32 = k == 0 ? 0.5 : 1.0;
        const xin: f32 = prevIn + (driven - prevIn) * frac;

        // Chamberlin two-integrator core
        const high: f32 = xin - low - q * band;
        band = band + fCoef * high;
        band = satf(band); // bound the resonance state -> stable self-osc
        low = low + fCoef * band;

        let tap: f32 = low;
        if (mode == 1) tap = high;            // high-pass
        else if (mode == 2) tap = band;       // band-pass
        else if (mode == 3) tap = xin - band * q; // notch = in - bp*damp ≈ low+high

        outOver = tap;
      }
      prevIn = driven;

      // half-band-ish decimation smoother (simple 1-pole on the 2x stream)
      dz = dz + 0.5 * (outOver - dz);
      const wet: f32 = dz;

      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }

    svLow[c] = low;
    svBand[c] = band;
    upZ[c] = prevIn;
    downZ[c] = dz;
  }
}
