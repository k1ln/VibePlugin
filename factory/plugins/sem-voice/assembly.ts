// =====================================================================
//  SEM VOICE — an SEM-lineage mono/duo synth INSTRUMENT
//  Two oscillators (a saw and a variable pulse) detuned against each
//  other feed a 12 dB/oct STATE-VARIABLE FILTER whose response MORPHS
//  continuously from low-pass through a NOTCH to high-pass via the Mode
//  control. The filter has resonance and its own decay envelope; that
//  smooth LP -> notch -> HP sweep is the signature voice. Pure algorithm.
//
//  Signal path (2 voices, duophonic, last-two-note priority):
//    osc1 saw + osc2 pulse (detuned) -> 12 dB state-variable filter
//    (LP/BP/HP blended by Mode) -> amp env -> level
//  The SVF cutoff = base cutoff + EnvAmount * filterEnv (its own decay).
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32  = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_MODE:   i32 = 0; // 0..1 : LP(0) -> notch(0.5) -> HP(1) morph
const P_CUTOFF: i32 = 1; // 0..1 : base cutoff
const P_RESO:   i32 = 2; // 0..1 : resonance
const P_ENV:    i32 = 3; // 0..1 : filter envelope amount
const P_DETUNE: i32 = 4; // 0..1 : osc2 detune + pulse character
const P_DECAY:  i32 = 5; // 0..1 : amp + filter decay time
const P_LEVEL:  i32 = 6; // 0..1 : output level

// ---- two voices (duophonic) ----
const NV: i32 = 2;
const vNote:  StaticArray<i32> = new StaticArray<i32>(NV); // note id (-1 = free)
const vGate:  StaticArray<i32> = new StaticArray<i32>(NV);
const vFreq:  StaticArray<f32> = new StaticArray<f32>(NV);
const vPh1:   StaticArray<f32> = new StaticArray<f32>(NV); // saw phase
const vPh2:   StaticArray<f32> = new StaticArray<f32>(NV); // pulse phase
const vAEnv:  StaticArray<f32> = new StaticArray<f32>(NV); // amp env
const vFEnv:  StaticArray<f32> = new StaticArray<f32>(NV); // filter env
// per-voice state-variable filter state
const vLp:    StaticArray<f32> = new StaticArray<f32>(NV);
const vBp:    StaticArray<f32> = new StaticArray<f32>(NV);

let voiceRR: i32 = 0; // round-robin allocator

// gentle DC blocker on the master output
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NV; v++) {
    vNote[v] = -1; vGate[v] = 0; vFreq[v] = 0.0;
    vPh1[v] = 0.0; vPh2[v] = 0.0; vAEnv[v] = 0.0; vFEnv[v] = 0.0;
    vLp[v] = 0.0; vBp[v] = 0.0;
  }
  voiceRR = 0;
  dcX = 0.0; dcY = 0.0;

  params[P_MODE]   = 0.0;   // start fully low-pass
  params[P_CUTOFF] = 0.45;
  params[P_RESO]   = 0.45;
  params[P_ENV]    = 0.6;
  params[P_DETUNE] = 0.35;
  params[P_DECAY]  = 0.5;
  params[P_LEVEL]  = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// soft saturator: bounded, smooth, cheap (tames resonance, adds SEM growl)
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// Host passes frequency in Hz. Duophonic with round-robin / last-note steal.
export function noteOn(id: i32, f: f32, v: f32): void {
  const freq: f32 = f > 0.0 ? f : 0.0001;
  // prefer a free voice
  let slot: i32 = -1;
  for (let i = 0; i < NV; i++) { if (vGate[i] == 0) { slot = i; break; } }
  if (slot < 0) { slot = voiceRR; voiceRR = (voiceRR + 1) % NV; }
  vNote[slot] = id;
  vFreq[slot] = freq;
  vGate[slot] = 1;
  vAEnv[slot] = 1.0;   // retrigger amp env (slight click avoided by smoothing)
  vFEnv[slot] = 1.0;   // retrigger filter env
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NV; i++) {
    if (vNote[i] == id && vGate[i] != 0) { vGate[i] = 0; vNote[i] = -1; }
  }
}

