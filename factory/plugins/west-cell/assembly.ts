// =====================================================================
//  WEST CELL — a west-coast (Buchla-lineage) complex-oscillator voice
//
//  A totally different synthesis path from subtractive: instead of a
//  harmonic-rich oscillator carved by a filter, harmonics are GENERATED
//  on the way up.
//
//    1) COMPLEX OSCILLATOR: a modulator sine cross-modulates (through-zero
//       FM / timbre modulation) a primary sine. Timbre sets the modulation
//       depth, sweeping the primary from a pure tone into a clangorous,
//       inharmonic-leaning spectrum.
//    2) WAVEFOLDER: the complex-osc output is driven into a series of
//       sine-folding stages. As Fold rises the wave creases back on itself,
//       multiplying the harmonic content (the classic "more is more" west
//       coast timbre).
//    3) LOW-PASS GATE (LPG): a combined VCF + VCA that "plucks". A single
//       fast-decaying control envelope simultaneously closes a one-pole
//       low-pass (darkening as it falls) and ducks the amplitude, giving
//       the bongo / marimba / clang transient that defines the lineage.
//
//  Polyphonic (16 voices). Pure algorithm, no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const MAX_VOICES: i32 = 16;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const TWO_PI: f32 = 6.2831853071795864769;
const PI: f32 = 3.14159265358979323846;

// ---- per-voice state (parallel StaticArrays, no allocation in process) ----
const vActive:  StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = slot in use (still ringing)
const vNote:    StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // note id
const vCarPh:   StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // primary phase (radians)
const vModPh:   StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // modulator phase (radians)
const vFreq:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // primary Hz
const vVel:     StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // 0..1
const vEnv:     StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // LPG control envelope (0..1)
const vLpg:     StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // LPG low-pass one-pole state
const vAge:     StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // for voice-steal LRU

let ageCounter: f32 = 0.0;

// ---- parameter indices (MUST match spec.json) ----
const P_TIMBRE:    i32 = 0; // cross-mod (FM/timbre) amount     (0 .. 1)
const P_FOLD:      i32 = 1; // wavefolding drive                (0 .. 1)
const P_GATEDECAY: i32 = 2; // LPG pluck length                 (0 .. 1)
const P_TONE:      i32 = 3; // LPG brightness (open-ness)       (0 .. 1)
const P_LEVEL:     i32 = 4; // output level                     (0 .. 1)

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let v = 0; v < MAX_VOICES; v++) {
    vActive[v] = 0; vNote[v] = -1;
    vCarPh[v] = 0.0; vModPh[v] = 0.0; vFreq[v] = 0.0;
    vVel[v] = 0.0; vEnv[v] = 0.0; vLpg[v] = 0.0; vAge[v] = 0.0;
  }
  ageCounter = 0.0;
  params[P_TIMBRE]    = 0.4;
  params[P_FOLD]      = 0.45;
  params[P_GATEDECAY] = 0.5;
  params[P_TONE]      = 0.55;
  params[P_LEVEL]     = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- note handling: each note retriggers the LPG pluck ----
export function noteOn(id: i32, freq: f32, velocity: f32): void {
  if (freq <= 0.0) freq = 1.0;
  // reuse a voice already playing this id, else a free slot, else steal oldest
  let slot: i32 = -1;
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] != 0 && vNote[v] == id) { slot = v; break; }
  }
  if (slot < 0) {
    for (let v = 0; v < MAX_VOICES; v++) {
      if (vActive[v] == 0) { slot = v; break; }
    }
  }
  if (slot < 0) {
    let oldest: f32 = vAge[0]; slot = 0;
    for (let v = 1; v < MAX_VOICES; v++) {
      if (vAge[v] < oldest) { oldest = vAge[v]; slot = v; }
    }
  }
  ageCounter += 1.0;
  vActive[slot] = 1;
  vNote[slot]   = id;
  vFreq[slot]   = freq;
  vVel[slot]    = clampf(velocity, 0.0, 1.0);
  vCarPh[slot]  = 0.0;
  vModPh[slot]  = 0.0;
  vEnv[slot]    = 1.0;   // strike: control envelope jumps to full, then decays
  vLpg[slot]    = 0.0;
  vAge[slot]    = ageCounter;
}

// West-coast LPGs ring out — note-off doesn't hard-stop; the pluck envelope
// is one-shot. We keep the slot alive until the envelope has decayed, so a
// release simply lets the natural decay finish. (gate is implicit.)
export function noteOff(id: i32): void {
  // no-op: the percussive LPG envelope governs the tail
}

