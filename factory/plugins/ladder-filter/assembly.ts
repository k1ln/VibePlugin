// =====================================================================
//  LADDER FILTER — 4-pole (24 dB/oct) resonant transistor-ladder low-pass
//  A cascade of four one-pole sections with a global resonance feedback
//  path that can reach self-oscillation. A gentle tanh-style saturation
//  in the feedback loop tames the resonance and gives the warm growl that
//  the classic transistor ladder is known for. Pure algorithm, no samples.
//
//  Controls: Cutoff, Resonance (musical up to self-oscillation), Drive, Mix.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// Per-channel ladder state: the four one-pole stage outputs, plus the
// previous overall output (for the half-sample feedback delay smoothing).
const s0: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const s1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const s2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const s3: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const fbState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_CUTOFF: i32 = 0;  // 0..1 -> ~30 Hz .. ~18 kHz (exponential)
const P_RESO:   i32 = 1;  // 0..1 -> feedback 0 .. ~4.2 (self-oscillation near 1)
const P_DRIVE:  i32 = 2;  // 0..1 -> input drive 1 .. ~8
const P_MIX:    i32 = 3;  // 0..1 dry/wet

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    s0[c] = 0.0; s1[c] = 0.0; s2[c] = 0.0; s3[c] = 0.0; fbState[c] = 0.0;
  }
  params[P_CUTOFF] = 0.6;
  params[P_RESO]   = 0.3;
  params[P_DRIVE]  = 0.25;
  params[P_MIX]    = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

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
  const cutN:  f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resN:  f32 = clampf(params[P_RESO],   0.0, 1.0);
  const drvN:  f32 = clampf(params[P_DRIVE],  0.0, 1.0);
  const mix:   f32 = clampf(params[P_MIX],    0.0, 1.0);

  // Exponential cutoff map: ~30 Hz .. ~18 kHz.
  const fc: f32 = f32(30.0) * f32(Mathf.exp(cutN * f32(6.4)));   // 30 .. ~18k
  let fcCl: f32 = clampf(fc, 20.0, sampleRate * f32(0.45));

  // One-pole coefficient via the standard ladder tuning. g is the per-stage
  // gain; the cascade of 4 of these gives the 24 dB/oct slope.
  const wc: f32 = f32(2.0) * PI * fcCl / sampleRate;
  // Bilinear-ish frequency warp so the cutoff tracks well up high.
  const g: f32 = clampf(f32(Mathf.tan(clampf(wc * f32(0.5), 0.0, 1.45))), 0.0001, 10.0);
  const G: f32 = g / (f32(1.0) + g);   // one-pole TPT coefficient (0..1)

  // Resonance: feedback amount up to ~4.2 (self-oscillation a touch above 4).
  const res: f32 = resN * f32(4.2);

  // Input drive 1..8; compensate level a bit so high drive doesn't blow up.
  const drive: f32 = f32(1.0) + drvN * f32(7.0);
  const driveComp: f32 = f32(1.0) / f32(Mathf.sqrt(drive));

  // Mild make-up: resonance steals low-end energy; nudge level a touch.
  const makeup: f32 = f32(1.0) + resN * f32(0.4);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let z0: f32 = s0[c];
    let z1: f32 = s1[c];
    let z2: f32 = s2[c];
    let z3: f32 = s3[c];
    let fb: f32 = fbState[c];

    for (let f = 0; f < n; f++) {
      const dry: f32 = inBuf[base + f];

      // Drive the input and saturate it going in (transistor input pair).
      const xin: f32 = tanhf(dry * drive) * driveComp;

      // Feedback: subtract the resonance-scaled, saturated previous output.
      // Saturating the feedback is what keeps self-oscillation bounded.
      const u: f32 = xin - res * tanhf(fb);

      // Four cascaded one-pole TPT low-pass stages (transistor ladder).
      const v0: f32 = (u  - z0) * G;
      const y0: f32 = v0 + z0;  z0 = y0 + v0;

      const v1: f32 = (y0 - z1) * G;
      const y1: f32 = v1 + z1;  z1 = y1 + v1;

      const v2: f32 = (y1 - z2) * G;
      const y2: f32 = v2 + z2;  z2 = y2 + v2;

      const v3: f32 = (y2 - z3) * G;
      const y3: f32 = v3 + z3;  z3 = y3 + v3;

      // y3 is the 4-pole low-pass output; feed it back next sample.
      fb = y3;

      const wet: f32 = clampf(y3 * makeup, -1.5, 1.5);
      outBuf[base + f] = f32(dry * (f32(1.0) - mix) + wet * mix);
    }

    s0[c] = z0; s1[c] = z1; s2[c] = z2; s3[c] = z3; fbState[c] = fb;
  }
}