export function process(n: i32): void {
  const modeN:   f32 = clampf(params[P_MODE],   0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN:   f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envN:    f32 = clampf(params[P_ENV],    0.0, 1.0);
  const detuneN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const decayN:  f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const level:   f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  // ---- Mode morph: LP -> notch -> HP via three blend weights ----
  // 0.0 = pure LP, 0.5 = notch (LP+HP, no BP), 1.0 = pure HP.
  // We synthesise notch = lp + hp; band-pass = bp output of the SVF.
  let wLp: f32; let wHp: f32; let wBp: f32;
  if (modeN <= 0.5) {
    // LP -> notch : fade in HP, keep a little BP early for vocal body
    const t: f32 = modeN * 2.0;            // 0..1
    wLp = 1.0;
    wHp = t;
    wBp = (1.0 - t) * 0.0;                  // BP not used on this side
  } else {
    // notch -> HP : fade out LP
    const t: f32 = (modeN - 0.5) * 2.0;     // 0..1
    wLp = 1.0 - t;
    wHp = 1.0;
    wBp = 0.0;
  }
  // tiny BP injection scaled by resonance gives the throaty SEM mid honk,
  // strongest in the middle (notch) region; purely additive, bounded.
  const bpMid: f32 = (1.0 - f32(Mathf.abs(modeN - 0.5)) * 2.0); // 1 at notch, 0 at extremes
  wBp = bpMid * (0.15 + resoN * 0.45);

  // ---- filter-envelope decay: ~40 ms .. ~1.4 s ----
  const fdecaySec: f32 = 0.04 + decayN * decayN * 1.36;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));
  // amp envelope: a touch longer so notes ring out musically
  const adecaySec: f32 = 0.08 + decayN * decayN * 1.9;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));
  // sustain floor while gated (so a held note keeps body); decay rules release
  const sustain: f32 = 0.55 + decayN * 0.35; // longer decay -> higher sustain

  // ---- base cutoff (exponential, musical): ~90 Hz .. ~10 kHz ----
  const baseCut: f32 = f32(90.0 * Mathf.exp(cutoffN * 4.71));
  const sweepSpan: f32 = envN * 9000.0; // Hz added by filter env

  // resonance -> SVF damping (q). higher reso = lower damping = sharper peak.
  const q: f32 = 2.0 - resoN * 1.85;     // 2.0 (flat) .. 0.15 (sharp)

  // osc2 detune: up to ~ +/- 16 cents-ish plus a slow body; pulse width too.
  const detRatio: f32 = 1.0 + detuneN * 0.020;        // up to +2%
  const pulseW: f32 = 0.5 - detuneN * 0.32;           // PWM: 0.5 -> ~0.18

  const nyq: f32 = sampleRate * 0.5;

  for (let i = 0; i < n; i++) {
    let mixL: f32 = 0.0;

    for (let v = 0; v < NV; v++) {
      // skip fully-dead voices
      if (vGate[v] == 0 && vAEnv[v] < 0.0003) { continue; }

      // ---- envelopes ----
      vFEnv[v] *= fenvCoef;
      if (vGate[v] != 0) {
        // amp settles toward sustain while held
        vAEnv[v] = sustain + (vAEnv[v] - sustain) * aenvCoef;
      } else {
        vAEnv[v] *= aenvCoef;
      }

      const f0: f32 = vFreq[v];

      // ---- oscillators ----
      let inc1: f32 = f0 / sampleRate;
      if (inc1 < 0.0) inc1 = 0.0; if (inc1 > 0.5) inc1 = 0.5;
      let inc2: f32 = (f0 * detRatio) / sampleRate;
      if (inc2 < 0.0) inc2 = 0.0; if (inc2 > 0.5) inc2 = 0.5;

      vPh1[v] += inc1; if (vPh1[v] >= 1.0) vPh1[v] -= 1.0;
      vPh2[v] += inc2; if (vPh2[v] >= 1.0) vPh2[v] -= 1.0;

      const saw: f32 = vPh1[v] * 2.0 - 1.0;             // osc1 saw
      const pulse: f32 = vPh2[v] < pulseW ? 1.0 : -1.0; // osc2 variable pulse
      // mix the two oscillators; detune also raises osc2's presence
      let osc: f32 = saw * 0.62 + pulse * (0.38 + detuneN * 0.10);

      // ---- per-voice cutoff for this sample ----
      let cutHz: f32 = baseCut + sweepSpan * vFEnv[v];
      if (cutHz < 20.0) cutHz = 20.0;
      if (cutHz > nyq * 0.49) cutHz = nyq * 0.49;

      // ---- 12 dB Chamberlin state-variable filter ----
      // g = 2*sin(pi*fc/fs); keep stable.
      let g: f32 = f32(2.0 * Mathf.sin(PI * cutHz / sampleRate));
      if (g > 1.0) g = 1.0;

      let lp: f32 = vLp[v];
      let bp: f32 = vBp[v];
      // one pass
      const hp: f32 = osc - lp - q * bp;
      bp = bp + g * hp;
      lp = lp + g * bp;
      vLp[v] = lp;
      vBp[v] = bp;

      // ---- Mode morph blend of the three outputs ----
      // notch = lp + hp ; here we weight lp / hp / bp directly.
      let filt: f32 = lp * wLp + hp * wHp + bp * wBp;
      // saturate for analog warmth and to bound resonance
      filt = satf(filt * 0.9);

      mixL += filt * vAEnv[v];
    }

    // ---- master ----
    let s: f32 = mixL * 0.55;            // headroom for 2 voices

    // DC blocker
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s; dcY = y; s = y;

    // level + soft safety
    s = satf(s * (0.6 + level * 0.9));
    s *= 0.9;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