export function process(n: i32): void {
  // ---- resolve params once per block ----
  const timbreN: f32 = clampf(params[P_TIMBRE], 0.0, 1.0);
  const foldN: f32   = clampf(params[P_FOLD], 0.0, 1.0);
  const decayN: f32  = clampf(params[P_GATEDECAY], 0.0, 1.0);
  const toneN: f32   = clampf(params[P_TONE], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0) * 0.8;

  // cross-mod (timbre) depth: how far the modulator pushes the primary phase.
  // 0 = pure sine; up to ~5 radians = dense clangorous spectrum.
  const timbreDepth: f32 = timbreN * 5.0;
  // modulator runs at a fixed slightly-inharmonic ratio for the metallic
  // west-coast character (not a clean integer).
  const modRatio: f32 = 1.41;

  // wavefolder drive: 1 (no fold) .. ~7 (heavily creased, many harmonics)
  const foldDrive: f32 = 1.0 + foldN * foldN * 6.0;
  // makeup so loud folding doesn't simply get louder
  const foldComp: f32 = 1.0 / (0.6 + foldN * 0.9);

  // LPG control envelope decay: 40 ms (snappy bongo) .. 2.2 s (long marimba/chime)
  const decaySec: f32 = 0.04 + decayN * decayN * 2.16;
  const envCoef: f32 = f32(Mathf.exp(-1.0 / (decaySec * sampleRate)));

  // LPG low-pass: Tone sets how bright it can open; the per-sample cutoff is
  // additionally pulled DOWN as the control envelope falls (vactrol behaviour).
  const maxCutHz: f32 = 400.0 + toneN * toneN * 11000.0;
  const minCutHz: f32 = 120.0;
  const invSr: f32 = 1.0 / sampleRate;

  // ---- clear output block ----
  for (let f = 0; f < n; f++) {
    outBuf[f] = 0.0;
    outBuf[MAX_FRAMES + f] = 0.0;
  }

  // ---- render each active voice (mono sum, copied to both channels) ----
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] == 0) continue;

    const f0: f32 = vFreq[v];
    const carInc: f32 = TWO_PI * f0 * invSr;
    const modInc: f32 = TWO_PI * f0 * modRatio * invSr;
    const vel: f32 = vVel[v];
    // harder hits open the LPG brighter and fold a touch harder (dynamic timbre)
    const velCut: f32 = 0.55 + vel * 0.45;
    const velFold: f32 = 0.8 + vel * 0.3;

    let carPh: f32 = vCarPh[v];
    let modPh: f32 = vModPh[v];
    let envL:  f32 = vEnv[v];
    let lpg:   f32 = vLpg[v];

    for (let f = 0; f < n; f++) {
      // control envelope (one-shot exponential decay = the "pluck")
      envL *= envCoef;

      // --- complex oscillator: modulator phase-modulates the primary ---
      const modOut: f32 = Mathf.sin(modPh) * timbreDepth;
      let s: f32 = Mathf.sin(carPh + modOut);

      // --- wavefolder: drive then fold via sine (each crease adds harmonics) ---
      // velocity nudges fold so dynamics change the spectrum, not just volume.
      const driven: f32 = s * foldDrive * velFold;
      // two-stage sine fold: sin(x) folds, the second stage sharpens the creases
      let folded: f32 = Mathf.sin(driven);
      folded = folded + 0.5 * Mathf.sin(driven * 2.0 + folded);
      folded *= foldComp * 0.7;

      // --- low-pass gate: cutoff tracks the control envelope (vactrol) ---
      let cut: f32 = minCutHz + (maxCutHz - minCutHz) * envL * velCut;
      if (cut > sampleRate * 0.45) cut = sampleRate * 0.45;
      const g: f32 = f32(1.0 - Mathf.exp(-TWO_PI * cut * invSr));
      lpg += g * (folded - lpg);

      // VCA part of the LPG: the same envelope ducks the amplitude
      const out: f32 = lpg * envL * vel;

      outBuf[f] += out;

      carPh += carInc; if (carPh >= TWO_PI) carPh -= TWO_PI;
      modPh += modInc; if (modPh >= TWO_PI) modPh -= TWO_PI;
    }

    vCarPh[v] = carPh;
    vModPh[v] = modPh;
    vEnv[v]   = envL;
    vLpg[v]   = lpg;

    // retire the voice once the pluck has fully decayed
    if (envL < 0.00008) {
      vActive[v] = 0; vNote[v] = -1;
    }
  }

  // ---- output level + gentle soft safety limit, copy mono to stereo ----
  for (let f = 0; f < n; f++) {
    let s: f32 = outBuf[f] * level;
    if (s > 1.2) s = 1.2; else if (s < -1.2) s = -1.2;
    s = f32(s - 0.16666667 * s * s * s); // soft knee, peak < 1.0
    outBuf[f] = s;
    outBuf[MAX_FRAMES + f] = s;
  }
}
