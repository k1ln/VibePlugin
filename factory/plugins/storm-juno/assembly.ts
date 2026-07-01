// =====================================================================
//  STORM JUNO — a 6-voice DCO polyphonic instrument (Alpha-Juno lineage).
//  The signature "hoover / storm" lead: each voice stacks THREE detuned
//  pulse oscillators under deep pulse-width modulation, plus a saw and a
//  sub-octave square, into a resonant low-pass shaped by its own punchy
//  filter envelope. A global PWM Rate/Depth LFO sweeps the hollow
//  detuned-pulse motion; a stereo chorus widens the result.
//  Pure algorithm — no samples, no host imports, allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 6;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_CUTOFF:  i32 = 0;  // 0..1  -> base filter cutoff
const P_RESO:    i32 = 1;  // 0..1  -> filter resonance
const P_ENVAMT:  i32 = 2;  // 0..1  -> filter envelope amount
const P_PWMDEP:  i32 = 3;  // 0..1  -> pulse-width modulation depth
const P_PWMRATE: i32 = 4;  // 0..1  -> PWM / hoover sweep rate
const P_CHORUS:  i32 = 5;  // 0..1  -> chorus width / mix
const P_RELEASE: i32 = 6;  // 0..1  -> amp + filter release time
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// three stacked detuned pulse phases + saw + sub-square
const vPh0:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh1:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPh2:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhSaw:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vPhSub:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// amplitude envelope (fast attack + decay-to-sustain, release on note-off)
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 dec/sus 4 rel
// filter envelope (its own punchy contour)
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// ladder filter state (4 one-pole stages per voice)
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// global PWM / hoover LFO
let pwmPhase: f32 = 0.0;

