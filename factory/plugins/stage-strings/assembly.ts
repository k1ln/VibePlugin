// =====================================================================
//  STAGE STRINGS — a dual STRING + BRASS ensemble machine INSTRUMENT
//  (in the lineage of the 70s divide-down "string + brass" stage keyboards).
//
//  Fully POLYPHONIC: a pool of independent voices, each allocated to a
//  held note. Every voice synthesises TWO distinct, blendable timbres that
//  share the note's pitch:
//
//    • STRINGS  — a bright, fast, divide-down section. Three slightly
//      detuned sawtooths (note + an octave-up shimmer) give the buzzy,
//      airy bowed-ensemble tone. It has a FAST attack so it speaks at once.
//
//    • BRASS    — a slower, swelling section. A narrow pulse + saw blend
//      pushed through a per-voice low-pass that OPENS with its own slow
//      "brass swell" envelope, so held notes bloom from dark to bright like
//      a brass section leaning in. Its attack is deliberately slower than
//      the strings'.
//
//  The two sections are mixed by the Strings / Brass levels, shaped by a
//  shared Attack/Release amplitude contour, tilted by Tone, then run through
//  a rich triple-tap ENSEMBLE chorus (three slow LFO-modulated delay lines)
//  for the lush 70s stage-keyboard shimmer and stereo width.
//
//  Params: Strings, Brass, Attack, Release, Ensemble, Tone, Level.
//  Pure algorithm — no samples, no imports, allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;

const PI2: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let dcxL: f32 = 0.0; let dcyL: f32 = 0.0; let dcxR: f32 = 0.0; let dcyR: f32 = 0.0; // DC blocker

// ---- parameter indices (must match spec.json) -----------------------
const P_STRINGS:  i32 = 0;  // 0..1 -> string section level
const P_BRASS:    i32 = 1;  // 0..1 -> brass section level
const P_ATTACK:   i32 = 2;  // 0..1 -> amp attack time
const P_RELEASE:  i32 = 3;  // 0..1 -> amp release time
const P_ENSEMBLE: i32 = 4;  // 0..1 -> chorus depth / mix
const P_TONE:     i32 = 5;  // 0..1 -> master tone tilt (LP corner)
const P_LEVEL:    i32 = 6;  // 0..1 -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // note id or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vInc:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // base phase increment
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// strings: three detuned saw phases (+ shimmer octave phase)
const vSp0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vSp1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vSp2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vSo:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // octave shimmer

// brass: pulse phase + saw phase, plus its own swell envelope + filter state
const vBp:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse phase
const vBs:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw phase
const vBenv: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // slow brass swell 0..1
const vBlp:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // brass low-pass state

// shared amplitude envelope per voice
const vAEnv:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// small per-voice detune spread so the section never beats identically
const detA: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const detB: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

// ---- ensemble: three BBD-style modulated delay lines (stereo) -------
const DLEN: i32 = 2048;                                   // ~42 ms at 48k
const delL: StaticArray<f32> = new StaticArray<f32>(DLEN);
const delR: StaticArray<f32> = new StaticArray<f32>(DLEN);
let dWrite: i32 = 0;
let lfo1: f32 = 0.0;
let lfo2: f32 = 0.0;
let lfo3: f32 = 0.0;

// master tone tilt (stereo one-pole low-pass)
let toneZL: f32 = 0.0;
let toneZR: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  dcxL = 0.0; dcyL = 0.0; dcxR = 0.0; dcyR = 0.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vInc[v] = 0.0; vVel[v] = 0.0;
    vSp0[v] = 0.0; vSp1[v] = 0.0; vSp2[v] = 0.0; vSo[v] = 0.0;
    vBp[v] = 0.0; vBs[v] = 0.0; vBenv[v] = 0.0; vBlp[v] = 0.0;
    vAEnv[v] = 0.0;
    // symmetric detune spreads (a few cents) so dense chords shimmer
    const c: f32 = (f32(v) - 3.5) * 0.0011;
    detA[v] = 1.0 + c;
    detB[v] = 1.0 - c * 0.6;
  }
  ageCounter = 0;
  for (let i = 0; i < DLEN; i++) { delL[i] = 0.0; delR[i] = 0.0; }
  dWrite = 0;
  lfo1 = 0.0; lfo2 = 2.1; lfo3 = 4.2;
  toneZL = 0.0; toneZR = 0.0;

  params[P_STRINGS]  = 0.75;
  params[P_BRASS]    = 0.5;
  params[P_ATTACK]   = 0.28;
  params[P_RELEASE]  = 0.4;
  params[P_ENSEMBLE] = 0.7;
  params[P_TONE]     = 0.55;
  params[P_LEVEL]    = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

