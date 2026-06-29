// =====================================================================
//  VOWEL BOX — talk-box / formant filter effect
//  Makes the input "talk": three resonant band-pass FORMANT filters whose
//  centre frequencies morph between the vowel sets A-E-I-O-U as the Vowel
//  control sweeps. A pre-gain Drive adds harmonics for the formants to bite
//  into, Resonance sharpens the formant peaks, and Mix blends against dry.
//  Pure algorithm, no samples.
//
//  Each formant is a state-variable band-pass filter (TPT/Zavalishin style),
//  stable and cheap, evaluated per sample. Formant tables are classic male
//  vowel F1/F2/F3 centre frequencies; the Vowel control linearly morphs the
//  centre frequencies (and relative gains) between adjacent vowels.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// --- formant state-variable band-pass state (per channel, per formant) ---
// 3 formants * MAX_CHANNELS. Index = formant * MAX_CHANNELS + channel.
const svIc1: StaticArray<f32> = new StaticArray<f32>(3 * MAX_CHANNELS); // integrator 1
const svIc2: StaticArray<f32> = new StaticArray<f32>(3 * MAX_CHANNELS); // integrator 2

// --- vowel formant tables (5 vowels: A E I O U) ---
// classic male-voice formant centre frequencies (Hz) for F1, F2, F3
const VOWEL_F1: StaticArray<f32> = new StaticArray<f32>(5);
const VOWEL_F2: StaticArray<f32> = new StaticArray<f32>(5);
const VOWEL_F3: StaticArray<f32> = new StaticArray<f32>(5);
// per-formant relative gain for each vowel (formant 3 is quieter)
const VOWEL_G1: StaticArray<f32> = new StaticArray<f32>(5);
const VOWEL_G2: StaticArray<f32> = new StaticArray<f32>(5);
const VOWEL_G3: StaticArray<f32> = new StaticArray<f32>(5);

const P_VOWEL: i32 = 0; // 0..1 -> morph A..U
const P_RES: i32 = 1;   // 0..1 -> formant sharpness (Q)
const P_DRIVE: i32 = 2; // 0..1 -> pre-gain 1..12 + harmonics
const P_MIX: i32 = 3;   // 0..1 dry/wet
const P_LEVEL: i32 = 4; // 0..1 -> 0..1.4 output

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < 3 * MAX_CHANNELS; i++) { svIc1[i] = 0.0; svIc2[i] = 0.0; }

  // A   E    I    O    U
  VOWEL_F1[0] = 730.0; VOWEL_F1[1] = 530.0; VOWEL_F1[2] = 270.0; VOWEL_F1[3] = 570.0; VOWEL_F1[4] = 300.0;
  VOWEL_F2[0] = 1090.0; VOWEL_F2[1] = 1840.0; VOWEL_F2[2] = 2290.0; VOWEL_F2[3] = 840.0; VOWEL_F2[4] = 870.0;
  VOWEL_F3[0] = 2440.0; VOWEL_F3[1] = 2480.0; VOWEL_F3[2] = 3010.0; VOWEL_F3[3] = 2410.0; VOWEL_F3[4] = 2240.0;

  for (let v = 0; v < 5; v++) { VOWEL_G1[v] = 1.0; VOWEL_G2[v] = 0.75; VOWEL_G3[v] = 0.45; }

  params[P_VOWEL] = 0.0;
  params[P_RES]   = 0.6;
  params[P_DRIVE] = 0.45;
  params[P_MIX]   = 1.0;
  params[P_LEVEL] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// soft saturation used by Drive so the formants have rich harmonics to filter
@inline function softClip(x: f32): f32 {
  const c: f32 = clampf(x, -1.5, 1.5);
  return f32(c - 0.14814815 * c * c * c); // ~tanh-ish cubic, gentle
}

// module-scope morph scratch (computed per block, no alloc in process loop)
let mF1: f32 = 730.0; let mF2: f32 = 1090.0; let mF3: f32 = 2440.0;
let mG1: f32 = 1.0;   let mG2: f32 = 0.75;   let mG3: f32 = 0.45;

@inline function lerpf(a: f32, b: f32, t: f32): f32 { return f32(a + (b - a) * t); }

// resolve the morphed formant frequencies/gains for a Vowel position 0..1
function computeMorph(vowel: f32): void {
  const pos: f32 = clampf(vowel, 0.0, 1.0) * 4.0; // 0..4 across 5 vowels
  let i0: i32 = i32(pos);
  if (i0 > 3) i0 = 3;
  const i1: i32 = i0 + 1;
  const t: f32 = pos - f32(i0);

  mF1 = lerpf(VOWEL_F1[i0], VOWEL_F1[i1], t);
  mF2 = lerpf(VOWEL_F2[i0], VOWEL_F2[i1], t);
  mF3 = lerpf(VOWEL_F3[i0], VOWEL_F3[i1], t);
  mG1 = lerpf(VOWEL_G1[i0], VOWEL_G1[i1], t);
  mG2 = lerpf(VOWEL_G2[i0], VOWEL_G2[i1], t);
  mG3 = lerpf(VOWEL_G3[i0], VOWEL_G3[i1], t);
}

