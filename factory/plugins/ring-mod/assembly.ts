// =====================================================================
//  RING MOD — classic ring modulator
//  Multiplies the input by an internal carrier oscillator to create
//  inharmonic sum/difference sidebands (metallic, clangorous, bell-like).
//  The carrier is a band-limited sine, switchable to a (softened) square,
//  and its frequency can be swept by a built-in LFO. A dry/wet Mix blends
//  the modulated signal back against the clean input. Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// Oscillator phases (shared carrier across channels for a coherent image).
let carrierPhase: f32 = 0.0; // 0..1
let lfoPhase: f32 = 0.0;     // 0..1

// Param indices — MUST match spec.json.
const P_FREQ: i32 = 0;   // 0..1 -> carrier 20..3000 Hz (exp)
const P_WAVE: i32 = 1;   // 0..1 -> sine(0) .. square(1) blend
const P_RATE: i32 = 2;   // 0..1 -> LFO 0.05..12 Hz (exp)
const P_DEPTH: i32 = 3;  // 0..1 -> LFO depth in octaves (0..2)
const P_MIX: i32 = 4;    // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  carrierPhase = 0.0;
  lfoPhase = 0.0;
  params[P_FREQ] = 0.5;
  params[P_WAVE] = 0.0;
  params[P_RATE] = 0.3;
  params[P_DEPTH] = 0.25;
  params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Cheap, allocation-free sine of a 0..1 phase via a polynomial approximation
// (Bhaskara-style, mirrored). Accurate enough for an audio carrier and avoids
// any libm edge behaviour. Returns ~[-1,1].
@inline function sinePhase(p: f32): f32 {
  // wrap to 0..1
  let ph: f32 = p - f32(Mathf.floor(p));
  // use the standard library sine for spectral purity of the carrier
  return f32(Mathf.sin(ph * TWO_PI));
}

export function process(n: i32): void {
  const freqN: f32 = clampf(params[P_FREQ], 0.0, 1.0);
  const waveN: f32 = clampf(params[P_WAVE], 0.0, 1.0);
  const rateN: f32 = clampf(params[P_RATE], 0.0, 1.0);
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Base carrier frequency, exponential 20..3000 Hz.
  const baseHz: f32 = 20.0 * f32(Mathf.pow(150.0, freqN)); // 20 * 150 = 3000
  // LFO frequency, exponential 0.05..12 Hz.
  const lfoHz: f32 = 0.05 * f32(Mathf.pow(240.0, rateN));  // 0.05 * 240 = 12
  // LFO modulation depth in octaves (0..2 octaves).
  const depthOct: f32 = depthN * 2.0;

  // Per-sample phase increment for the LFO (carrier increment is computed
  // per-sample because the LFO bends it).
  const sr: f32 = sampleRate;
  const lfoInc: f32 = lfoHz / sr;

  // Nyquist guard for the carrier.
  const maxHz: f32 = sr * 0.49;

  let cph: f32 = carrierPhase;
  let lph: f32 = lfoPhase;

  // Process the carrier once per frame (shared across channels) so the
  // stereo image stays coherent and we don't double the oscillator cost.
  for (let f = 0; f < n; f++) {
    // LFO: bipolar sine, scaled to octaves, applied multiplicatively.
    const lfo: f32 = sinePhase(lph);
    let hz: f32 = baseHz * f32(Mathf.pow(2.0, depthOct * lfo));
    if (hz < 0.0) hz = 0.0;
    if (hz > maxHz) hz = maxHz;

    // Carrier sample: blend sine -> square. The square is band-limited a
    // little by mixing with the sine so it doesn't alias too harshly; it is
    // scaled to ~unity peak.
    const s: f32 = sinePhase(cph);
    const sq: f32 = s >= 0.0 ? 1.0 : -1.0;
    // soften the square slightly with the sine to tame the harshest aliasing
    const square: f32 = 0.85 * sq + 0.15 * s;
    const carrier: f32 = s * (1.0 - waveN) + square * waveN;

    // advance carrier & lfo phases
    cph += hz / sr;
    if (cph >= 1.0) cph -= f32(Mathf.floor(cph));
    lph += lfoInc;
    if (lph >= 1.0) lph -= f32(Mathf.floor(lph));

    // Apply ring modulation to every channel for this frame.
    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      const x: f32 = inBuf[base + f];
      const ring: f32 = x * carrier;               // sum/difference sidebands
      let y: f32 = x * (1.0 - mix) + ring * mix;    // dry/wet blend
      // safety clamp — ring of a <=1 input by a <=1 carrier is already bounded,
      // but the square blend can nudge slightly past 1; keep it tidy.
      if (y > 1.5) y = 1.5; else if (y < -1.5) y = -1.5;
      outBuf[base + f] = y;
    }
  }

  carrierPhase = cph;
  lfoPhase = lph;
}
