// =====================================================================
//  ARC POLY — a vintage American-style polyphonic synth voice
//  A small bank of independent voices, each with its OWN oscillator
//  (saw + pulse with PWM), its OWN 4-pole resonant low-pass and its OWN
//  filter + amp envelopes. Holding a chord sounds every held note at its
//  own pitch (true polyphony — 2 held notes give 2 distinct pitches).
//  The signature trick is a shared SAMPLE & HOLD: a stepped-random source
//  that re-samples at S&H Rate and wobbles every voice's filter cutoff in
//  lock-step for the classic ARP-style burbling / random-step movement.
//  Pure algorithm, no samples.
//
//  Signal path per voice:
//    VCO (saw + pulse/PWM) -> 4-pole resonant LPF -> amp env -> sum
//      cutoff = base + EnvAmt*filterEnv + S&HDepth*sampleHold(random steps)
//  The summed voices then pass a DC blocker, a soft saturator and Level.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const MAX_VOICES: i32 = 8; // polyphony: up to 8 simultaneous notes

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const PI: f32 = 3.14159265358979;

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) ----
const P_CUTOFF:  i32 = 0; // base cutoff 0..1
const P_RESO:    i32 = 1; // resonance 0..1
const P_ENVAMT:  i32 = 2; // filter-envelope amount 0..1
const P_SHDEPTH: i32 = 3; // sample & hold depth into cutoff 0..1
const P_SHRATE:  i32 = 4; // sample & hold rate 0..1 (Hz)
const P_DECAY:   i32 = 5; // filter + amp decay 0..1
const P_LEVEL:   i32 = 6; // output level 0..1

// ---- per-voice state (one independent synth voice per slot) ----
const vId:    StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // host note id (-1 = free)
const vActive:StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 if producing sound (held OR releasing)
const vGate:  StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 while the key is held
const vFreq:  StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // sounding freq (Hz)
const vVel:   StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // velocity 0..1
const vPhase: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // oscillator phase 0..1
const vFenv:  StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // filter envelope 1 -> 0
const vAenv:  StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // amp envelope
const vAge:   StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // for oldest-voice stealing
// per-voice 4-pole ladder filter state
const vF0: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);
let ageCtr: i32 = 0;

// ---- shared modulation: sample & hold, PWM LFO, RNG, DC blocker ----
let shValue: f32 = 0.0;    // current held random value (-1..1)
let shPrev: f32 = 0.0;     // previous held value
let shSmooth: f32 = 0.0;   // lightly slewed S&H output (stepped but click-free)
let shPhase: f32 = 0.0;    // 0..1 clock for the S&H sampler
let rngState: u32 = 0x1234567;

let pwmPhase: f32 = 0.0;   // slow LFO that PWM-modulates the pulse width

let dcX: f32 = 0.0;        // DC blocker
let dcY: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < MAX_VOICES; v++) {
    vId[v] = -1; vActive[v] = 0; vGate[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0; vPhase[v] = 0.0;
    vFenv[v] = 0.0; vAenv[v] = 0.0; vAge[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  ageCtr = 0;
  shValue = 0.0; shPrev = 0.0; shSmooth = 0.0; shPhase = 0.0;
  rngState = 0x1234567;
  pwmPhase = 0.0;
  dcX = 0.0; dcY = 0.0;

  params[P_CUTOFF]  = 0.42;
  params[P_RESO]    = 0.55;
  params[P_ENVAMT]  = 0.6;
  params[P_SHDEPTH] = 0.45;
  params[P_SHRATE]  = 0.4;
  params[P_DECAY]   = 0.45;
  params[P_LEVEL]   = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// soft saturator: bounded, smooth, cheap (tames resonance + adds analog grit)
@inline function satf(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// xorshift32 -> uniform random in [-1, 1]
@inline function nextRand(): f32 {
  let x: u32 = rngState;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rngState = x;
  const u: f32 = f32(x >> 8) * (1.0 / 16777216.0);
  return f32(u * 2.0 - 1.0);
}

// Pick a voice slot for a new note: prefer a free slot, else steal the oldest.
@inline function allocVoice(): i32 {
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] == 0) return v;
  }
  // none free — steal the oldest (lowest age counter)
  let best: i32 = 0;
  let bestAge: i32 = vAge[0];
  for (let v = 1; v < MAX_VOICES; v++) {
    if (vAge[v] < bestAge) { bestAge = vAge[v]; best = v; }
  }
  return best;
}

// Host passes frequency in Hz. Each note gets its own independent voice.
export function noteOn(id: i32, f: f32, v: f32): void {
  const nf: f32 = f > 0.0 ? f : 0.0001;
  const slot: i32 = allocVoice();
  vId[slot]    = id;
  vActive[slot]= 1;
  vGate[slot]  = 1;
  vFreq[slot]  = nf;
  vVel[slot]   = clampf(v, 0.0, 1.0);
  vPhase[slot] = 0.0;
  vFenv[slot]  = 1.0;
  vAenv[slot]  = 1.0;
  vF0[slot] = 0.0; vF1[slot] = 0.0; vF2[slot] = 0.0; vF3[slot] = 0.0;
  vAge[slot]   = ageCtr++;
}

export function noteOff(id: i32): void {
  // release every voice currently holding this id (gate off -> envelopes decay)
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] != 0 && vId[v] == id && vGate[v] != 0) {
      vGate[v] = 0;
    }
  }
}