// TPT state-variable band-pass coefficients (shared per formant per block)
let g1: f32 = 0.0; let g2: f32 = 0.0; let g3: f32 = 0.0; // tan(pi*fc/sr)
let k: f32 = 0.5;                                         // damping = 1/Q
let a1c: f32 = 0.0;                                       // 1/(1+g*(g+k)) per formant
let a1c1: f32 = 0.0; let a1c2: f32 = 0.0; let a1c3: f32 = 0.0;

@inline function tanApprox(x: f32): f32 {
  // tan(pi*fc/sr); fc/sr small-ish, use Mathf.tan (f32) directly, bounded
  return f32(Mathf.tan(x));
}

export function process(n: i32): void {
  const vowel: f32 = clampf(params[P_VOWEL], 0.0, 1.0);
  const res: f32 = clampf(params[P_RES], 0.0, 1.0);
  const driveN: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.4;

  computeMorph(vowel);

  // Q from resonance: 2 .. 28 (higher = sharper formant peaks)
  const Q: f32 = 2.0 + res * res * 26.0;
  k = f32(1.0 / Q);

  const pi: f32 = 3.14159265;
  const ny: f32 = sampleRate * 0.49;

  // band-pass uses the bp output of the SVF, scaled by k so peak gain ~1
  const f1c: f32 = clampf(mF1, 40.0, ny);
  const f2c: f32 = clampf(mF2, 40.0, ny);
  const f3c: f32 = clampf(mF3, 40.0, ny);
  g1 = tanApprox(pi * f1c / sampleRate);
  g2 = tanApprox(pi * f2c / sampleRate);
  g3 = tanApprox(pi * f3c / sampleRate);
  a1c1 = f32(1.0 / (1.0 + g1 * (g1 + k)));
  a1c2 = f32(1.0 / (1.0 + g2 * (g2 + k)));
  a1c3 = f32(1.0 / (1.0 + g3 * (g3 + k)));

  const drive: f32 = 1.0 + driveN * 11.0;
  // output makeup: band-pass gains scale with k; compensate so wet stays bounded
  const formScale: f32 = f32(k * 2.2);
  // overall wet trim to keep peak < ~1 after summing 3 formants + drive
  const wetTrim: f32 = 0.7;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const idx0: i32 = 0 * MAX_CHANNELS + c;
    const idx1: i32 = 1 * MAX_CHANNELS + c;
    const idx2: i32 = 2 * MAX_CHANNELS + c;
    let ic1a: f32 = svIc1[idx0]; let ic2a: f32 = svIc2[idx0];
    let ic1b: f32 = svIc1[idx1]; let ic2b: f32 = svIc2[idx1];
    let ic1d: f32 = svIc1[idx2]; let ic2d: f32 = svIc2[idx2];

    for (let f = 0; f < n; f++) {
      const dry: f32 = inBuf[base + f];
      // pre-gain + soft saturate -> harmonics for the formants to grab
      const exc: f32 = softClip(dry * drive);

      // --- formant 1 (SVF band-pass) ---
      let v3: f32 = exc - ic2a;
      let v1: f32 = f32(a1c1 * (ic1a + g1 * v3));
      let v2: f32 = f32(ic2a + g1 * v1);
      ic1a = f32(2.0 * v1 - ic1a);
      ic2a = f32(2.0 * v2 - ic2a);
      const bp1: f32 = v1; // band-pass output

      // --- formant 2 ---
      v3 = exc - ic2b;
      v1 = f32(a1c2 * (ic1b + g2 * v3));
      v2 = f32(ic2b + g2 * v1);
      ic1b = f32(2.0 * v1 - ic1b);
      ic2b = f32(2.0 * v2 - ic2b);
      const bp2: f32 = v1;

      // --- formant 3 ---
      v3 = exc - ic2d;
      v1 = f32(a1c3 * (ic1d + g3 * v3));
      v2 = f32(ic2d + g3 * v1);
      ic1d = f32(2.0 * v1 - ic1d);
      ic2d = f32(2.0 * v2 - ic2d);
      const bp3: f32 = v1;

      let wet: f32 = f32((bp1 * mG1 + bp2 * mG2 + bp3 * mG3) * formScale * wetTrim);
      // final gentle clip so peaks never explode at high Resonance
      wet = softClip(wet);

      const outv: f32 = f32((dry * (1.0 - mix) + wet * mix) * level);
      outBuf[base + f] = outv;
    }

    svIc1[idx0] = ic1a; svIc2[idx0] = ic2a;
    svIc1[idx1] = ic1b; svIc2[idx1] = ic2b;
    svIc1[idx2] = ic1d; svIc2[idx2] = ic2d;
  }
}
