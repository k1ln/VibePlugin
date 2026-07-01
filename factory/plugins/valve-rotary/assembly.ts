// =====================================================================
//  VALVE ROTARY — overdriven tube preamp into a rotating-speaker chain
//  The full gritty organ chain: a warm TUBE PREAMP (asymmetric soft-clip
//  with grid bias + a little second-harmonic warmth) that can be pushed
//  from clean into growling overdrive, FEEDING a twin-rotor rotating
//  speaker. The signal is split into a bass-rotor (drum) band and a
//  treble horn band; each spins through its own virtual driver producing
//  amplitude tremolo PLUS a short Doppler pitch vibrato via a modulated
//  delay line. Horn spins faster than the drum, in opposite phase. A
//  Speed control morphs slow (chorale) <-> fast (tremolo) and the rotor
//  rates RAMP with inertia — they never jump — so the swirl audibly
//  accelerates and decelerates. Two virtual mics build the stereo image.
//  Distinct from the clean Rotary Cabinet: here a saturating valve stage
//  sits IN FRONT of the rotors, so the swirl rides on top of the grit.
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
const P_SPEED: i32 = 0;  // 0..1  -> slow (chorale) .. fast (tremolo), ramped
const P_DRIVE: i32 = 1;  // 0..1  -> tube preamp grit (clean .. growling)
const P_DEPTH: i32 = 2;  // 0..1  -> amount of Doppler vibrato + AM tremolo
const P_TONE:  i32 = 3;  // 0..1  -> dark .. bright (post tube tilt)
const P_MIX:   i32 = 4;  // 0..1  -> dry/wet

// ---- target rotor rates (Hz) -----------------------------------------
const HORN_SLOW: f32 = 0.80;
const HORN_FAST: f32 = 6.90;
const DRUM_SLOW: f32 = 0.65;
const DRUM_FAST: f32 = 5.90;

// ---- modulated delay lines for the Doppler vibrato -------------------
const DELAY_LEN: i32 = 2048;            // > 12 ms @ 48k
const hornDelay: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
const drumDelay: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN);
let dWrite: i32 = 0;

// ---- crossover state (2x one-pole = ~12 dB/oct) ----------------------
const lpA: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lpB: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// ---- tube preamp filter state ----------------------------------------
let preHP: f32 = 0.0;    // pre-clip DC/low blocker
let toneLP: f32 = 0.0;   // post-tube tone tilt low-pass
let dcBlock: f32 = 0.0;  // remove the bias DC after asymmetric clip
let dcPrev: f32 = 0.0;

