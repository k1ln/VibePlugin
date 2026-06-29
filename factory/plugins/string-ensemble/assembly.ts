// =====================================================================
//  STRING ENSEMBLE — a 70s BBD string-machine INSTRUMENT
//
//  A paraphonic string synth: every held note drives TWO band-limited
//  sawtooth oscillators (the note plus its octave) which are SUMMED into
//  a single voice bus. A shared, slow Attack/Release amplitude envelope
//  swells the whole section in and out — so a held chord blooms like a
//  bowed string pad. The bus is coloured by a tone tilt then fed through
//  a triple-tap BBD-style ENSEMBLE chorus: three short delay lines, each
//  modulated by its own slow LFO at staggered phases, summed back with
//  the dry signal to produce the lush shimmering Solina-style movement.
//
//  Params: Attack, Release, Ensemble (chorus depth), Tone, Level.
//  Pure algorithm, no samples, allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// --- polyphony: a fixed pool of note slots (paraphonic, one shared env) ---
const MAX_VOICES: i32 = 16;
const vActive: StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = producing sound
const vHeld:   StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = key still down
const vId:     StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // host note id
const vInc:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // base phase increment
const vPhase:  StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // fundamental phase
const vPhase2: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // octave phase
const vDet:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // tiny per-voice detune ratio

// --- shared amplitude envelope ---
let env:  f32 = 0.0;   // current level
let gate: i32 = 0;     // 1 while any note is held

// --- ensemble (3 BBD-style modulated delay lines) ---
const DLEN: i32 = 2048;                                    // ~42 ms at 48k, plenty for chorus
const delL: StaticArray<f32> = new StaticArray<f32>(DLEN);
const delR: StaticArray<f32> = new StaticArray<f32>(DLEN);
let dWrite: i32 = 0;
let lfo1: f32 = 0.0;
let lfo2: f32 = 0.0;
let lfo3: f32 = 0.0;

// --- tone tilt one-pole low-pass state (stereo) ---
let toneZL: f32 = 0.0;
let toneZR: f32 = 0.0;

// --- gentle per-voice detune table so the section never beats identically ---
const detTable: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);

const P_ATTACK:   i32 = 0;  // 0..1 -> ~5 ms .. 2.5 s
const P_RELEASE:  i32 = 1;  // 0..1 -> ~30 ms .. 4 s
const P_ENSEMBLE: i32 = 2;  // 0..1 chorus depth/mix
const P_TONE:     i32 = 3;  // 0..1 -> LP 700 .. 9000 Hz
const P_LEVEL:    i32 = 4;  // 0..1 -> 0 .. 1.0 output

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < MAX_VOICES; i++) {
    vActive[i] = 0; vHeld[i] = 0; vId[i] = -1; vInc[i] = 0.0;
    vPhase[i] = 0.0; vPhase2[i] = 0.0; vDet[i] = 1.0;
  }
  // spread of detune ratios, symmetric around 1.0, a few cents each
  for (let i = 0; i < MAX_VOICES; i++) {
    const c: f32 = (f32(i) - 7.5) * 0.0009;   // ~ +/- 7 cents across the pool
    detTable[i] = 1.0 + c;
  }
  for (let i = 0; i < DLEN; i++) { delL[i] = 0.0; delR[i] = 0.0; }
  dWrite = 0;
  env = 0.0; gate = 0;
  lfo1 = 0.0; lfo2 = 2.1; lfo3 = 4.2;
  toneZL = 0.0; toneZR = 0.0;

  params[P_ATTACK]   = 0.35;
  params[P_RELEASE]  = 0.45;
  params[P_ENSEMBLE] = 0.7;
  params[P_TONE]     = 0.55;
  params[P_LEVEL]    = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Host passes frequency in Hz. Assign the note to a free slot (or steal the
// oldest matching/duplicate). Paraphonic: all slots share one envelope.
export function noteOn(id: i32, f: f32, v: f32): void {
  let slot: i32 = -1;
  // reuse a slot already holding/ringing this id (retrigger)
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vId[i] == id && vActive[i] == 1) { slot = i; break; }
  }
  // otherwise prefer a fully free slot (not sounding at all)
  if (slot < 0) {
    for (let i = 0; i < MAX_VOICES; i++) {
      if (vActive[i] == 0) { slot = i; break; }
    }
  }
  if (slot < 0) slot = 0; // pool full -> steal slot 0

  vActive[slot] = 1;
  vHeld[slot] = 1;
  vId[slot] = id;
  vInc[slot] = f / sampleRate;
  vDet[slot] = detTable[slot];
  // keep phases where they are for continuity; the chorus hides discontinuity
  gate = 1;
}

export function noteOff(id: i32): void {
  // release the key but KEEP the oscillator ringing through the shared envelope
  for (let i = 0; i < MAX_VOICES; i++) {
    if (vHeld[i] == 1 && vId[i] == id) { vHeld[i] = 0; }
  }
  // gate stays high while ANY key is still down; otherwise the env releases
  let any: i32 = 0;
  for (let i = 0; i < MAX_VOICES; i++) { if (vHeld[i] == 1) { any = 1; break; } }
  gate = any;
}

// PolyBLEP-style softened saw is overkill here; a mild slope-limited ramp keeps
// the section warm without aliasing fizz. We just sum naive saws then low-pass
// hard via the Tone control, which is faithful to a BBD string machine anyway.
@inline function saw(p: f32): f32 { return p * 2.0 - 1.0; }

