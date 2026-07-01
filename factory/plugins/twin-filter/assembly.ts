// =====================================================================
//  TWIN FILTER — dual series HP+LP resonant mono synth (CS-lineage voice)
//
//  An original take on the classic Japanese dual-filter monophonic voice:
//  two detuned sawtooth oscillators are summed, then driven through a
//  resonant HIGH-PASS filter IN SERIES with a resonant LOW-PASS filter.
//  Because the HP comes first, you can carve a hollow / nasal / band-pass
//  character that single-filter monos cannot reach — the HP thins the body
//  out, the LP darkens the top, and where the two corners pinch together
//  you get a reedy, vocal band. A snappy filter envelope sweeps BOTH
//  cutoffs upward for the signature punchy "wow" attack.
//
//  Signal path per voice (2 voices, last-note priority + note stack):
//    osc1 + osc2 (detuned saws) -> resonant HP (2-pole SVF, HP tap)
//                               -> resonant LP (2-pole SVF, LP tap)
//                               -> amp env -> soft sat -> level
//    cutoffs = base * 2^(env * EnvAmount)  (envelope opens both filters)
//
//  Pure algorithm, no samples. All math in f32 (Mathf.*).
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 2;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32  = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_LPCUT:  i32 = 0; // low-pass cutoff 0..1  (darkens)
const P_HPCUT:  i32 = 1; // high-pass cutoff 0..1 (thins/hollows)
const P_RESO:   i32 = 2; // shared resonance 0..1 (both filters)
const P_ENVAMT: i32 = 3; // filter envelope amount 0..1 (sweeps both cutoffs)
const P_DECAY:  i32 = 4; // filter+amp decay 0..1
const P_DETUNE: i32 = 5; // osc2 detune 0..1
const P_LEVEL:  i32 = 6; // output level 0..1

// ---- per-voice state (StaticArrays, indexed by voice) ----
const vPhase1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc1 phase 0..1
const vPhase2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc2 phase 0..1
const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // base freq Hz
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // note id (-1 = free)
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for voice stealing
const vFenv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // filter env 1->0
const vAenv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // amp env
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // note velocity

// HP state-variable filter (per voice): two integrators
const vHpLp: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // hp svf low integrator
const vHpBp: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // hp svf band integrator
// LP state-variable filter (per voice)
const vLpLp: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // lp svf low integrator
const vLpBp: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // lp svf band integrator

let ageCounter: i32 = 0;

// global output DC blocker
let dcX: f32 = 0.0;
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vPhase1[v] = 0.0; vPhase2[v] = 0.0; vFreq[v] = 0.0;
    vNote[v] = -1; vGate[v] = 0; vAge[v] = 0;
    vFenv[v] = 0.0; vAenv[v] = 0.0; vVel[v] = 0.0;
    vHpLp[v] = 0.0; vHpBp[v] = 0.0; vLpLp[v] = 0.0; vLpBp[v] = 0.0;
  }
  ageCounter = 0;
  dcX = 0.0; dcY = 0.0;

  params[P_LPCUT]  = 0.62;
  params[P_HPCUT]  = 0.32;
  params[P_RESO]   = 0.55;
  params[P_ENVAMT] = 0.6;
  params[P_DECAY]  = 0.42;
  params[P_DETUNE] = 0.3;
  params[P_LEVEL]  = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// fast bounded tanh-ish saturator (keeps resonance + output safe)
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// ---- voice allocation: pick a free voice, else steal the oldest ----
function pickVoice(): i32 {
  for (let v = 0; v < NUM_VOICES; v++) {
    if (vGate[v] == 0 && vAenv[v] < 0.001) return v;
  }
  // steal the oldest-started voice
  let oldest: i32 = 0;
  let bestAge: i32 = 0x7fffffff;
  for (let v = 0; v < NUM_VOICES; v++) {
    if (vAge[v] < bestAge) { bestAge = vAge[v]; oldest = v; }
  }
  return oldest;
}

// Host passes frequency in Hz. Each new note grabs a voice and retriggers
// its envelopes (punchy attack).
export function noteOn(id: i32, f: f32, vel: f32): void {
  const fr: f32 = f > 0.0 ? f : 0.0001;
  const v: i32 = pickVoice();
  vNote[v]  = id;
  vFreq[v]  = fr;
  vGate[v]  = 1;
  vVel[v]   = clampf(vel, 0.0, 1.0);
  vPhase1[v] = 0.0;
  vPhase2[v] = 0.37;            // offset so the two saws don't start in phase
  vFenv[v]  = 1.0;             // retrigger filter sweep
  vAenv[v]  = 1.0;             // retrigger amp
  vAge[v]   = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let v = 0; v < NUM_VOICES; v++) {
    if (vNote[v] == id && vGate[v] == 1) { vGate[v] = 0; }
  }
}

