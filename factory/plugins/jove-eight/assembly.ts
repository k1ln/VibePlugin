// =====================================================================
//  JOVE EIGHT — a lush 8-voice analog poly synthesizer instrument in the
//  flagship-poly lineage. Each of the eight voices runs TWO oscillators
//  (a band-limited saw + a variable-width pulse with PWM) plus a sub-
//  oscillator one octave down, all spread by a subtle unison/detune for
//  the big stacked-string-pad character. The mixed oscillators feed a
//  resonant 24 dB/oct (4-pole) low-pass driven by its OWN ADSR contour
//  (Cutoff + Env Amount + Resonance), then an amplitude ADSR. Voices are
//  allocated per noteId so chords ring with independent contours.
//  Pure algorithm, no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_CUTOFF:  i32 = 0;  // 0..1  -> base filter cutoff (exp)
const P_RESO:    i32 = 1;  // 0..1  -> filter resonance
const P_ENVAMT:  i32 = 2;  // 0..1  -> filter envelope amount (octaves)
const P_PW:      i32 = 3;  // 0..1  -> pulse width + PWM depth
const P_DETUNE:  i32 = 4;  // 0..1  -> unison/osc detune spread
const P_ATTACK:  i32 = 5;  // 0..1  -> seconds (shared amp+filter atk)
const P_RELEASE: i32 = 6;  // 0..1  -> seconds (shared amp+filter rel)
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vDrift:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // per-voice unison offset (-1..1)

// oscillator phases: saw, pulse, sub
const vPhSaw:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhPul:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhSub:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vLfo:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // PWM lfo phase

// amplitude envelope
const vAEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 dec 3 sus 4 rel
// filter envelope
const vFEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// ladder filter state (4 one-pole stages per voice -> 24 dB/oct)
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    // fixed per-voice unison spread, symmetric around zero
    vDrift[v] = (f32(v) - 3.5) / 3.5;            // -1 .. +1
    vPhSaw[v] = 0.0; vPhPul[v] = 0.0; vPhSub[v] = 0.0; vLfo[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  ageCounter = 0;
  params[P_CUTOFF]  = 0.5;
  params[P_RESO]    = 0.3;
  params[P_ENVAMT]  = 0.55;
  params[P_PW]      = 0.35;
  params[P_DETUNE]  = 0.32;
  params[P_ATTACK]  = 0.08;
  params[P_RELEASE] = 0.4;
  params[P_LEVEL]   = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- voice allocation -----------------------------------------------
export function noteOn(id: i32, f: f32, v: f32): void {
  // prefer a free voice, else steal the oldest
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
  vAStage[slot] = 1;   // attack
  vFStage[slot] = 1;
  // offset start phases so the stacked oscillators don't phase-lock
  vPhSaw[slot] = 0.0;
  vPhPul[slot] = 0.25;
  vPhSub[slot] = 0.5;
  vLfo[slot]   = f32(slot) * 0.13;
  vF0[slot] = 0.0; vF1[slot] = 0.0; vF2[slot] = 0.0; vF3[slot] = 0.0;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vAStage[i] = 4;  // release
      vFStage[i] = 4;
    }
  }
}

