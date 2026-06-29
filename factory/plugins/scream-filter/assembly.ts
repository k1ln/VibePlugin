// =====================================================================
//  SCREAM FILTER — aggressive Sallen-Key resonant filter (effect)
//  A high-pass and a low-pass in series, each a 2-pole Sallen-Key cell
//  with feedback resonance that can self-oscillate and scream. Signal is
//  driven into the resonance feedback with a tanh nonlinearity for the
//  characteristic aggressive, distorted tone. Self-oscillation is kept
//  bounded by the saturator so the output never blows up (no NaN) even
//  at maximum resonance + drive. Pure algorithm, no samples.
//
//  Each Sallen-Key cell is a state-variable-style 2-pole built from two
//  cascaded one-pole TPT integrators with a resonance feedback path. The
//  feedback is saturated (tanh) which both shapes the scream and caps the
//  self-oscillation amplitude.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel integrator states for the two cascaded 2-pole cells
// HP cell uses hp1/hp2 ; LP cell uses lp1/lp2 (TPT one-pole z states)
const hp1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hp2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lp1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lp2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_LP:    i32 = 0; // 0..1 -> LP cutoff
const P_HP:    i32 = 1; // 0..1 -> HP cutoff
const P_RES:   i32 = 2; // 0..1 -> resonance / self-oscillation
const P_DRIVE: i32 = 3; // 0..1 -> drive into resonance
const P_MIX:   i32 = 4; // 0..1 dry/wet

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    hp1[c] = 0.0; hp2[c] = 0.0; lp1[c] = 0.0; lp2[c] = 0.0;
  }
  params[P_LP] = 0.85;
  params[P_HP] = 0.12;
  params[P_RES] = 0.55;
  params[P_DRIVE] = 0.35;
  params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// fast bounded tanh-ish saturator: caps self-oscillation, adds the scream
@inline function sat(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(Mathf.tanh(c));
}

// map 0..1 to a cutoff in Hz with a musical exponential curve
@inline function curveHz(n: f32, lo: f32, hi: f32): f32 {
  const t: f32 = clampf(n, 0.0, 1.0);
  return f32(lo * Mathf.exp(t * Mathf.log(hi / lo)));
}

export function process(n: i32): void {
  const lpHz: f32 = curveHz(clampf(params[P_LP], 0.0, 1.0), 80.0, 18000.0);
  const hpHz: f32 = curveHz(clampf(params[P_HP], 0.0, 1.0), 20.0, 6000.0);
  const resN: f32 = clampf(params[P_RES], 0.0, 1.0);
  const driveN: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // TPT one-pole coefficients g = tan(pi*fc/fs) / (1+...)
  const nyq: f32 = sampleRate * 0.5;
  const lpClamped: f32 = lpHz < nyq * 0.99 ? lpHz : nyq * 0.99;
  const hpClamped: f32 = hpHz < nyq * 0.99 ? hpHz : nyq * 0.99;
  const gLp: f32 = f32(Mathf.tan(PI * lpClamped / sampleRate));
  const gHp: f32 = f32(Mathf.tan(PI * hpClamped / sampleRate));
  const aLp: f32 = gLp / (1.0 + gLp);
  const aHp: f32 = gHp / (1.0 + gHp);

  // resonance feedback amount: 0 -> mild, ~1 -> self-oscillation.
  // k up to ~4 pushes each cell into ringing; saturator keeps it stable.
  const k: f32 = resN * 4.0;
  // drive: pre-gain into the resonance saturator (1..16)
  const drive: f32 = 1.0 + driveN * 15.0;
  // output trim so heavy drive/res doesn't run away (peak < ~1)
  const trim: f32 = 0.85 / (1.0 + driveN * 1.2 + resN * 0.6);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let h1: f32 = hp1[c];
    let h2: f32 = hp2[c];
    let l1: f32 = lp1[c];
    let l2: f32 = lp2[c];

    for (let f = 0; f < n; f++) {
      const dry: f32 = inBuf[base + f];

      // ---- HIGH-PASS Sallen-Key cell ----
      // resonance feedback from the cell's bandpass-ish state, saturated
      const hpBand: f32 = h1 - h2;
      const hfb: f32 = sat((dry + k * hpBand) * drive);
      // 1st integrator (LP)
      const hv1: f32 = (hfb - h1) * aHp;
      const hlow1: f32 = hv1 + h1;
      h1 = hlow1 + hv1;
      // 2nd integrator (LP)
      const hv2: f32 = (hlow1 - h2) * aHp;
      const hlow2: f32 = hv2 + h2;
      h2 = hlow2 + hv2;
      // high-pass output = input minus 2-pole low-passed
      const hpOut: f32 = hfb - hlow2;

      // ---- LOW-PASS Sallen-Key cell ----
      const lpBand: f32 = l1 - l2;
      const lfb: f32 = sat((hpOut + k * lpBand) * drive);
      const lv1: f32 = (lfb - l1) * aLp;
      const llow1: f32 = lv1 + l1;
      l1 = llow1 + lv1;
      const lv2: f32 = (llow1 - l2) * aLp;
      const llow2: f32 = lv2 + l2;
      l2 = llow2 + lv2;
      const lpOut: f32 = llow2;

      // safety: replace any non-finite with 0 to guarantee no NaN escapes
      let wet: f32 = lpOut * trim;
      if (!isFinite(wet)) { wet = 0.0; h1 = 0.0; h2 = 0.0; l1 = 0.0; l2 = 0.0; }

      outBuf[base + f] = dry * (1.0 - mix) + wet * mix;
    }

    hp1[c] = h1; hp2[c] = h2; lp1[c] = l1; lp2[c] = l2;
  }
}
