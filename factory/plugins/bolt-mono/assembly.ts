// =====================================================================
//  BOLT MONO — a lean, punchy two-oscillator hard-sync mono synth.
//  Lineage: the compact American two-VCO mono lead/bass (Moog Prodigy
//  family) — tight, snappy and immediate rather than a fat triple-osc
//  beast. OSC-1 (saw) is the master; OSC-2 (pulse) detunes and HARD-SYNCS
//  to OSC-1 so its phase resets on every master cycle, giving the zappy,
//  metallic sync edge. Both oscillators feed a punchy Moog-style 4-pole
//  resonant ladder low-pass driven by a fast decay envelope (Env Amount),
//  with glide and an amp envelope. Pure algorithm, no samples.
//
//  Signal path:
//    OSC1 saw (master) + OSC2 pulse (synced, detuned) -> mix/drive
//      -> 4-pole resonant ladder LPF (cutoff = base + EnvAmount*fenv)
//      -> amp env -> soft clip -> Level
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
const P_CUTOFF:  i32 = 0; // base cutoff 0..1
const P_RESO:    i32 = 1; // resonance 0..1
const P_ENVAMT:  i32 = 2; // filter envelope amount 0..1
const P_SYNC:    i32 = 3; // hard-sync edge / OSC2 pitch ratio 0..1
const P_DETUNE:  i32 = 4; // OSC2 fine detune 0..1
const P_DECAY:   i32 = 5; // filter + amp decay 0..1
const P_LEVEL:   i32 = 6; // output level 0..1

// ---- voice state ----
let ph1: f32 = 0.0;        // OSC1 (master, saw) phase 0..1
let ph2: f32 = 0.0;        // OSC2 (slave, pulse) phase 0..1
let targetFreq: f32 = 0.0; // requested note pitch in Hz
let curFreq: f32 = 0.0;    // current (glided) pitch
let gate: i32 = 0;         // 1 while held
let note: i32 = -1;        // sounding note id

// envelopes
let fenv: f32 = 0.0;       // filter envelope (decays 1 -> 0)
let aenv: f32 = 0.0;       // amplitude envelope

// 4-pole (Moog-style) ladder state
let f0: f32 = 0.0;
let f1: f32 = 0.0;
let f2: f32 = 0.0;
let f3: f32 = 0.0;

// DC blocker
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  ph1 = 0.0; ph2 = 0.0;
  targetFreq = 0.0; curFreq = 0.0;
  gate = 0; note = -1;
  fenv = 0.0; aenv = 0.0;
  f0 = 0.0; f1 = 0.0; f2 = 0.0; f3 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_CUTOFF] = 0.45;
  params[P_RESO]   = 0.55;
  params[P_ENVAMT] = 0.6;
  params[P_SYNC]   = 0.4;
  params[P_DETUNE] = 0.25;
  params[P_DECAY]  = 0.4;
  params[P_LEVEL]  = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// fast bounded tanh-ish saturator
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// Host passes Hz. Last-note priority; each note re-triggers the envelopes
// and re-aligns the slave oscillator for a consistent sync transient.
export function noteOn(id: i32, f: f32, v: f32): void {
  const newFreq: f32 = f > 0.0 ? f : 0.0001;
  if (gate == 0 && curFreq <= 0.0) {
    curFreq = newFreq; // snap on first note
  }
  targetFreq = newFreq;
  note = id;
  gate = 1;
  // reset oscillators so the sync transient is identical every attack
  ph1 = 0.0;
  ph2 = 0.0;
  // (re)trigger envelopes scaled by velocity for a punchy attack
  const vv: f32 = clampf(v, 0.0, 1.0);
  fenv = 0.6 + 0.4 * vv;
  aenv = 1.0;
}