export function process(n: i32): void {
  const cutoffN: f32  = clampf(params[P_CUTOFF],  0.0, 1.0);
  const resoN:   f32  = clampf(params[P_RESO],    0.0, 1.0);
  const envAmtN: f32  = clampf(params[P_ENVAMT],  0.0, 1.0);
  const shDepthN: f32 = clampf(params[P_SHDEPTH], 0.0, 1.0);
  const shRateN: f32  = clampf(params[P_SHRATE],  0.0, 1.0);
  const decayN:  f32  = clampf(params[P_DECAY],   0.0, 1.0);
  const level:   f32  = clampf(params[P_LEVEL],   0.0, 1.0);

  // ---- derived coefficients (shared across voices) ----

  // Decay: filter env ~40 ms .. ~1.6 s; amp env a touch longer for ring-out.
  const fdecaySec: f32 = 0.04 + decayN * decayN * 1.6;
  const fenvCoef: f32 = f32(Mathf.exp(-1.0 / (fdecaySec * sampleRate)));
  const adecaySec: f32 = 0.07 + decayN * decayN * 2.0;
  const aenvCoef: f32 = f32(Mathf.exp(-1.0 / (adecaySec * sampleRate)));

  // Resonance 0..~3.9 (toward self-oscillation, bounded by satf).
  const reso: f32 = resoN * 3.9;

  // Base cutoff (exponential, musical): ~70 Hz .. ~9 kHz.
  const baseCut: f32 = f32(70.0 * Mathf.exp(cutoffN * 4.86));

  // Filter-envelope sweep span (Hz).
  const sweepSpan: f32 = envAmtN * 8500.0;

  // S&H clock rate: ~0.4 Hz (slow burble) .. ~24 Hz (fast bubbling).
  const shRateHz: f32 = 0.4 + shRateN * shRateN * 23.6;
  const shInc: f32 = shRateHz / sampleRate;

  // S&H depth -> how many Hz the random step moves the cutoff.
  const shSpan: f32 = shDepthN * 6500.0;

  // Lightly slew the stepped value so steps are click-free but still obviously
  // "stepped".
  const shSlew: f32 = clampf(60.0 / sampleRate, 0.0, 1.0);

  // PWM LFO ~3.1 Hz
  const pwmInc: f32 = 3.1 / sampleRate;

  const nyq: f32 = sampleRate * 0.5;

  for (let i = 0; i < n; i++) {
    // ---- shared sample & hold clock ----
    shPhase += shInc;
    if (shPhase >= 1.0) {
      shPhase -= 1.0;
      shPrev = shValue;
      shValue = nextRand();
    }
    shSmooth += shSlew * (shValue - shSmooth);

    // ---- shared PWM LFO ----
    pwmPhase += pwmInc;
    if (pwmPhase >= 1.0) pwmPhase -= 1.0;
    const pw: f32 = 0.5 + 0.18 * f32(Mathf.sin(pwmPhase * 2.0 * PI));

    // shared cutoff modulation contribution from filter-env-independent sources
    const shCut: f32 = shSpan * shSmooth;

    // ---- sum all active voices ----
    let mix: f32 = 0.0;
    for (let v = 0; v < MAX_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // oscillator: per-voice phase ramp -> saw + PWM pulse
      let inc: f32 = vFreq[v] / sampleRate;
      if (inc < 0.0) inc = 0.0;
      if (inc > 0.5) inc = 0.5;
      let ph: f32 = vPhase[v] + inc;
      if (ph >= 1.0) ph -= 1.0;
      vPhase[v] = ph;

      const saw: f32 = ph * 2.0 - 1.0;
      const pulse: f32 = ph < pw ? 1.0 : -1.0;
      let osc: f32 = 0.6 * saw + 0.4 * pulse;
      osc *= 0.9;

      // per-voice envelopes
      let fe: f32 = vFenv[v] * fenvCoef;
      vFenv[v] = fe;
      let ae: f32 = vAenv[v];
      if (vGate[v] != 0) {
        ae = ae * aenvCoef;
        if (ae < 0.3) ae = 0.3; // sustain floor while held
      } else {
        ae = ae * aenvCoef;
      }
      vAenv[v] = ae;

      // per-voice cutoff: base + filter-env sweep + shared S&H step
      let cutHz: f32 = baseCut + sweepSpan * fe + shCut;
      if (cutHz < 20.0) cutHz = 20.0;
      if (cutHz > nyq * 0.49) cutHz = nyq * 0.49;

      // per-voice 4-pole resonant ladder
      let fc: f32 = cutHz / nyq;
      if (fc > 0.49) fc = 0.49;
      const g: f32 = fc * (1.8 - 0.8 * fc);

      const fb: f32 = reso * (1.0 - 0.15 * g);
      let f3v: f32 = vF3[v];
      const input: f32 = osc - fb * satf(f3v);

      let f0v: f32 = vF0[v]; let f1v: f32 = vF1[v]; let f2v: f32 = vF2[v];
      f0v += g * (input - f0v);
      f1v += g * (f0v - f1v);
      f2v += g * (f1v - f2v);
      f3v += g * (f2v - f3v);
      vF0[v] = f0v; vF1[v] = f1v; vF2[v] = f2v; vF3[v] = f3v;

      let filtered: f32 = satf(f3v * 1.3);

      // amp env + per-voice velocity loudness
      const ampBoost: f32 = 0.5 + 0.5 * vVel[v];
      mix += filtered * ae * ampBoost;

      // retire the voice once it has fully released and gone quiet
      if (vGate[v] == 0 && ae < 0.0008) {
        vActive[v] = 0;
        vId[v] = -1;
      }
    }

    // ---- DC blocker on the summed mix ----
    const y: f32 = mix - dcX + 0.9985 * dcY;
    dcX = mix;
    dcY = y;
    let s: f32 = y;

    // headroom: voices are summed, so scale before the saturator keeps peaks
    // bounded no matter how many notes are held, then apply Level.
    s = satf(s * 1.6) * level;

    outBuf[i] = s;
    outBuf[MAX_FRAMES + i] = s;
  }
}
