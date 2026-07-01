// =====================================================================
//  SUB STATION — modern virtual-analog acid/electro bass mono synth
//  A two-oscillator VA bass voice with an edgy, slightly digital bite:
//    OSC1 (saw) + OSC2 (pulse) with hard OSCILLATOR SYNC (OSC2 phase
//    reset by OSC1) for the screaming, tearing sync edge, plus a SUB
//    square one octave down for weight. The mix drives a screaming 4-pole
//    resonant low-pass with a snappy decay envelope (the squelch/scream),
//    then a post OVERDRIVE waveshaper for aggressive grit. Mono, last-note
//    priority, pitch tracks the host Hz. Pure algorithm, no samples.
//
//  Signal path:
//    [saw + synced-pulse + sub] -> resonant LPF (cutoff + envAmt*env)
//                               -> overdrive shaper -> level
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32 = 3.14159265358979;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_CUTOFF:   i32 = 0; // base cutoff 0..1
const P_RESO:     i32 = 1; // resonance 0..1 (screams near 1)
const P_ENVAMT:   i32 = 2; // filter envelope amount 0..1
const P_SYNC:     i32 = 3; // osc-sync edge: OSC2 pitch ratio above OSC1 0..1
const P_OVERDRIVE: i32 = 4; // post overdrive grit 0..1
const P_DECAY:    i32 = 5; // filter + amp decay 0..1
const P_LEVEL:    i32 = 6; // output level 0..1

// ---- voice state ----
let phase1: f32 = 0.0;     // OSC1 (master saw) phase 0..1
let phase2: f32 = 0.0;     // OSC2 (synced pulse) phase 0..1
let subPhase: f32 = 0.0;   // sub oscillator phase 0..1
let curFreq: f32 = 0.0;    // current note frequency (Hz)
let gate: i32 = 0;         // 1 while a note is held
let note: i32 = -1;        // currently sounding note id

// envelopes
let fenv: f32 = 0.0;       // filter envelope (decays 1 -> 0)
let aenv: f32 = 0.0;       // amplitude envelope

// 4-pole resonant ladder filter state
let f0: f32 = 0.0;
let f1: f32 = 0.0;
let f2: f32 = 0.0;
let f3: f32 = 0.0;

// DC blocker
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  phase1 = 0.0;
  phase2 = 0.0;
  subPhase = 0.0;
  curFreq = 0.0;
  gate = 0;
  note = -1;
  fenv = 0.0;
  aenv = 0.0;
  f0 = 0.0; f1 = 0.0; f2 = 0.0; f3 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_CUTOFF]    = 0.30;
  params[P_RESO]      = 0.72;
  params[P_ENVAMT]    = 0.78;
  params[P_SYNC]      = 0.45;
  params[P_OVERDRIVE] = 0.40;
  params[P_DECAY]     = 0.35;
  params[P_LEVEL]     = 0.80;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// fast tanh-ish soft saturator: bounded, smooth, cheap
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// Host passes frequency in Hz. Last-note priority; new notes retrigger
// the envelopes. Velocity not used for accent here (kept simple/punchy).
export function noteOn(id: i32, f: f32, v: f32): void {
  curFreq = f > 0.0 ? f : 0.0001;
  note = id;
  gate = 1;
  fenv = 1.0;
  aenv = 1.0;
}

export function noteOff(id: i32): void {
  if (id == note) gate = 0;
}