// polyBLEP correction removes the worst aliasing on saw/pulse edges
@inline function polyBlep(t: f32, dt: f32): f32 {
  if (dt <= 0.0) return 0.0;
  if (t < dt) {
    const x: f32 = t / dt;
    return x + x - x * x - 1.0;
  } else if (t > 1.0 - dt) {
    const x: f32 = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const pwN: f32     = clampf(params[P_PW], 0.0, 1.0);
  const detune: f32  = clampf(params[P_DETUNE], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 2.0;
  const relS: f32 = 0.01  + clampf(params[P_RELEASE], 0.0, 1.0) * 3.0;
  // fixed musical decay + sustain for the classic poly contour
  const decS: f32 = 0.6;
  const susL: f32 = 0.78;

  // per-sample envelope rates (linear)
  const atkRate: f32 = 1.0 / (atkS * sr);
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // unison detune spread: up to ~ +/-0.22 semitone across voices
  const detSemi: f32 = detune * 0.22;

  // pulse width: 0.5 (square) down to ~0.08 (thin); PWM depth scales too
  const basePW: f32 = 0.5 - pwN * 0.42;
  const pwmDepth: f32 = 0.04 + pwN * 0.14;
  const pwmRate: f32 = 0.6;                 // Hz, slow PWM shimmer
  const lfoInc: f32 = pwmRate / sr;

  // base cutoff in Hz, exponential 50 Hz .. ~16 kHz
  const baseHz: f32 = 50.0 * f32(Mathf.pow(320.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6.5 octaves
  const envOct: f32 = envAmt * 6.5;
  // resonance feedback 0..~3.8
  const reso: f32 = resoN * 3.8;

  // headroom: 8 voices summed -> scale so a big chord stays < 1
  const voiceScale: f32 = 0.42;
  const outGain: f32 = level * 1.05;

  for (let f = 0; f < n; f++) {
    let mixL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude ADSR ---------------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {            // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {     // decay
        aenv -= decRate * (1.0 - susL);
        if (aenv <= susL) { aenv = susL; astg = 3; }
      } else if (astg == 3) {     // sustain
        aenv = susL;
      } else if (astg == 4) {     // release
        aenv -= relRate;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      // voice finished?
      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- filter ADSR ------------------------------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {
        fenv -= decRate * (1.0 - susL);
        if (fenv <= susL) { fenv = susL; fstg = 3; }
      } else if (fstg == 3) {
        fenv = susL;
      } else if (fstg == 4) {
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- per-voice unison detune ------------------------------
      const semis: f32 = detSemi * vDrift[v];
      const ratio: f32 = f32(Mathf.pow(2.0, semis / 12.0));
      const baseInc: f32 = (vFreq[v] * ratio) / sr;

      // ---- slow PWM lfo -----------------------------------------
      let lfo: f32 = vLfo[v];
      lfo += lfoInc; if (lfo >= 1.0) lfo -= 1.0;
      vLfo[v] = lfo;
      const pwm: f32 = f32(Mathf.sin(TWO_PI * lfo)) * pwmDepth;
      let pw: f32 = basePW + pwm;
      if (pw < 0.05) pw = 0.05;
      if (pw > 0.95) pw = 0.95;

      // ---- saw oscillator ---------------------------------------
      let ps: f32 = vPhSaw[v];
      ps += baseInc; if (ps >= 1.0) ps -= 1.0;
      let saw: f32 = 2.0 * ps - 1.0;
      saw -= polyBlep(ps, baseInc);
      vPhSaw[v] = ps;

      // ---- variable-width pulse oscillator ----------------------
      let pp: f32 = vPhPul[v];
      pp += baseInc; if (pp >= 1.0) pp -= 1.0;
      let pul: f32 = pp < pw ? 1.0 : -1.0;
      pul += polyBlep(pp, baseInc);
      let ppb: f32 = pp + (1.0 - pw);
      if (ppb >= 1.0) ppb -= 1.0;
      pul -= polyBlep(ppb, baseInc);
      vPhPul[v] = pp;

      // ---- sub oscillator (one octave down, square) -------------
      const subInc: f32 = baseInc * 0.5;
      let pb: f32 = vPhSub[v];
      pb += subInc; if (pb >= 1.0) pb -= 1.0;
      let sub: f32 = pb < 0.5 ? 1.0 : -1.0;
      sub += polyBlep(pb, subInc);
      let pbb: f32 = pb + 0.5;
      if (pbb >= 1.0) pbb -= 1.0;
      sub -= polyBlep(pbb, subInc);
      vPhSub[v] = pb;

      // mix oscillators (saw body + pulse edge + sub weight)
      let osc: f32 = saw * 0.55 + pul * 0.40 + sub * 0.30;

      // ---- resonant 4-pole (24 dB/oct) low-pass -----------------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let s0: f32 = vF0[v];
      let s1: f32 = vF1[v];
      let s2: f32 = vF2[v];
      let s3: f32 = vF3[v];

      // resonance feedback from last stage; tanh keeps it stable
      let inp: f32 = osc - reso * s3;
      inp = f32(Mathf.tanh(inp));

      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vF0[v] = s0; vF1[v] = s1; vF2[v] = s2; vF3[v] = s3;

      mixL += s3 * aenv * vVel[v];
    }

    // ---- sum + soft saturate for analog glue --------------------
    let out: f32 = mixL * voiceScale * outGain;
    out = f32(Mathf.tanh(out * 1.15));

    outBuf[f] = out;
    outBuf[MAX_FRAMES + f] = out;
  }
}