export function noteOff(id: i32): void {
  if (id == note) gate = 0;
}

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN:   f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envAmtN: f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const syncN:   f32 = clampf(params[P_SYNC],   0.0, 1.0);
  const detuneN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const decayN:  f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // ---- derived coefficients ----

  // Filter envelope: ~25 ms (snappy) up to ~1.4 s (long sweep).
  const fdecaySec: f32 = 0.025 + decayN * decayN * 1.4;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));

  // Amp envelope: a little longer so notes ring out musically.
  const adecaySec: f32 = 0.05 + decayN * decayN * 1.8;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));

  // Snappy fixed glide (lean synth — quick portamento ~12 ms).
  const glideCoef: f32 = f32(Mathf.exp(-1.0 / (0.012 * sampleRate)));

  // Resonance 0..~3.9 (approaches self-oscillation, bounded by satf).
  const reso: f32 = resoN * 3.9;

  // Base cutoff in Hz (exponential, musical): ~70 Hz .. ~10 kHz.
  const baseCut: f32 = f32(70.0 * Mathf.exp(cutoffN * 4.96));

  // Envelope sweep span in Hz on top of base.
  const sweepSpan: f32 = envAmtN * 9000.0;

  const nyq: f32 = sampleRate * 0.5;

  // SYNC: OSC2 runs at a higher pitch ratio that increases with Sync, so the
  // forced phase reset (sync) carves a brighter, more aggressive sweep into the
  // slave waveform. ratio 1.0 .. ~3.5.
  const syncRatio: f32 = 1.0 + syncN * 2.5;
  // how much of the synced OSC2 is blended in (always audible, grows with sync)
  const osc2Mix: f32 = 0.35 + 0.45 * syncN;

  // DETUNE: OSC2 fine offset, +/- ~30 cents -> small multiplier around the ratio.
  const detSemis: f32 = (detuneN - 0.5) * 0.6;     // +/-0.3 semitone-ish
  const detMul: f32 = f32(Mathf.exp(detSemis * 0.0577623)); // 2^(s/12)

  // pulse width for OSC2 (fixed-ish narrow pulse for the zappy character)
  const pw: f32 = 0.35;

  for (let i = 0; i < n; i++) {
    // ---- glide pitch toward target ----
    curFreq = targetFreq + (curFreq - targetFreq) * glideCoef;

    let inc1: f32 = curFreq / sampleRate;
    if (inc1 < 0.0) inc1 = 0.0;
    if (inc1 > 0.5) inc1 = 0.5;

    // OSC2 increment = master * sync ratio * detune
    let inc2: f32 = inc1 * syncRatio * detMul;
    if (inc2 > 0.5) inc2 = 0.5;

    // ---- OSC1 master (saw) advance; detect cycle wrap for hard sync ----
    ph1 += inc1;
    let synced: bool = false;
    if (ph1 >= 1.0) { ph1 -= 1.0; synced = true; }

    const saw: f32 = ph1 * 2.0 - 1.0;

    // ---- OSC2 slave (pulse) ----
    ph2 += inc2;
    if (ph2 >= 1.0) ph2 -= 1.0;
    // HARD SYNC: master cycle forces the slave phase to reset -> sync edge
    if (synced) ph2 = 0.0;
    const pulse: f32 = ph2 < pw ? 1.0 : -1.0;

    // ---- mix oscillators ----
    let osc: f32 = saw + pulse * osc2Mix;
    osc *= 0.65; // headroom before the filter

    // ---- envelopes ----
    fenv *= fenvCoef;
    if (gate != 0) {
      // hold near full while gated, then release on noteOff
      aenv = aenv + (1.0 - aenv) * 0.002;
      if (aenv > 1.0) aenv = 1.0;
    } else {
      aenv *= aenvCoef;
    }

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

    let filtered: f32 = satf(f3 * 1.4);

    // ---- amp + level ----
    let s: f32 = filtered * aenv;

    // DC blocker
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = y;
    s = y;

    // final level + headroom guard (peak stays < ~1.0)
    s = satf(s * level * 1.25) * 0.8;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