// ---- rotor phase + smoothed (inertial) rate state --------------------
let hornPhase: f32 = 0.0;
let drumPhase: f32 = 0.25;
let hornRate:  f32 = HORN_SLOW;
let drumRate:  f32 = DRUM_SLOW;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// asymmetric valve-style saturation: a tanh-ish soft clip with grid bias
// so positive and negative excursions clip differently -> 2nd harmonic
// warmth that grows into a growl as drive rises.
@inline function valve(x: f32): f32 {
  // grid bias shifts the operating point; clamp keeps it bounded
  const b: f32 = x + 0.18;
  // rational tanh approximation, cheap and smooth, saturates to ~±1
  const c: f32 = clampf(b, -3.0, 3.0);
  const num: f32 = c * (27.0 + c * c);
  const den: f32 = 27.0 + 9.0 * c * c;
  return num / den;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  for (let c = 0; c < MAX_CHANNELS; c++) { lpA[c] = 0.0; lpB[c] = 0.0; }
  for (let i = 0; i < DELAY_LEN; i++) { hornDelay[i] = 0.0; drumDelay[i] = 0.0; }
  dWrite = 0;
  preHP = 0.0; toneLP = 0.0; dcBlock = 0.0; dcPrev = 0.0;
  hornPhase = 0.0;
  drumPhase = 0.25;
  hornRate = HORN_SLOW;
  drumRate = DRUM_SLOW;

  params[P_SPEED] = 0.85;  // start near fast so the spin-up ramp is obvious
  params[P_DRIVE] = 0.45;
  params[P_DEPTH] = 0.7;
  params[P_TONE]  = 0.55;
  params[P_MIX]   = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// fractional read from a delay line, `back` samples behind the write head
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
  const speed: f32 = clampf(params[P_SPEED], 0.0, 1.0);
  const drive: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const depth: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE],  0.0, 1.0);
  const mix:   f32 = clampf(params[P_MIX],   0.0, 1.0);

  // --- tube preamp drive: 1..18x into the valve, gain-compensated -----
  const preGain: f32 = 1.0 + drive * drive * 17.0;
  const comp: f32 = 1.0 / f32(Mathf.sqrt(1.0 + drive * 2.4));   // tame loudness

  // pre-clip HP ~70 Hz so the bass rotor doesn't get muddy in the valve
  const cHP: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 70.0 / sampleRate));
  // post-tube tone tilt: 1.2 kHz (dark) .. 9 kHz (bright)
  const toneHz: f32 = 1200.0 + toneN * toneN * 7800.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-TWO_PI * toneHz / sampleRate));
  // DC blocker coefficient (removes the asymmetric bias offset)
  const dcR: f32 = f32(1.0 - TWO_PI * 12.0 / sampleRate);

  // --- target rotor rates from Speed (linear morph slow<->fast) -------
  const hornTarget: f32 = HORN_SLOW + (HORN_FAST - HORN_SLOW) * speed;
  const drumTarget: f32 = DRUM_SLOW + (DRUM_FAST - DRUM_SLOW) * speed;

  // --- inertia: fixed authentic ramp (~0.9 s horn, heavier drum) ------
  const rampSec: f32 = 0.9;
  const hornGlide: f32 = f32(1.0 - Mathf.exp(-1.0 / (rampSec * sampleRate)));
  const drumGlide: f32 = f32(1.0 - Mathf.exp(-1.0 / (rampSec * 1.7 * sampleRate)));

  // --- crossover coefficient (~760 Hz horn/drum split) ----------------
  const xc: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 760.0 / sampleRate));

  // --- Doppler delay swing (samples). Depth scales the excursion. -----
  const hornSwing: f32 = depth * 0.0019 * sampleRate;  // up to ~1.9 ms each way
  const drumSwing: f32 = depth * 0.0011 * sampleRate;  // up to ~1.1 ms each way
  const baseDelay: f32 = 0.004 * sampleRate;           // 4 ms standing delay

  // --- amplitude tremolo depth ---------------------------------------
  const amDepth: f32 = depth * 0.55;

  const inc: f32 = TWO_PI / sampleRate;

  let hp: f32 = hornPhase;
  let dp: f32 = drumPhase;
  let hr: f32 = hornRate;
  let dr: f32 = drumRate;
  let pHP: f32 = preHP;
  let tLP: f32 = toneLP;
  let dcb: f32 = dcBlock;
  let dcp: f32 = dcPrev;

  for (let f = 0; f < n; f++) {
    // --- glide rotor rates toward target (inertia) ---
    hr += hornGlide * (hornTarget - hr);
    dr += drumGlide * (drumTarget - dr);

    // --- advance rotor phases ---
    hp += inc * hr; if (hp >= TWO_PI) hp -= TWO_PI;
    dp += inc * dr; if (dp >= TWO_PI) dp -= TWO_PI;

    // --- mono input feed (a rotary cab is one driver chain) ---
    const xl: f32 = inBuf[f];
    const xr: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : xl;
    const mono: f32 = (xl + xr) * 0.5;

    // ============ TUBE PREAMP STAGE ============
    pHP = pHP + cHP * (mono - pHP);
    const clean: f32 = mono - pHP;             // high-passed into the valve
    const driven: f32 = valve(clean * preGain) * comp;
    // DC block to remove the asymmetric bias offset
    const blocked: f32 = driven - dcp + dcR * dcb;
    dcp = driven;
    dcb = blocked;
    // post-tube tone tilt
    tLP = tLP + cTone * (blocked - tLP);
    // blend a touch of the brightened top back for sparkle
    const pre: f32 = tLP + (blocked - tLP) * 0.35;

    // ============ ROTARY SPEAKER STAGE ============
    // 2-pole crossover split of the preamp output
    let la: f32 = lpA[0]; let lb: f32 = lpB[0];
    la = la + xc * (pre - la);
    lb = lb + xc * (la - lb);
    lpA[0] = la; lpB[0] = lb;
    const low: f32 = lb;            // bass rotor band
    const high: f32 = pre - lb;     // horn band

    // write bands into delay lines
    hornDelay[dWrite] = high;
    drumDelay[dWrite] = low;

    // Doppler taps swing with rotor phase
    const hSin: f32 = Mathf.sin(hp);
    const hCos: f32 = Mathf.cos(hp);
    const dSin: f32 = Mathf.sin(dp);
    const dCos: f32 = Mathf.cos(dp);

    const hornBack: f32 = baseDelay + hornSwing * (1.0 + hSin);
    const drumBack: f32 = baseDelay + drumSwing * (1.0 + dSin);

    const hornWet: f32 = tapDelay(hornDelay, hornBack);
    const drumWet: f32 = tapDelay(drumDelay, drumBack);

    // amplitude tremolo (driver facing the mic = louder)
    const hornAM: f32 = 1.0 - amDepth * (0.5 - 0.5 * hCos);
    const drumAM: f32 = 1.0 - (amDepth * 0.7) * (0.5 - 0.5 * dCos);

    const hornS: f32 = hornWet * hornAM;
    const drumS: f32 = drumWet * drumAM;

    // two virtual mics: horn & drum pan in opposition -> swirling image
    const hornPan: f32 = 0.85 * hCos;
    const drumPan: f32 = -0.65 * dCos;

    const hornL: f32 = hornS * (0.5 - 0.5 * hornPan);
    const hornR: f32 = hornS * (0.5 + 0.5 * hornPan);
    const drumL: f32 = drumS * (0.5 - 0.5 * drumPan);
    const drumR: f32 = drumS * (0.5 + 0.5 * drumPan);

    let wetL: f32 = (hornL + drumL) * 1.4;
    let wetR: f32 = (hornR + drumR) * 1.4;

    // dry/wet
    const outL: f32 = xl * (1.0 - mix) + wetL * mix;
    const outR: f32 = xr * (1.0 - mix) + wetR * mix;

    outBuf[f] = clampf(outL, -0.98, 0.98);
    outBuf[MAX_FRAMES + f] = clampf(outR, -0.98, 0.98);

    dWrite++; if (dWrite >= DELAY_LEN) dWrite = 0;
  }

  hornPhase = hp;
  drumPhase = dp;
  hornRate = hr;
  drumRate = dr;
  preHP = pHP;
  toneLP = tLP;
  dcBlock = dcb;
  dcPrev = dcp;
}