export function process(n: i32): void {
  const lpN:    f32 = clampf(params[P_LPCUT],  0.0, 1.0);
  const hpN:    f32 = clampf(params[P_HPCUT],  0.0, 1.0);
  const resoN:  f32 = clampf(params[P_RESO],   0.0, 1.0);
  const envAmtN: f32 = clampf(params[P_ENVAMT], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY],  0.0, 1.0);
  const detuneN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const level:  f32 = clampf(params[P_LEVEL],  0.0, 1.0);

  const nyq: f32 = sampleRate * 0.5;

  // ---- base cutoffs (exponential, musical) ----
  //   LP:  ~120 Hz .. ~12 kHz   (darkens when low)
  //   HP:  ~20 Hz  .. ~1.8 kHz  (thins / hollows when high)
  const lpBase: f32 = f32(120.0 * Mathf.exp(lpN * 4.61));   // 120 * e^4.61 ~ 12000
  const hpBase: f32 = f32(20.0  * Mathf.exp(hpN * 4.50));   // 20 * e^4.50  ~ 1800

  // ---- envelope sweep: opens BOTH cutoffs by up to ~3 octaves ----
  const sweepOct: f32 = envAmtN * 3.0;

  // ---- resonance: shared by both filters. SVF damping q = 1/Q ----
  //   resoN 0 -> q ~2.0 (gentle), resoN 1 -> q ~0.06 (near self-osc, bounded)
  const q: f32 = 2.0 - resoN * 1.94;

  // ---- envelope decay coefficients ----
  const fdecaySec: f32 = 0.04 + decayN * decayN * 1.4;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));
  // amp env: short attack handled by retrigger; decay-to-sustain while held,
  // full release when gate drops. Made decay-dependent so Decay is audible.
  const adecaySec: f32 = 0.05 + decayN * decayN * 1.8;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));
  // release a touch faster than sustain decay
  const relSec: f32 = 0.04 + decayN * 0.5;
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (relSec * sampleRate)));

  // ---- detune: osc2 up to ~+/- ~30 cents-ish spread for thick mono ----
  const detRatio: f32 = 1.0 + detuneN * 0.035;   // up to +3.5% (osc2 sharp)

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      // skip fully silent free voices
      if (vGate[v] == 0 && vAenv[v] < 0.0002) continue;

      // ---- envelopes ----
      vFenv[v] *= fenvCoef;
      if (vGate[v] != 0) {
        // decay toward a sustain floor while held
        const sustain: f32 = 0.32;
        vAenv[v] = sustain + (vAenv[v] - sustain) * aenvCoef;
      } else {
        vAenv[v] *= relCoef;
      }
      const aenv: f32 = vAenv[v];

      // ---- oscillators: two detuned naive saws ----
      const f0: f32 = vFreq[v];
      let inc1: f32 = f0 / sampleRate;
      let inc2: f32 = (f0 * detRatio) / sampleRate;
      if (inc1 > 0.5) inc1 = 0.5; if (inc1 < 0.0) inc1 = 0.0;
      if (inc2 > 0.5) inc2 = 0.5; if (inc2 < 0.0) inc2 = 0.0;

      let ph1: f32 = vPhase1[v] + inc1; if (ph1 >= 1.0) ph1 -= 1.0;
      let ph2: f32 = vPhase2[v] + inc2; if (ph2 >= 1.0) ph2 -= 1.0;
      vPhase1[v] = ph1;
      vPhase2[v] = ph2;

      const saw1: f32 = ph1 * 2.0 - 1.0;
      const saw2: f32 = ph2 * 2.0 - 1.0;
      let osc: f32 = (saw1 + saw2) * 0.5;

      // ---- envelope-swept cutoffs (Hz) ----
      const sweep: f32 = f32(Mathf.exp(0.6931472 * sweepOct * vFenv[v])); // 2^(oct*env)
      let hpHz: f32 = hpBase * sweep;
      let lpHz: f32 = lpBase * sweep;
      if (hpHz < 20.0)  hpHz = 20.0;
      if (hpHz > nyq * 0.45) hpHz = nyq * 0.45;
      if (lpHz < 30.0)  lpHz = 30.0;
      if (lpHz > nyq * 0.45) lpHz = nyq * 0.45;

      // ---- SERIES resonant HIGH-PASS then resonant LOW-PASS (2-pole SVF) ----
      // HP stage
      let gH: f32 = f32(Mathf.tan(PI * hpHz / sampleRate));
      if (gH > 1.2) gH = 1.2;
      const denH: f32 = 1.0 + gH * (gH + q);
      let lpH: f32 = vHpLp[v];
      let bpH: f32 = vHpBp[v];
      const hpHpf: f32 = (osc - (gH + q) * bpH - lpH) / denH; // high-pass tap
      const bp1: f32 = gH * hpHpf + bpH;
      const lp1: f32 = gH * bp1 + lpH;
      vHpBp[v] = bp1;
      vHpLp[v] = lp1;
      let afterHP: f32 = hpHpf;        // hollowed signal
      afterHP = satf(afterHP * 1.1);   // gentle drive into LP

      // LP stage
      let gL: f32 = f32(Mathf.tan(PI * lpHz / sampleRate));
      if (gL > 1.2) gL = 1.2;
      const denL: f32 = 1.0 + gL * (gL + q);
      let lpL: f32 = vLpLp[v];
      let bpL: f32 = vLpBp[v];
      const hpL: f32 = (afterHP - (gL + q) * bpL - lpL) / denL;
      const bp2: f32 = gL * hpL + bpL;
      const lp2: f32 = gL * bp2 + lpL;
      vLpBp[v] = bp2;
      vLpLp[v] = lp2;
      let voiceOut: f32 = lp2;         // low-pass tap (darkened)

      // amp + per-note velocity
      voiceOut *= aenv * (0.55 + 0.45 * vVel[v]);
      mix += voiceOut;

      // free the voice once fully released and silent
      if (vGate[v] == 0 && vAenv[v] < 0.0002) {
        vNote[v] = -1;
        vHpLp[v] = 0.0; vHpBp[v] = 0.0; vLpLp[v] = 0.0; vLpBp[v] = 0.0;
      }
    }

    // ---- output stage: saturate, DC block, level ----
    let s: f32 = satf(mix * 1.2);
    const y: f32 = s - dcX + 0.9985 * dcY;
    dcX = s;
    dcY = y;
    s = y;
    s = satf(s * level * 1.25) * 0.82;   // peak guard, stays < ~1.0

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
