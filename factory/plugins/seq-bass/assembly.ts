// =====================================================================
//  SEQ BASS — monophonic squelchy acid sequencer-bass synth
//  A sequencer-synth-sibling voice (MC-202 lineage): a single VCO mixing
//  a saw+square core with a square SUB an octave down, feeding the famous
//  squelchy resonant 4-pole low-pass driven by a snappy decay envelope.
//  ACCENT emphasises the filter sweep AND the level for the punchy acid
//  hits; GLIDE slides the pitch between notes for sliding acid lines.
//  Fuller and rounder than a bare 303 thanks to the sub oscillator.
//  Pure algorithm, no samples, monophonic, last-note priority.
//
//  Signal path per note:
//    (saw + square + sub) -> drive -> 4-pole resonant LPF
//    cutoff = base + (envAmt * (1 + accent)) * filterEnv  -> amp env -> level
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
const P_RESO:   i32 = 1; // resonance 0..1 (squelch)
const P_ENVAMT: i32 = 2; // filter envelope amount 0..1
const P_ACCENT: i32 = 3; // accent emphasis 0..1
const P_GLIDE:  i32 = 4; // glide / portamento 0..1
const P_DECAY:  i32 = 5; // envelope decay 0..1
const P_LEVEL:  i32 = 6; // output level 0..1

// ---- voice state ----
let phase:    f32 = 0.0;  // main oscillator phase 0..1
let subPhase: f32 = 0.0;  // sub oscillator phase 0..1 (half speed)
let targetFreq: f32 = 0.0;
let curFreq:  f32 = 0.0;
let gate:     i32 = 0;
let note:     i32 = -1;
let accentAmt: f32 = 0.0; // 0..1 per-note accent (from velocity)

// envelopes
let fenv: f32 = 0.0;      // filter envelope (snaps to 1, decays toward 0)
let aenv: f32 = 0.0;      // amplitude envelope

// 4-pole ladder filter state
let f0: f32 = 0.0;
let f1: f32 = 0.0;
let f2: f32 = 0.0;
let f3: f32 = 0.0;

// DC blocker
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  phase = 0.0;
  subPhase = 0.0;
  targetFreq = 0.0;
  curFreq = 0.0;
  gate = 0;
  note = -1;
  accentAmt = 0.0;
  fenv = 0.0;
  aenv = 0.0;
  f0 = 0.0; f1 = 0.0; f2 = 0.0; f3 = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_CUTOFF] = 0.38;
  params[P_RESO]   = 0.80;
  params[P_ENVAMT] = 0.72;
  params[P_ACCENT] = 0.55;
  params[P_GLIDE]  = 0.30;
  params[P_DECAY]  = 0.42;
  params[P_LEVEL]  = 0.80;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// fast bounded tanh-ish soft saturator (keeps self-oscillation in check)
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// Host passes frequency in Hz. Last-note priority; re-triggers the envelopes.
export function noteOn(id: i32, f: f32, v: f32): void {
  const newFreq: f32 = f > 0.0 ? f : 0.0001;
  // First note from silence: seed the glide start an octave below so a sliding
  // attack is audible even on the opening note of a line.
  if (gate == 0 && curFreq <= 0.0) {
    curFreq = newFreq * 0.5;
  }
  targetFreq = newFreq;
  note = id;
  gate = 1;
  accentAmt = clampf(v, 0.0, 1.0);
  fenv = 1.0;
  aenv = 1.0;
}

export function noteOff(id: i32): void {
  if (id == note) gate = 0;
}

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN:   f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envAmtN: f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const accentN: f32 = clampf(params[P_ACCENT], 0.0, 1.0);
  const glideN:  f32 = clampf(params[P_GLIDE],  0.0, 1.0);
  const decayN:  f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // ---- derived coefficients ----

  // Filter envelope decay: ~25 ms (snappy squelch) .. ~1.1 s (long sweep).
  const fdecaySec: f32 = 0.025 + decayN * decayN * 1.1;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));

  // Amp envelope a touch longer so notes ring out musically.
  const adecaySec: f32 = 0.05 + decayN * decayN * 1.5;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));

  // Glide: 0 (instant) .. ~140 ms portamento.
  const glideSec: f32 = glideN * 0.14;
  const glideCoef: f32 = glideSec > 0.0
    ? f32(Mathf.exp(-1.0 / (glideSec * sampleRate)))
    : 0.0;

  // Accent: scales filter-env depth and adds level punch on hard hits.
  const accent: f32 = accentN * accentAmt;              // 0..1 effective accent
  const envAmtEff: f32 = envAmtN * (1.0 + 1.4 * accent); // accent opens filter more
  const ampBoost: f32 = 1.0 + 0.7 * accent;             // accent is louder

  // Resonance 0..~3.9 (squelches toward self-oscillation, bounded by satf).
  const reso: f32 = resoN * 3.9;

  // Base cutoff (exponential, musical): ~70 Hz .. ~9 kHz.
  const baseCut: f32 = f32(70.0 * Mathf.exp(cutoffN * 4.86));

  // Filter sweep span added on top of base by the envelope.
  const sweepSpan: f32 = envAmtEff * 8200.0;

  const nyq: f32 = sampleRate * 0.5;

  for (let i = 0; i < n; i++) {
    // ---- glide pitch toward target ----
    if (glideCoef > 0.0) {
      curFreq = targetFreq + (curFreq - targetFreq) * glideCoef;
    } else {
      curFreq = targetFreq;
    }

    // ---- oscillator ----
    let inc: f32 = curFreq / sampleRate;
    if (inc < 0.0) inc = 0.0;
    if (inc > 0.5) inc = 0.5;
    phase += inc;
    if (phase >= 1.0) phase -= 1.0;

    // sub oscillator: half frequency square, an octave down for body
    subPhase += inc * 0.5;
    if (subPhase >= 1.0) subPhase -= 1.0;

    const saw: f32 = phase * 2.0 - 1.0;
    const sq:  f32 = phase < 0.5 ? 1.0 : -1.0;
    const sub: f32 = subPhase < 0.5 ? 0.8 : -0.8;
    // fuller voice: saw core + a little square edge + sub octave
    let osc: f32 = saw * 0.85 + sq * 0.30 + sub * 0.55;
    osc *= 0.7; // gain-stage the source before the filter

    // ---- envelopes ----
    fenv *= fenvCoef;
    if (gate != 0) {
      aenv = aenv * aenvCoef;
      if (aenv < 0.30) aenv = 0.30; // hold a floor while the key is down
    } else {
      aenv *= aenvCoef;
    }

    // ---- cutoff for this sample ----
    let cutHz: f32 = baseCut + sweepSpan * fenv;
    // a short extra accent "click" of brightness at the very attack
    cutHz += sweepSpan * 0.5 * accent * (fenv * fenv);
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

    // ---- amp + accent + level ----
    let s: f32 = filtered * aenv * ampBoost;

    // DC blocker
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = y;
    s = y;

    // final level + headroom guard (peak stays < ~1.0)
    s = satf(s * level * 1.25) * 0.82;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