// stereo chorus delay lines (modulated)
const CHORUS_LEN: i32 = 2048;          // ~42 ms at 48k, plenty for chorus
const chL: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
const chR: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
let chWrite: i32 = 0;
let chPhase: f32 = 0.0;

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPh0[v] = 0.0; vPh1[v] = 0.0; vPh2[v] = 0.0; vPhSaw[v] = 0.0; vPhSub[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  for (let i = 0; i < CHORUS_LEN; i++) { chL[i] = 0.0; chR[i] = 0.0; }
  chWrite = 0; chPhase = 0.0; pwmPhase = 0.0;
  ageCounter = 0;

  params[P_CUTOFF]  = 0.45;
  params[P_RESO]    = 0.55;
  params[P_ENVAMT]  = 0.7;
  params[P_PWMDEP]  = 0.7;
  params[P_PWMRATE] = 0.35;
  params[P_CHORUS]  = 0.6;
  params[P_RELEASE] = 0.35;
  params[P_LEVEL]   = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- voice allocation -----------------------------------------------
export function noteOn(id: i32, f: f32, v: f32): void {
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
  vAEnv[slot]   = 0.0;
  vFEnv[slot]   = 0.0;
  // offset the three pulse phases so the stack starts hollow & wide
  vPh0[slot] = 0.0;
  vPh1[slot] = 0.33;
  vPh2[slot] = 0.66;
  vPhSaw[slot] = 0.5;
  vPhSub[slot] = 0.0;
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

// band-limited pulse of arbitrary width via two phase-shifted saws
@inline function blPulse(ph: f32, inc: f32, pw: f32): f32 {
  let sq: f32 = ph < pw ? 1.0 : -1.0;
  sq += polyBlep(ph, inc);
  let ph2: f32 = ph - pw;
  if (ph2 < 0.0) ph2 += 1.0;
  sq -= polyBlep(ph2, inc);
  return sq;
}

// linear read from a chorus delay line at fractional sample distance back
@inline function readDelay(line: StaticArray<f32>, write: i32, delay: f32): f32 {
  let rp: f32 = f32(write) - delay;
  while (rp < 0.0) rp += f32(CHORUS_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1; if (i1 >= CHORUS_LEN) i1 -= CHORUS_LEN;
  const frac: f32 = rp - f32(i0);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const pwmDep: f32  = clampf(params[P_PWMDEP], 0.0, 1.0);
  const pwmRateN: f32 = clampf(params[P_PWMRATE], 0.0, 1.0);
  const chorusN: f32 = clampf(params[P_CHORUS], 0.0, 1.0);
  const relN: f32    = clampf(params[P_RELEASE], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  // amp envelope timing: punchy fixed attack/decay, knob-controlled release
  const atkS: f32 = 0.006;
  const decS: f32 = 0.6;
  const susL: f32 = 0.72;
  const relS: f32 = 0.03 + relN * 2.5;
  const atkRate: f32 = 1.0 / (atkS * sr);
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // filter envelope is punchier: faster decay, release tracks the amp release
  const fAtkRate: f32 = 1.0 / (0.004 * sr);
  const fDecRate: f32 = 1.0 / (0.35 * sr);
  const fSus: f32 = 0.25;
  const fRelRate: f32 = 1.0 / ((0.03 + relN * 2.0) * sr);

  // base cutoff in Hz, exponential 80 Hz .. ~14 kHz
  const baseHz: f32 = 80.0 * f32(Mathf.pow(180.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6 octaves
  const envOct: f32 = envAmt * 6.0;
  // resonance feedback 0..~3.8
  const reso: f32 = resoN * 3.8;

  // hoover detune spread: the three pulses sit at small fixed offsets so the
  // stack always sounds wide; PWM motion does the rest.
  const detUp: f32   = f32(Mathf.pow(2.0, 0.07 / 12.0));   // ~+7 cents
  const detDown: f32 = f32(Mathf.pow(2.0, -0.07 / 12.0));  // ~-7 cents

  // PWM LFO: 0.05 .. ~7 Hz (the hoover sweep)
  const pwmHz: f32 = 0.05 + pwmRateN * pwmRateN * 7.0;
  const pwmInc: f32 = pwmHz / sr;
  // pulse width swings around 0.5 by up to ~0.42
  const pwSwing: f32 = pwmDep * 0.42;

  // chorus: ~6 ms base delay, ~4 ms modulation, 0.7 Hz
  const chBase: f32 = 0.006 * sr;
  const chMod: f32  = 0.004 * sr;
  const chInc: f32  = 0.7 / sr;
  const chMix: f32  = chorusN;            // 0 dry .. 1 lush

  // 6 voices summed -> scale so a big chord stays < 1
  const voiceScale: f32 = 0.34;

  for (let f = 0; f < n; f++) {
    // advance the global PWM LFO + per-stack phase offsets for the three pulses
    pwmPhase += pwmInc; if (pwmPhase >= 1.0) pwmPhase -= 1.0;
    const lfo0: f32 = Mathf.sin(TWO_PI * pwmPhase);
    const lfo1: f32 = Mathf.sin(TWO_PI * pwmPhase + 2.094);   // +120 deg
    const lfo2: f32 = Mathf.sin(TWO_PI * pwmPhase + 4.188);   // +240 deg
    const pw0: f32 = clampf(0.5 + pwSwing * lfo0, 0.05, 0.95);
    const pw1: f32 = clampf(0.5 + pwSwing * lfo1, 0.05, 0.95);
    const pw2: f32 = clampf(0.5 + pwSwing * lfo2, 0.05, 0.95);

    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude envelope -----------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {                 // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {          // decay -> sustain
        if (aenv > susL) {
          aenv -= decRate * (1.0 - susL);
          if (aenv <= susL) aenv = susL;
        } else {
          aenv = susL;
        }
      } else if (astg == 4) {          // release
        aenv -= relRate;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- filter envelope --------------------------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += fAtkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {
        if (fenv > fSus) {
          fenv -= fDecRate * (1.0 - fSus);
          if (fenv <= fSus) fenv = fSus;
        } else {
          fenv = fSus;
        }
      } else if (fstg == 4) {
        fenv -= fRelRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- DCO: three detuned PWM pulses + saw + sub ------------
      const baseInc: f32 = vFreq[v] / sr;
      const inc0: f32 = baseInc * detDown;
      const inc1: f32 = baseInc;
      const inc2: f32 = baseInc * detUp;

      let p0: f32 = vPh0[v]; p0 += inc0; if (p0 >= 1.0) p0 -= 1.0; vPh0[v] = p0;
      let p1: f32 = vPh1[v]; p1 += inc1; if (p1 >= 1.0) p1 -= 1.0; vPh1[v] = p1;
      let p2: f32 = vPh2[v]; p2 += inc2; if (p2 >= 1.0) p2 -= 1.0; vPh2[v] = p2;

      const pulse0: f32 = blPulse(p0, inc0, pw0);
      const pulse1: f32 = blPulse(p1, inc1, pw1);
      const pulse2: f32 = blPulse(p2, inc2, pw2);
      const pulseStack: f32 = (pulse0 + pulse1 + pulse2) * 0.33;

      // band-limited saw on the centre frequency for body
      let psaw: f32 = vPhSaw[v]; psaw += inc1; if (psaw >= 1.0) psaw -= 1.0; vPhSaw[v] = psaw;
      let saw: f32 = 2.0 * psaw - 1.0;
      saw -= polyBlep(psaw, inc1);

      // sub-octave square one octave down
      let psub: f32 = vPhSub[v]; psub += inc1 * 0.5; if (psub >= 1.0) psub -= 1.0; vPhSub[v] = psub;
      const sub: f32 = psub < 0.5 ? 0.7 : -0.7;

      // hoover voicing: pulse stack dominates, saw + sub fill it out
      let osc: f32 = pulseStack * 0.9 + saw * 0.32 + sub * 0.28;

      // ---- resonant 4-pole low-pass -----------------------------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let s0: f32 = vF0[v];
      let s1: f32 = vF1[v];
      let s2: f32 = vF2[v];
      let s3: f32 = vF3[v];

      let inp: f32 = osc - reso * s3;
      inp = f32(Mathf.tanh(inp));

      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vF0[v] = s0; vF1[v] = s1; vF2[v] = s2; vF3[v] = s3;

      outL += s3 * aenv * vVel[v];
    }

    let mono: f32 = outL * voiceScale;
    mono = f32(Mathf.tanh(mono * 2.7));

    // ---- stereo chorus for width -------------------------------
    chPhase += chInc; if (chPhase >= 1.0) chPhase -= 1.0;
    const cm: f32 = Mathf.sin(TWO_PI * chPhase);
    const dL: f32 = chBase + chMod * (0.5 + 0.5 * cm);
    const dR: f32 = chBase + chMod * (0.5 - 0.5 * cm);

    chL[chWrite] = mono;
    chR[chWrite] = mono;
    const wetL: f32 = readDelay(chL, chWrite, dL);
    const wetR: f32 = readDelay(chR, chWrite, dR);
    chWrite++; if (chWrite >= CHORUS_LEN) chWrite = 0;

    let yL: f32 = mono * (1.0 - 0.5 * chMix) + wetL * chMix;
    let yR: f32 = mono * (1.0 - 0.5 * chMix) + wetR * chMix;

    yL *= level;
    yR *= level;

    outBuf[f] = clampf(yL, -1.0, 1.0);
    outBuf[MAX_FRAMES + f] = clampf(yR, -1.0, 1.0);
  }
}
