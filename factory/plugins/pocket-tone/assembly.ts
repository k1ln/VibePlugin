// =====================================================================
//  POCKET TONE — a lo-fi mini-digital pocket synth (Casio VL-1 lineage).
//  Deliberately small and charming: six voices, five selectable single-
//  cycle timbres (piano / fantasy / violin / flute / guitar) each built
//  from a short additive or pulse formula, a simple AR amplitude contour,
//  a touch of pitch vibrato, and a BITS lo-fi crunch (sample-rate + bit
//  reduction) for the unmistakable cheap-digital character. Thin, toy-
//  like, NOT lush. Pure algorithm, no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 6;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_VOICE:   i32 = 0;  // 0..4 stepped -> timbre select
const P_ATTACK:  i32 = 1;  // 0..1 -> attack seconds
const P_RELEASE: i32 = 2;  // 0..1 -> release seconds
const P_VIBRATO: i32 = 3;  // 0..1 -> pitch vibrato depth
const P_BITS:    i32 = 4;  // 0..1 -> lo-fi crunch (sample-rate + bit reduction)
const P_LEVEL:   i32 = 5;  // 0..1 -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice steal

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhase:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // 0..1 cycle phase

// AR amplitude envelope
const vEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 attack 2 hold 3 release

let ageCounter: i32 = 0;
let lfoPhase: f32 = 0.0;

// ---- bit-crusher sample-and-hold state ------------------------------
let crHoldL: f32 = 0.0;
let crHoldR: f32 = 0.0;
let crPhase: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0; vPhase[v] = 0.0;
    vEnv[v] = 0.0; vStage[v] = 0;
  }
  ageCounter = 0;
  lfoPhase = 0.0;
  crHoldL = 0.0; crHoldR = 0.0; crPhase = 0.0;

  params[P_VOICE]   = 0.0;   // piano
  params[P_ATTACK]  = 0.04;
  params[P_RELEASE] = 0.30;
  params[P_VIBRATO] = 0.25;
  params[P_BITS]    = 0.35;
  params[P_LEVEL]   = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- voice allocation -----------------------------------------------
export function noteOn(id: i32, f: f32, v: f32): void {
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 0) { slot = i; break; }
  }
  if (slot < 0) {
    let oldest: i32 = 0;
    let oldestAge: i32 = vAge[0];
    for (let i = 1; i < NUM_VOICES; i++) {
      if (vAge[i] < oldestAge) { oldestAge = vAge[i]; oldest = i; }
    }
    slot = oldest;
  }

  vNote[slot]   = id;
  vFreq[slot]   = f > 0.0 ? f : 1.0;
  vVel[slot]    = clampf(v, 0.0, 1.0);
  vActive[slot] = 1;
  vGate[slot]   = 1;
  vStage[slot]  = 1;     // attack
  vPhase[slot]  = 0.0;
  vEnv[slot]    = 0.0;
  vAge[slot]    = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vStage[i] = 3;      // release
    }
  }
}

// =====================================================================
//  VOICE TIMBRES — single-cycle waveshapes evaluated from phase (0..1).
//  Kept cheap and THIN on purpose: a handful of harmonics or a pulse,
//  so each preset has its own clear, toy-like character.
//  Returns roughly [-1, 1].
// =====================================================================
@inline function voicePiano(ph: f32): f32 {
  // bright narrow pulse-ish tone with a couple of harmonics (the VL-1 "piano")
  const a: f32 = ph * TWO_PI;
  let s: f32 = Mathf.sin(a);
  s += 0.45 * Mathf.sin(2.0 * a);
  s += 0.22 * Mathf.sin(3.0 * a);
  s += 0.10 * Mathf.sin(5.0 * a);
  return f32(s * 0.55);
}

@inline function voiceFantasy(ph: f32): f32 {
  // hollow bell/fantasy tone: odd harmonics with an inharmonic shimmer
  const a: f32 = ph * TWO_PI;
  let s: f32 = Mathf.sin(a);
  s += 0.5 * Mathf.sin(3.0 * a);
  s += 0.3 * Mathf.sin(5.01 * a);   // slight inharmonic ring
  s += 0.18 * Mathf.sin(7.0 * a);
  return f32(s * 0.5);
}

@inline function voiceViolin(ph: f32): f32 {
  // buzzy saw-like string (rich low harmonics)
  const saw: f32 = 2.0 * ph - 1.0;             // raw saw
  const a: f32 = ph * TWO_PI;
  // soften the very top with a sine to keep it thin, not harsh
  const s: f32 = saw * 0.7 + f32(Mathf.sin(a)) * 0.25;
  return f32(s * 0.85);
}

