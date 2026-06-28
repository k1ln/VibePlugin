// =====================================================================
//  ROTARY CABINET — rotating-speaker (twin-rotor) simulator
//  Splits the signal into a low (woofer/drum) band and a high (horn) band
//  with a Linkwitz-Riley-style crossover, then rotates each through its own
//  virtual driver. Rotation gives BOTH amplitude tremolo (the driver swings
//  toward and away from the mics) AND a small pitch/Doppler vibrato via a
//  short modulated delay line. Horn and drum spin at slightly different
//  rates and opposite phase. A Speed control morphs slow (chorale) <-> fast
//  (tremolo) with INERTIA — the rotor rates RAMP up and down, they never
//  jump. Two virtual mics, panned apart, build the stereo image.
//  Pure algorithm, no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

// ---- parameter map (indices MUST match spec.json) --------------------
const P_SPEED:   i32 = 0;  // 0..1  -> slow (chorale) .. fast (tremolo)
const P_INERTIA: i32 = 1;  // 0..1  -> rotor acceleration ramp time (short..long)
const P_DEPTH:   i32 = 2;  // 0..1  -> amount of AM + Doppler vibrato
const P_MIX:     i32 = 3;  // 0..1  -> dry/wet
const P_WIDTH:   i32 = 4;  // 0..1  -> stereo spread of the two mics

// ---- target rotor rates (Hz) -----------------------------------------
// Authentic twin-rotor speeds. Horn (treble) spins faster than the drum
// (bass). Chorale ~ slow, tremolo ~ fast.
const HORN_SLOW: f32 = 0.80;
const HORN_FAST: f32 = 6.80;
const DRUM_SLOW: f32 = 0.70;
const DRUM_FAST: f32 = 6.00;

// ---- modulated delay line for the Doppler vibrato --------------------
// ~12 ms max per channel-band is plenty for a few semitones of pitch wobble.
const DELAY_LEN: i32 = 2048;            // ring buffer, > 12ms @ 48k
const hornDelay: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
const drumDelay: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
let dWrite: i32 = 0;

// ---- crossover state (2x one-pole per band = ~12 dB/oct) -------------
const lpA: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lpB: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hpA: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hpB: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// ---- rotor phase + smoothed (inertial) rate state --------------------
let hornPhase: f32 = 0.0;
let drumPhase: f32 = 0.0;
let hornRate:  f32 = HORN_SLOW;   // current (smoothed) Hz
let drumRate:  f32 = DRUM_SLOW;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  for (let c = 0; c < MAX_CHANNELS; c++) {
    lpA[c] = 0.0; lpB[c] = 0.0; hpA[c] = 0.0; hpB[c] = 0.0;
  }
  for (let i = 0; i < DELAY_LEN; i++) {
    hornDelay[i] = 0.0; drumDelay[i] = 0.0;
  }
  dWrite = 0;
  hornPhase = 0.0;
  drumPhase = 0.25;                 // start the rotors out of phase
  // Start at rest (slow) so INERTIA audibly governs the spin-up ramp.
  hornRate = HORN_SLOW;
  drumRate = DRUM_SLOW;

  params[P_SPEED]   = 0.85;  // start near fast so the spin-up is obvious
  params[P_INERTIA] = 0.45;
  params[P_DEPTH]   = 0.7;
  params[P_MIX]     = 1.0;
  params[P_WIDTH]   = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// read a delay line at a fractional sample distance `back` (in samples)
