// =====================================================================
//  SOLO ONE — aggressive monophonic lead/bass synth (Pro-One lineage)
//  Two oscillators (saw + pulse) with OSC-2 detune feed a snappy hard-edged
//  resonant 4-pole low-pass driven by a FAST punchy filter envelope. A little
//  oscillator cross-mod / hard-sync grit gives the biting lead character. Mono
//  with last-note priority; pitch tracks; everything bounded. Pure algorithm.
//
//  Signal path per note:
//    osc1 saw (master) + osc2 pulse (detuned, hard-synced to osc1)
//      -> cross-mod grit -> drive shaper -> 4-pole resonant LPF
//      cutoff = base + envAmount * fastFilterEnv -> amp env -> level
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_CUTOFF: i32 = 0; // base cutoff 0..1
const P_RESO:   i32 = 1; // resonance 0..1
const P_ENVAMT: i32 = 2; // filter envelope amount 0..1
const P_DECAY:  i32 = 3; // filter + amp decay 0..1
const P_DETUNE: i32 = 4; // osc-2 detune 0..1
const P_DRIVE:  i32 = 5; // pre-filter drive / grit 0..1
const P_LEVEL:  i32 = 6; // output level 0..1

// ---- voice state ----
let phase1: f32 = 0.0;     // osc1 (master saw) phase 0..1
let phase2: f32 = 0.0;     // osc2 (pulse) phase 0..1
let freq:   f32 = 0.0;     // note frequency in Hz
let gate:   i32 = 0;       // 1 while a note is held
let note:   i32 = -1;      // currently sounding note id
let vel:    f32 = 0.0;     // 0..1 velocity of current note

// envelopes
let fenv: f32 = 0.0;       // fast filter envelope (decays 1 -> 0)
let aenv: f32 = 0.0;       // amplitude envelope

// 4-pole (Moog-style) ladder filter state
let f0: f32 = 0.0;
let f1: f32 = 0.0;
let f2: f32 = 0.0;
let f3: f32 = 0.0;

// DC blocker on the output
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  phase1 = 0.0;
  phase2 = 0.0;
  freq = 0.0;
  gate = 0;
  note = -1;
  vel = 0.0;
  fenv = 0.0;
  aenv = 0.0;
  f0 = 0.0; f1 = 0.0; f2 = 0.0; f3 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_CUTOFF] = 0.35;
  params[P_RESO]   = 0.7;
  params[P_ENVAMT] = 0.8;
  params[P_DECAY]  = 0.3;
  params[P_DETUNE] = 0.25;
  params[P_DRIVE]  = 0.4;
  params[P_LEVEL]  = 0.8;
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

// Host passes frequency in Hz. Last-note priority; new notes retrigger the
// envelopes (snappy, like a Pro-One). Velocity tracked per note.
export function noteOn(id: i32, f: f32, v: f32): void {
  freq = f > 0.0 ? f : 0.0001;
  note = id;
  gate = 1;
  vel = clampf(v, 0.0, 1.0);
  // hard retrigger -> snappy attack
  fenv = 1.0;
  aenv = 1.0;
  // reset osc2 phase relative to osc1 for a consistent biting transient
  phase2 = phase1;
}

export function noteOff(id: i32): void {
  if (id == note) gate = 0;
}

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN:   f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envAmtN: f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const decayN:  f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const detuneN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const driveN:  f32 = clampf(params[P_DRIVE],  0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // ---- derived coefficients ----

  // Filter-envelope decay: FAST & punchy — ~8 ms (very snappy) to ~700 ms.
  const fdecaySec: f32 = 0.008 + decayN * decayN * 0.69;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));

  // Amp envelope: a touch longer than the filter so notes have body.
  const adecaySec: f32 = 0.04 + decayN * decayN * 1.4;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));

  // Resonance 0..~4.0 — hard-edged, approaches self-oscillation but bounded.
  const reso: f32 = resoN * 4.0;

  // Base cutoff in Hz (exponential, musical): ~60 Hz .. ~11 kHz.
  const baseCut: f32 = f32(60.0 * Mathf.exp(cutoffN * 5.2));

  // Filter envelope sweep span in Hz on top of base.
  const sweepSpan: f32 = envAmtN * 10000.0;

  // Detune: OSC-2 up to ~+0.6 semitone-ish ratio swing for a fat, beating bite.
  // Ratio centered at 1.0 going up to ~1.012 (about a fifth of a semitone) plus
  // a small fine-detune for movement. Kept subtle but clearly audible.
  const detuneRatio: f32 = 1.0 + detuneN * 0.04;

  // Drive into the filter and grit amount.
  const drive: f32 = 1.0 + driveN * 4.0;
  const crossMod: f32 = driveN * 0.5; // osc cross-mod grit amount

  const nyq: f32 = sampleRate * 0.5;

  for (let i = 0; i < n; i++) {
    // ---- oscillators ----
    let inc1: f32 = freq / sampleRate;
    if (inc1 < 0.0) inc1 = 0.0;
    if (inc1 > 0.5) inc1 = 0.5;
    let inc2: f32 = (freq * detuneRatio) / sampleRate;
    if (inc2 < 0.0) inc2 = 0.0;
    if (inc2 > 0.5) inc2 = 0.5;

    // osc1 master saw
    phase1 += inc1;
    let synced: i32 = 0;
    if (phase1 >= 1.0) { phase1 -= 1.0; synced = 1; }
    const saw1: f32 = phase1 * 2.0 - 1.0;

    // osc2 pulse, hard-synced to osc1 (the bite of a Pro-One)
    phase2 += inc2;
    if (phase2 >= 1.0) phase2 -= 1.0;
    if (synced != 0) phase2 = phase1; // hard sync reset on master wrap
    const pulse2: f32 = phase2 < 0.5 ? 1.0 : -1.0;

    // cross-mod grit: osc1 modulates osc2's effective level a touch
    const osc2: f32 = pulse2 * (1.0 + crossMod * saw1);

    // mix: saw + pulse (osc2 sits a touch lower so the lead stays focused)
    let osc: f32 = saw1 + osc2 * 0.85;
    osc *= 0.55; // headroom before drive

    // pre-filter drive / grit
    osc = satf(osc * drive);

    // ---- envelopes ----
    fenv *= fenvCoef;
    if (gate != 0) {
      // amp decays toward a sustain floor while held
      aenv = aenvCoef * aenv;
      if (aenv < 0.3) aenv = 0.3;
    } else {
      aenv *= aenvCoef;
    }

    // ---- cutoff for this sample (velocity opens it a touch more) ----
    let cutHz: f32 = baseCut + sweepSpan * fenv * (0.6 + 0.4 * vel);
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

    let filtered: f32 = f3;
    filtered = satf(filtered * 1.4);

    // ---- amp + level ----
    let s: f32 = filtered * aenv * (0.5 + 0.5 * vel);

    // DC blocker
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = y;
    s = y;

    // final level + headroom guard (peak stays under ~1.0)
    s = satf(s * level * 1.25) * 0.8;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