@inline function voiceFlute(ph: f32): f32 {
  // nearly pure sine with a whisper of 2nd harmonic — soft + breathy toy flute
  const a: f32 = ph * TWO_PI;
  let s: f32 = Mathf.sin(a);
  s += 0.12 * Mathf.sin(2.0 * a);
  return f32(s * 0.9);
}

@inline function voiceGuitar(ph: f32): f32 {
  // plucky narrow pulse (25% duty) — the classic cheap-digital "guitar"
  const duty: f32 = 0.25;
  const sq: f32 = ph < duty ? 1.0 : -1.0;
  // tilt with a little 1st harmonic so it has body, then scale down (pulse is loud)
  const a: f32 = ph * TWO_PI;
  const s: f32 = sq * 0.6 + f32(Mathf.sin(a)) * 0.2;
  return f32(s * 0.8);
}

@inline function renderVoice(sel: i32, ph: f32): f32 {
  if (sel <= 0) return voicePiano(ph);
  if (sel == 1) return voiceFantasy(ph);
  if (sel == 2) return voiceViolin(ph);
  if (sel == 3) return voiceFlute(ph);
  return voiceGuitar(ph);
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const sel: i32 = i32(clampf(params[P_VOICE] + 0.5, 0.0, 4.0)); // round to 0..4

  const atkS: f32 = 0.001 + clampf(params[P_ATTACK], 0.0, 1.0) * 0.6;   // 1 ms .. 0.6 s
  const relS: f32 = 0.02  + clampf(params[P_RELEASE], 0.0, 1.0) * 1.8;  // 20 ms .. 1.8 s
  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // vibrato: ~6 Hz pitch wobble, up to ~+/-1.2% (a small, charming amount)
  const vibDepth: f32 = clampf(params[P_VIBRATO], 0.0, 1.0) * 0.012;
  const vibRate: f32 = 6.0;
  const lfoInc: f32 = vibRate / sr;

  // BITS lo-fi crunch: maps 0..1 to (high SR + many bits) .. (low SR + few bits)
  const bits: f32 = clampf(params[P_BITS], 0.0, 1.0);
  // sample-rate reduction: hold every `crStep` samples. 1 (clean) .. ~28 (crunchy)
  const crStep: f32 = 1.0 + bits * bits * 27.0;
  const crInc: f32 = 1.0 / crStep;
  // bit depth: 16 (clean) down to ~4 bits (crunchy)
  const bitDepth: f32 = 16.0 - bits * 12.0;
  const levels: f32 = f32(Mathf.pow(2.0, bitDepth));
  const invLevels: f32 = 1.0 / levels;

  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);
  // six thin voices summed; scale so chords stay bounded
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    // ---- global vibrato LFO (shared, cheap) -------------------------
    lfoPhase += lfoInc; if (lfoPhase >= 1.0) lfoPhase -= 1.0;
    const vib: f32 = f32(Mathf.sin(lfoPhase * TWO_PI)) * vibDepth;
    const pitchMul: f32 = 1.0 + vib;

    let mono: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- AR amplitude envelope --------------------------------
      let env: f32 = vEnv[v];
      let stg: i32 = vStage[v];
      if (stg == 1) {                 // attack
        env += atkRate;
        if (env >= 1.0) { env = 1.0; stg = 2; }
      } else if (stg == 2) {          // hold (sustain at full while gated)
        env = 1.0;
      } else if (stg == 3) {          // release
        env -= relRate;
        if (env <= 0.0) { env = 0.0; stg = 0; }
      }
      vEnv[v] = env;
      vStage[v] = stg;

      if (stg == 0 && env <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- oscillator (single-cycle timbre) ---------------------
      const inc: f32 = (vFreq[v] * pitchMul) / sr;
      let ph: f32 = vPhase[v] + inc;
      if (ph >= 1.0) ph -= 1.0;
      vPhase[v] = ph;

      const wave: f32 = renderVoice(sel, ph);
      mono += wave * env * vVel[v];
    }

    mono *= voiceScale * level;

    // ---- BITS: bit-depth quantize + sample-rate hold ----------------
    // bit reduction (always applied; at 16 bits it is transparent)
    let crunched: f32 = mono;
    crunched = f32(Mathf.floor(crunched * levels + 0.5)) * invLevels;

    // sample-rate reduction via sample-and-hold (mono source -> both ch)
    crPhase += crInc;
    if (crPhase >= 1.0) {
      crPhase -= 1.0;
      crHoldL = crunched;
      crHoldR = crunched;
    }

    let outv: f32 = crHoldL;
    // gentle safety clip so a big chord + crunch never exceeds bounds
    if (outv > 1.0) outv = 1.0;
    if (outv < -1.0) outv = -1.0;

    outBuf[f] = outv;
    outBuf[MAX_FRAMES + f] = crHoldR > 1.0 ? 1.0 : (crHoldR < -1.0 ? -1.0 : crHoldR);
  }
}