@inline function saw(p: f32): f32 { return p * 2.0 - 1.0; }

// ---- voice allocation -----------------------------------------------
export function noteOn(id: i32, f: f32, v: f32): void {
  // retrigger a voice already holding this id
  let slot: i32 = -1;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vNote[i] == id) { slot = i; break; }
  }
  // else prefer a free voice
  if (slot < 0) {
    for (let i = 0; i < NUM_VOICES; i++) {
      if (vActive[i] == 0) { slot = i; break; }
    }
  }
  // else steal the oldest
  if (slot < 0) {
    let oldest: i32 = 0;
    let oldestAge: i32 = vAge[0];
    for (let i = 1; i < NUM_VOICES; i++) {
      if (vAge[i] < oldestAge) { oldestAge = vAge[i]; oldest = i; }
    }
    slot = oldest;
  }

  vNote[slot]   = id;
  vInc[slot]    = (f > 0.0 ? f : 1.0) / sampleRate;
  vVel[slot]    = clampf(v, 0.0, 1.0);
  vActive[slot] = 1;
  vGate[slot]   = 1;
  // fresh brass swell + filter so the bloom starts dark each note
  vBenv[slot]   = 0.0;
  vBlp[slot]    = 0.0;
  // stagger string phases so the section sounds wide immediately
  vSp0[slot] = 0.0; vSp1[slot] = 0.33; vSp2[slot] = 0.66; vSo[slot] = 0.5;
  vBp[slot] = 0.0;  vBs[slot] = 0.0;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;   // env enters release; voice retires when it decays
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  const strLvl: f32 = clampf(params[P_STRINGS],  0.0, 1.0);
  const brsLvl: f32 = clampf(params[P_BRASS],    0.0, 1.0);
  const aN: f32     = clampf(params[P_ATTACK],   0.0, 1.0);
  const rN: f32     = clampf(params[P_RELEASE],  0.0, 1.0);
  const ens: f32    = clampf(params[P_ENSEMBLE], 0.0, 1.0);
  const toneN: f32  = clampf(params[P_TONE],     0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL],    0.0, 1.0);

  // amplitude attack/release as per-sample one-pole coefficients
  const atkT: f32 = 0.004 + aN * aN * 1.8;            // 4 ms .. ~1.8 s
  const relT: f32 = 0.03 + rN * rN * 3.5;             // 30 ms .. ~3.5 s
  const atkC: f32 = 1.0 - f32(Mathf.exp(-1.0 / (atkT * sr)));
  const relC: f32 = 1.0 - f32(Mathf.exp(-1.0 / (relT * sr)));

  // brass swells SLOWER than the strings — its own envelope rate, scaled so a
  // longer Attack also lengthens the bloom. This is what separates the two
  // sections in time as well as timbre.
  const brsT: f32 = 0.12 + aN * aN * 2.2;             // always slower than strings
  const brsC: f32 = 1.0 - f32(Mathf.exp(-1.0 / (brsT * sr)));

  // master tone tilt: one-pole LP corner ~600 .. ~9500 Hz
  const toneHz: f32 = 600.0 + toneN * toneN * 8900.0;
  const toneC: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * toneHz / sr)), 0.0, 1.0);

  // ensemble: three slow LFOs at staggered rates; depth scales the sweep
  const lfoR1: f32 = 0.62 / sr * PI2;
  const lfoR2: f32 = 0.85 / sr * PI2;
  const lfoR3: f32 = 1.14 / sr * PI2;
  const baseDelay: f32 = 0.006 * sr;                  // ~6 ms centre tap
  const modDepth: f32 = (0.0014 + ens * 0.0034) * sr; // up to ~5 ms sweep
  const wet: f32 = 0.55 * ens;

  // headroom for up to 8 voices summed
  const voiceGain: f32 = 0.16;

  for (let f = 0; f < n; f++) {
    let busL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude AR envelope ------------------------------------
      let aenv: f32 = vAEnv[v];
      if (vGate[v] == 1) {
        aenv = aenv + atkC * (1.0 - aenv);
      } else {
        aenv = aenv + relC * (0.0 - aenv);
        if (aenv < 0.0002) {                          // fully released -> retire
          vActive[v] = 0; vGate[v] = 0; vNote[v] = -1; vAEnv[v] = 0.0;
          continue;
        }
      }
      vAEnv[v] = aenv;

      // ---- brass swell envelope (slow, only rises while held) -------
      let benv: f32 = vBenv[v];
      const bTarget: f32 = vGate[v] == 1 ? 1.0 : 0.0;
      benv = benv + brsC * (bTarget - benv);
      vBenv[v] = benv;

      const inc: f32 = vInc[v];

      // ---- STRINGS: three detuned saws + an octave-up shimmer -------
      let s0: f32 = vSp0[v] + inc * detA[v];        if (s0 >= 1.0) s0 -= 1.0; vSp0[v] = s0;
      let s1: f32 = vSp1[v] + inc * (2.0 - detA[v]); if (s1 >= 1.0) s1 -= 1.0; vSp1[v] = s1;
      let s2: f32 = vSp2[v] + inc;                   if (s2 >= 1.0) s2 -= 1.0; vSp2[v] = s2;
      let so: f32 = vSo[v]  + inc * 2.0;             if (so >= 1.0) so -= 1.0; vSo[v]  = so;
      let strings: f32 = (saw(s0) + saw(s1) + saw(s2)) * 0.33 + saw(so) * 0.22;
      strings *= 0.85;

      // ---- BRASS: pulse + saw through a per-voice LP that OPENS ------
      let bp: f32 = vBp[v] + inc * detB[v]; if (bp >= 1.0) bp -= 1.0; vBp[v] = bp;
      let bs: f32 = vBs[v] + inc;           if (bs >= 1.0) bs -= 1.0; vBs[v] = bs;
      const pulse: f32 = bp < 0.32 ? 1.0 : -1.0;     // narrow pulse = reedy buzz
      let braw: f32 = pulse * 0.55 + saw(bs) * 0.6;
      // brass filter corner sweeps up with its swell envelope (dark -> bright)
      const bCut: f32 = 0.04 + 0.5 * benv;           // one-pole coeff 0.04..0.54
      let blp: f32 = vBlp[v];
      blp = blp + bCut * (braw - blp);
      vBlp[v] = blp;
      const brass: f32 = blp * (0.35 + 0.65 * benv); // also grows in level as it blooms

      // ---- mix the two sections by their levels, apply amp env ------
      const voice: f32 = (strings * strLvl + brass * brsLvl) * aenv * vVel[v];
      busL += voice;
    }

    // soft-limit the summed bus so dense chords stay bounded
    let mono: f32 = busL * voiceGain;
    mono = mono / (1.0 + f32(Mathf.abs(mono)));       // |x| < 1

    // master tone tilt
    toneZL = toneZL + toneC * (mono - toneZL);
    const dry: f32 = toneZL;

    // ---- ensemble chorus: three modulated taps, stereo spread ------
    lfo1 += lfoR1; if (lfo1 >= PI2) lfo1 -= PI2;
    lfo2 += lfoR2; if (lfo2 >= PI2) lfo2 -= PI2;
    lfo3 += lfoR3; if (lfo3 >= PI2) lfo3 -= PI2;

    delL[dWrite] = dry;
    delR[dWrite] = dry;

    const d1: f32 = baseDelay + modDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo1)));
    const d2: f32 = baseDelay + modDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo2)));
    const d3: f32 = baseDelay + modDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo3)));

    const tapL: f32 = readDelay(delL, d1) + readDelay(delL, d3);
    const tapR: f32 = readDelay(delR, d2) + readDelay(delR, d3);

    dWrite++; if (dWrite >= DLEN) dWrite = 0;

    let outL: f32 = dry * (1.0 - 0.4 * wet) + tapL * wet * 0.5;
    let outR: f32 = dry * (1.0 - 0.4 * wet) + tapR * wet * 0.5;

    outL *= level;
    outR *= level;
    // DC blocker (stereo) — driving into tanh amplified a small offset
    const dl: f32 = outL - dcxL + 0.9985 * dcyL; dcxL = outL; dcyL = dl; outL = dl;
    const dr: f32 = outR - dcxR + 0.9985 * dcyR; dcxR = outR; dcyR = dr; outR = dr;
    outBuf[f] = f32(Mathf.tanh(outL * 4.2));
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh(outR * 4.2));
  }
}

// fractional delay read with linear interpolation, relative to dWrite
@inline function readDelay(line: StaticArray<f32>, delaySamples: f32): f32 {
  let d: f32 = delaySamples;
  if (!(d > 1.0)) d = 1.0;                            // catches NaN and < 1
  if (d > f32(DLEN - 2)) d = f32(DLEN - 2);
  let rp: f32 = f32(dWrite) - d;
  if (rp < 0.0) rp += f32(DLEN);
  if (!(rp >= 0.0)) rp = 0.0;                         // NaN guard
  let i0: i32 = i32(rp);
  if (i0 < 0) i0 = 0;
  if (i0 >= DLEN) i0 = DLEN - 1;
  let i1: i32 = i0 + 1; if (i1 >= DLEN) i1 = 0;
  const frac: f32 = rp - f32(i0);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}