// from the current write head, linearly interpolated.
@inline function tapDelay(line: StaticArray<f32>, back: f32): f32 {
  let bk: f32 = back;
  if (bk < 1.0) bk = 1.0;
  if (bk > f32(DELAY_LEN - 2)) bk = f32(DELAY_LEN - 2);
  let rp: f32 = f32(dWrite) - bk;
  if (rp < 0.0) rp += f32(DELAY_LEN);
  if (rp < 0.0) rp = 0.0;
  let i0: i32 = i32(rp);
  if (i0 < 0) i0 = 0;
  if (i0 >= DELAY_LEN) i0 = DELAY_LEN - 1;
  let i1: i32 = i0 + 1;
  if (i1 >= DELAY_LEN) i1 -= DELAY_LEN;
  const frac: f32 = rp - f32(i0);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const speed:   f32 = clampf(params[P_SPEED],   0.0, 1.0);
  const inertia: f32 = clampf(params[P_INERTIA], 0.0, 1.0);
  const depth:   f32 = clampf(params[P_DEPTH],   0.0, 1.0);
  const mix:     f32 = clampf(params[P_MIX],     0.0, 1.0);
  const width:   f32 = clampf(params[P_WIDTH],   0.0, 1.0);

  // --- target rotor rates from Speed (linear morph slow<->fast) -------
  const hornTarget: f32 = HORN_SLOW + (HORN_FAST - HORN_SLOW) * speed;
  const drumTarget: f32 = DRUM_SLOW + (DRUM_FAST - DRUM_SLOW) * speed;

  // --- inertia: one-pole smoothing of the rate toward the target ------
  // Short ramp ~0.15 s, long ramp ~3.0 s. The drum is heavier than the horn.
  const rampSec: f32 = 0.15 + inertia * 2.85;
  const hornGlide: f32 = f32(1.0 - Mathf.exp(-1.0 / (rampSec * sampleRate)));
  const drumGlide: f32 = f32(1.0 - Mathf.exp(-1.0 / (rampSec * 1.6 * sampleRate)));

  // --- crossover coefficient (~800 Hz split) --------------------------
  const xHz: f32 = 800.0;
  const xc: f32 = f32(1.0 - Mathf.exp(-TWO_PI * xHz / sampleRate));

  // --- Doppler delay swing (samples). Depth scales the excursion. -----
  // Horn throws further than the drum (longer effective radius / higher band).
  const hornSwing: f32 = depth * 0.0019 * sampleRate; // ~ up to 1.9 ms each way
  const drumSwing: f32 = depth * 0.0011 * sampleRate; // ~ up to 1.1 ms each way
  const baseDelay: f32 = 0.004 * sampleRate;          // 4 ms standing delay

  // --- amplitude tremolo depth ---------------------------------------
  const amDepth: f32 = depth * 0.55;

  // --- stereo: two mics. width spreads horn/drum pan opposingly -------
  const w: f32 = width;

  const hornInc: f32 = TWO_PI / sampleRate;
  const drumInc: f32 = TWO_PI / sampleRate;

  // Mono-sum the input front-end (a rotary cab is fed one driver chain),
  // but keep per-channel crossover state coherent by processing L/R.
  let hp: f32 = hornPhase;
  let dp: f32 = drumPhase;
  let hr: f32 = hornRate;
  let dr: f32 = drumRate;

  for (let f = 0; f < n; f++) {
    // glide the rotor rates toward their targets (inertia)
    hr += hornGlide * (hornTarget - hr);
    dr += drumGlide * (drumTarget - dr);

    // advance rotor phases
    hp += hornInc * hr; if (hp >= TWO_PI) hp -= TWO_PI;
    dp += drumInc * dr; if (dp >= TWO_PI) dp -= TWO_PI;

    // mono input feed (sum L+R)
    const xl: f32 = inBuf[f];
    const xr: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : xl;
    const mono: f32 = (xl + xr) * 0.5;

    // ---- 2-pole crossover (use channel-0 state for the mono feed) ----
    let la: f32 = lpA[0]; let lb: f32 = lpB[0];
    la = la + xc * (mono - la);
    lb = lb + xc * (la - lb);
    lpA[0] = la; lpB[0] = lb;
    const low: f32 = lb;             // drum band
    const high: f32 = mono - lb;     // horn band

    // ---- write the bands into their delay lines ----------------------
    hornDelay[dWrite] = high;
    drumDelay[dWrite] = low;

    // ---- Doppler taps: delay swings with rotor phase (sin) -----------
    const hSin: f32 = Mathf.sin(hp);
    const hCos: f32 = Mathf.cos(hp);
    const dSin: f32 = Mathf.sin(dp);
    const dCos: f32 = Mathf.cos(dp);

    const hornBack: f32 = baseDelay + hornSwing * (1.0 + hSin);
    const drumBack: f32 = baseDelay + drumSwing * (1.0 + dSin);

    const hornWet: f32 = tapDelay(hornDelay, hornBack);
    const drumWet: f32 = tapDelay(drumDelay, drumBack);

    // ---- amplitude tremolo (driver facing the mic = louder) ----------
    const hornAM: f32 = 1.0 - amDepth * (0.5 - 0.5 * hCos);
    const drumAM: f32 = 1.0 - (amDepth * 0.7) * (0.5 - 0.5 * dCos);

    const hornS: f32 = hornWet * hornAM;
    const drumS: f32 = drumWet * drumAM;

    // ---- two virtual mics: pan horn & drum by rotor phase ------------
    // mic separation grows with Width. Horn and drum pan in opposition so
    // the image swirls. Use cos of phase for the L/R balance.
    const hornPan: f32 = w * 0.9 * hCos;   // -w..+w
    const drumPan: f32 = -w * 0.7 * dCos;

    const hornL: f32 = hornS * (0.5 - 0.5 * hornPan);
    const hornR: f32 = hornS * (0.5 + 0.5 * hornPan);
    const drumL: f32 = drumS * (0.5 - 0.5 * drumPan);
    const drumR: f32 = drumS * (0.5 + 0.5 * drumPan);

    // sum bands per channel; *2 compensates the 0.5/0.5 mic split gain
    let wetL: f32 = (hornL + drumL) * 1.6;
    let wetR: f32 = (hornR + drumR) * 1.6;

    // ---- dry/wet ----------------------------------------------------
    const outL: f32 = xl * (1.0 - mix) + wetL * mix;
    const outR: f32 = xr * (1.0 - mix) + wetR * mix;

    outBuf[f] = clampf(outL, -1.2, 1.2);
    outBuf[MAX_FRAMES + f] = clampf(outR, -1.2, 1.2);

    // advance the shared delay write head
    dWrite++; if (dWrite >= DELAY_LEN) dWrite = 0;
  }

  hornPhase = hp;
  drumPhase = dp;
  hornRate = hr;
  drumRate = dr;
}