export function process(n: i32): void {
  const cutoffN:    f32 = clampf(params[P_CUTOFF],   0.0, 1.0);
  const resoN:      f32 = clampf(params[P_RESO],     0.0, 1.0);
  const envAmtN:    f32 = clampf(params[P_ENVAMT],   0.0, 1.0);
  const syncN:      f32 = clampf(params[P_SYNC],     0.0, 1.0);
  const overdriveN: f32 = clampf(params[P_OVERDRIVE], 0.0, 1.0);
  const decayN:     f32 = clampf(params[P_DECAY],    0.0, 1.0);
  const level:      f32 = clampf(params[P_LEVEL],    0.0, 1.0);

  // ---- derived coefficients ----

  // Filter-envelope decay: ~25 ms (snappy) up to ~1.1 s (long sweep).
  const fdecaySec: f32 = 0.025 + decayN * decayN * 1.1;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));

  // Amp envelope: a touch longer so notes ring out.
  const adecaySec: f32 = 0.05 + decayN * decayN * 1.5;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));

  // Sync: OSC2 runs at 1.0 .. ~3.5x the master pitch; OSC1 resets its phase.
  // Higher sync = brighter, more tearing formant sweep / metallic bite.
  const syncRatio: f32 = 1.0 + syncN * 2.5;

  // Resonance 0 .. ~4.0 (screams / approaches self-oscillation, bounded).
  const reso: f32 = resoN * 4.0;

  // Base cutoff in Hz (exponential, musical): ~70 Hz .. ~10 kHz.
  const baseCut: f32 = f32(70.0 * Mathf.exp(cutoffN * 4.96));

  // Envelope sweep span added on top of base.
  const sweepSpan: f32 = envAmtN * 9000.0;

  // Overdrive: pre-gain into the shaper 1 .. ~9, with output compensation.
  const odGain: f32 = 1.0 + overdriveN * 8.0;
  const odComp: f32 = f32(1.0 / Mathf.sqrt(odGain));
  // overdrive also adds a hard-ish edge term as it increases
  const odEdge: f32 = overdriveN * overdriveN;

  const nyq: f32 = sampleRate * 0.5;

  for (let i = 0; i < n; i++) {
    // ---- amp/filter envelopes ----
    fenv *= fenvCoef;
    if (gate != 0) {
      // sustain at a floor while held
      aenv = aenv * aenvCoef;
      if (aenv < 0.3) aenv = 0.3;
    } else {
      aenv *= aenvCoef;
    }

    // ---- oscillators ----
    let inc1: f32 = curFreq / sampleRate;
    if (inc1 < 0.0) inc1 = 0.0;
    if (inc1 > 0.5) inc1 = 0.5;

    // OSC1 master saw
    let reset: i32 = 0;
    phase1 += inc1;
    if (phase1 >= 1.0) { phase1 -= 1.0; reset = 1; }
    const saw: f32 = phase1 * 2.0 - 1.0;

    // OSC2 synced pulse: runs faster, but its phase is hard-reset whenever
    // OSC1 wraps — this is the classic osc-sync tearing edge.
    let inc2: f32 = inc1 * syncRatio;
    if (inc2 > 0.5) inc2 = 0.5;
    if (reset != 0) {
      phase2 = 0.0;
    } else {
      phase2 += inc2;
      if (phase2 >= 1.0) phase2 -= 1.0;
    }
    const pulse: f32 = phase2 < 0.5 ? 1.0 : -1.0;

    // SUB square one octave down for weight
    let subInc: f32 = inc1 * 0.5;
    subPhase += subInc;
    if (subPhase >= 1.0) subPhase -= 1.0;
    const sub: f32 = subPhase < 0.5 ? 0.9 : -0.9;

    // Oscillator mix: saw body + synced pulse bite + sub weight.
    // Sync amount also raises the pulse level so the edge is clearly audible.
    const pulseLevel: f32 = 0.55 + syncN * 0.45;
    let osc: f32 = saw * 0.7 + pulse * pulseLevel + sub * 0.6;
    osc *= 0.6;

    // ---- cutoff for this sample ----
    let cutHz: f32 = baseCut + sweepSpan * fenv;
    if (cutHz < 20.0) cutHz = 20.0;
    if (cutHz > nyq * 0.49) cutHz = nyq * 0.49;

    // ---- 4-pole resonant ladder ----
    let fc: f32 = cutHz / nyq;
    if (fc > 0.49) fc = 0.49;
    const g: f32 = fc * (1.8 - 0.8 * fc);

    const fb: f32 = reso * (1.0 - 0.15 * g);
    const input: f32 = osc - fb * satf(f3);

    f0 += g * (input - f0);
    f1 += g * (f0 - f1);
    f2 += g * (f1 - f2);
    f3 += g * (f2 - f3);

    let filtered: f32 = satf(f3 * 1.3);

    // ---- amp envelope ----
    let s: f32 = filtered * aenv;

    // ---- post OVERDRIVE (aggressive grit) ----
    // soft saturation blended with a harder edge for the modern bite
    let driven: f32 = satf(s * odGain) * odComp;
    const hard: f32 = clampf(s * odGain * 0.5, -1.0, 1.0);
    driven = driven * (1.0 - 0.5 * odEdge) + hard * (0.5 * odEdge);
    s = s * (1.0 - overdriveN) + driven * overdriveN;

    // ---- DC blocker ----
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = y;
    s = y;

    // ---- final level + headroom guard ----
    s = satf(s * level * 1.25) * 0.85;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