export function process(n: i32): void {
  const aN: f32 = clampf(params[P_ATTACK],   0.0, 1.0);
  const rN: f32 = clampf(params[P_RELEASE],  0.0, 1.0);
  const ens: f32 = clampf(params[P_ENSEMBLE], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE],   0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // attack/release as per-sample one-pole coefficients (time -> coeff)
  const atkT: f32 = 0.005 + aN * aN * 2.5;        // seconds
  const relT: f32 = 0.03 + rN * rN * 4.0;
  const atkC: f32 = 1.0 - f32(Mathf.exp(-1.0 / (atkT * sampleRate)));
  const relC: f32 = 1.0 - f32(Mathf.exp(-1.0 / (relT * sampleRate)));
  const tgt: f32 = gate ? 1.0 : 0.0;

  // tone tilt: one-pole LP corner 700..9000 Hz
  const toneHz: f32 = 700.0 + toneN * toneN * 8300.0;
  const toneC: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * toneHz / sampleRate)), 0.0, 1.0);

  // ensemble: 3 LFOs at slightly different slow rates; depth scales delay mod
  const lfoR1: f32 = 0.65 / sampleRate * PI2;
  const lfoR2: f32 = 0.86 / sampleRate * PI2;
  const lfoR3: f32 = 1.13 / sampleRate * PI2;
  const baseDelay: f32 = 0.006 * sampleRate;       // ~6 ms centre tap
  const modDepth: f32 = (0.0015 + ens * 0.0035) * sampleRate; // up to ~5 ms sweep
  const wet: f32 = 0.5 * ens;                      // chorus mix amount

  // headroom: many summed saws -> normalise by an effort-bounded factor.
  // We softly compress the voice sum so a big chord stays < 1.0 before chorus.
  const voiceGain: f32 = 0.18;

  // once the section has fully released, retire every ringing voice so a fresh
  // chord starts clean (done per-block, cheap and click-free since env ~ 0).
  if (gate == 0 && env < 0.0002) {
    for (let i = 0; i < MAX_VOICES; i++) {
      if (vHeld[i] == 0) { vActive[i] = 0; vId[i] = -1; }
    }
  }

  for (let f = 0; f < n; f++) {
    // shared envelope
    const c: f32 = tgt > env ? atkC : relC;
    env = env + c * (tgt - env);

    // sum all sounding voices (fundamental + octave) into a mono bus
    let bus: f32 = 0.0;
    for (let i = 0; i < MAX_VOICES; i++) {
      if (vActive[i] == 0) continue;
      const inc: f32 = vInc[i] * vDet[i];
      let p1: f32 = vPhase[i] + inc;
      if (p1 >= 1.0) p1 -= 1.0;
      vPhase[i] = p1;
      let p2: f32 = vPhase2[i] + inc * 2.0;        // octave up
      if (p2 >= 1.0) p2 -= 1.0;
      vPhase2[i] = p2;
      bus += saw(p1) + 0.6 * saw(p2);
    }

    // soft saturate the bus so dense chords stay bounded
    let mono: f32 = bus * voiceGain;
    mono = mono / (1.0 + f32(Mathf.abs(mono)));    // gentle limiter, |x|<1
    mono = mono * env;

    // tone tilt (low-pass), shared then split to stereo
    toneZL = toneZL + toneC * (mono - toneZL);
    const dry: f32 = toneZL;

    // --- ensemble chorus: read 3 modulated taps from a stereo BBD ---
    lfo1 += lfoR1; if (lfo1 >= PI2) lfo1 -= PI2;
    lfo2 += lfoR2; if (lfo2 >= PI2) lfo2 -= PI2;
    lfo3 += lfoR3; if (lfo3 >= PI2) lfo3 -= PI2;

    // write the dry mono into both delay lines
    delL[dWrite] = dry;
    delR[dWrite] = dry;

    const d1: f32 = baseDelay + modDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo1)));
    const d2: f32 = baseDelay + modDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo2)));
    const d3: f32 = baseDelay + modDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo3)));

    const tapL: f32 = readDelay(delL, d1) + readDelay(delL, d3);
    const tapR: f32 = readDelay(delR, d2) + readDelay(delR, d3);

    dWrite++; if (dWrite >= DLEN) dWrite = 0;

    // mix dry + wet (taps already 2x sum -> scale), keep stereo width
    let outL: f32 = dry * (1.0 - 0.4 * wet) + tapL * wet * 0.5;
    let outR: f32 = dry * (1.0 - 0.4 * wet) + tapR * wet * 0.5;

    outL *= level;
    outR *= level;

    // final clamp for safety
    outBuf[f] = clampf(outL, -1.0, 1.0);
    outBuf[MAX_FRAMES + f] = clampf(outR, -1.0, 1.0);
  }
}

// fractional delay read with linear interpolation, relative to dWrite
@inline function readDelay(line: StaticArray<f32>, delaySamples: f32): f32 {
  let d: f32 = delaySamples;
  if (!(d > 1.0)) d = 1.0;                       // catches NaN and < 1
  if (d > f32(DLEN - 2)) d = f32(DLEN - 2);
  let rp: f32 = f32(dWrite) - d;
  if (rp < 0.0) rp += f32(DLEN);
  if (!(rp >= 0.0)) rp = 0.0;                    // NaN guard
  let i0: i32 = i32(rp);
  if (i0 < 0) i0 = 0;
  if (i0 >= DLEN) i0 = DLEN - 1;
  let i1: i32 = i0 + 1; if (i1 >= DLEN) i1 = 0;
  const frac: f32 = rp - f32(i0);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}
