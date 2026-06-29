// =====================================================================
//  SQUELCH FILTER — acid envelope low-pass (transistor-ladder style)
//
//  A resonant 4-pole (24 dB/oct) low-pass whose cutoff is opened by an
//  ENVELOPE FOLLOWER tracking the input dynamics, summed with a manual
//  base Cutoff. High Resonance gives the signature "squelch"; near the
//  top it approaches self-oscillation but a saturated feedback path keeps
//  it stable. The envelope has a fast attack and a sweepable Decay so the
//  filter snaps open on transients and quacks shut — the classic acid
//  bassline voice, here as an INPUT EFFECT. Pure algorithm, no samples.
//
//  Controls: Cutoff, Resonance, Env Amount, Decay, Mix.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// Per-channel ladder state: four one-pole stage outputs + feedback memory.
const s0: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const s1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const s2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const s3: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const fbState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// Per-channel envelope-follower state (rectified, smoothed input level).
const envState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_CUTOFF: i32 = 0;  // 0..1 -> base cutoff ~60 Hz .. ~8 kHz (exponential)
const P_RESO:   i32 = 1;  // 0..1 -> feedback 0 .. ~4.3 (near self-osc at top)
const P_ENV:    i32 = 2;  // 0..1 -> how far the envelope sweeps the cutoff up
const P_DECAY:  i32 = 3;  // 0..1 -> envelope release time ~30 ms .. ~900 ms
const P_MIX:    i32 = 4;  // 0..1 dry/wet

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    s0[c] = 0.0; s1[c] = 0.0; s2[c] = 0.0; s3[c] = 0.0;
    fbState[c] = 0.0; envState[c] = 0.0;
  }
  params[P_CUTOFF] = 0.35;
  params[P_RESO]   = 0.7;
  params[P_ENV]    = 0.65;
  params[P_DECAY]  = 0.4;
  params[P_MIX]    = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// Cheap, stable tanh approximation (rational). Saturates to ±1, monotone.
@inline function tanhf(x: f32): f32 {
  const c: f32 = clampf(x, -3.5, 3.5);
  const x2: f32 = c * c;
  const num: f32 = c * (f32(27.0) + x2);
  const den: f32 = f32(27.0) + f32(9.0) * x2;
  return num / den;
}

export function process(n: i32): void {
  const cutN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resN: f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV],    0.0, 1.0);
  const decN: f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const mix:  f32 = clampf(params[P_MIX],    0.0, 1.0);

  // Envelope follower: fast attack (~3 ms), sweepable release (~30..900 ms).
  const atkMs: f32 = 3.0;
  const relMs: f32 = 30.0 + decN * 870.0;
  const atkCoef: f32 = f32(Mathf.exp(f32(-1.0) / (atkMs * f32(0.001) * sampleRate)));
  const relCoef: f32 = f32(Mathf.exp(f32(-1.0) / (relMs * f32(0.001) * sampleRate)));

  // Base cutoff: exponential ~60 Hz .. ~8 kHz.
  const baseFc: f32 = f32(60.0) * f32(Mathf.exp(cutN * f32(4.9)));
  // Envelope sweep span in octaves (how far above base the env pushes us).
  const envOct: f32 = envN * f32(5.5);

  // Resonance: feedback amount up to ~4.3 (self-oscillation a touch above 4).
  const res: f32 = resN * f32(4.3);
  // Make-up: high resonance thins the body; nudge level a touch.
  const makeup: f32 = f32(1.0) + resN * f32(0.35);

  const nyq: f32 = sampleRate * f32(0.45);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let z0: f32 = s0[c];
    let z1: f32 = s1[c];
    let z2: f32 = s2[c];
    let z3: f32 = s3[c];
    let fb: f32 = fbState[c];
    let env: f32 = envState[c];

    for (let f = 0; f < n; f++) {
      const dry: f32 = inBuf[base + f];

      // --- envelope follower on the input ---
      const rect: f32 = dry < f32(0.0) ? -dry : dry;
      const coef: f32 = rect > env ? atkCoef : relCoef;
      env = rect + coef * (env - rect);
      // Soft-saturate the detector so very hot input doesn't slam it open.
      const envShaped: f32 = tanhf(env * f32(2.2));

      // --- envelope-modulated cutoff (base * 2^(env * span)) ---
      let fc: f32 = baseFc * f32(Mathf.exp(envShaped * envOct * f32(0.6931472)));
      fc = clampf(fc, 20.0, nyq);

      // One-pole TPT coefficient for this sample's cutoff.
      const wc: f32 = f32(2.0) * PI * fc / sampleRate;
      const g: f32 = clampf(f32(Mathf.tan(clampf(wc * f32(0.5), 0.0, 1.45))), 0.0001, 10.0);
      const G: f32 = g / (f32(1.0) + g);

      // Saturated feedback path keeps self-oscillation bounded.
      const u: f32 = dry - res * tanhf(fb);

      // Four cascaded one-pole TPT low-pass stages (transistor ladder).
      const v0: f32 = (u  - z0) * G;
      const y0: f32 = v0 + z0;  z0 = y0 + v0;

      const v1: f32 = (y0 - z1) * G;
      const y1: f32 = v1 + z1;  z1 = y1 + v1;

      const v2: f32 = (y1 - z2) * G;
      const y2: f32 = v2 + z2;  z2 = y2 + v2;

      const v3: f32 = (y2 - z3) * G;
      const y3: f32 = v3 + z3;  z3 = y3 + v3;

      fb = y3;

      const wet: f32 = clampf(tanhf(y3 * makeup) * f32(0.95), -1.0, 1.0);
      outBuf[base + f] = f32(dry * (f32(1.0) - mix) + wet * mix);
    }

    s0[c] = z0; s1[c] = z1; s2[c] = z2; s3[c] = z3;
    fbState[c] = fb; envState[c] = env;
  }
}
