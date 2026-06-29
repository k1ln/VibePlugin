// =====================================================================
//  JUNO GLOW — a warm 6-voice DCO polyphonic synthesizer instrument.
//  Inspired by the early-80s Japanese DCO poly workhorses: ONE rock-stable
//  digitally-controlled oscillator per voice (a band-limited saw blended
//  with a variable-width pulse driven by PWM), a square SUB an octave down
//  and a sip of noise, into a resonant low-pass shaped by its own envelope
//  (Cutoff + Env Amount + Resonance) and an amplitude AD/R contour. The
//  whole bus then runs through the signature lush BBD-style stereo ENSEMBLE
//  CHORUS that gives the shimmering width. Pure algorithm, no samples,
//  no host imports.
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

// ---- chorus delay lines (BBD-style modulated stereo) ----------------
const CHORUS_LEN: i32 = 2048;   // ~42 ms at 48k — plenty for ensemble depth
const chL: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
const chR: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_CUTOFF: i32 = 0;  // 0..1  -> base filter cutoff
const P_RESO:   i32 = 1;  // 0..1  -> filter resonance
const P_ENVAMT: i32 = 2;  // 0..1  -> filter envelope amount
const P_PWM:    i32 = 3;  // 0..1  -> pulse-width modulation depth
const P_SUB:    i32 = 4;  // 0..1  -> sub-oscillator level
const P_CHORUS: i32 = 5;  // 0..1  -> ensemble chorus depth/width
const P_REL:    i32 = 6;  // 0..1  -> amp + filter release time
const P_LEVEL:  i32 = 7;  // 0..1  -> master output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhase:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // DCO phase
const vSubPh:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // sub (half freq) phase
const vLfoPh:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // per-voice PWM LFO phase
const vNoise:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noise rng state

// amplitude envelope (attack fixed-fast, sustain=1, then release)
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel
// filter envelope (attack, decay to sustain, then release)
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// resonant 4-pole ladder filter state (4 one-pole stages per voice)
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;
let chWrite: i32 = 0;    // chorus delay-line write index
let chLfo: f32 = 0.0;    // chorus LFO phase

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhase[v] = 0.0; vSubPh[v] = 0.0; vLfoPh[v] = 0.0;
    vNoise[v] = 0x1234 + v * 7919;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  for (let i = 0; i < CHORUS_LEN; i++) { chL[i] = 0.0; chR[i] = 0.0; }
  ageCounter = 0;
  chWrite = 0;
  chLfo = 0.0;

  params[P_CUTOFF] = 0.55;
  params[P_RESO]   = 0.30;
  params[P_ENVAMT] = 0.55;
  params[P_PWM]    = 0.40;
  params[P_SUB]    = 0.45;
  params[P_CHORUS] = 0.60;
  params[P_REL]    = 0.35;
  params[P_LEVEL]  = 0.70;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

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
  vPhase[slot]  = 0.0;
  vSubPh[slot]  = 0.0;
  // stagger per-voice PWM LFO so a chord shimmers rather than pulsing in lockstep
  vLfoPh[slot]  = f32(slot) * 0.17;
  vF0[slot] = 0.0; vF1[slot] = 0.0; vF2[slot] = 0.0; vF3[slot] = 0.0;
  vAge[slot] = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vAStage[i] = 3;  // release
      vFStage[i] = 3;
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const pwmN: f32    = clampf(params[P_PWM], 0.0, 1.0);
  const subN: f32    = clampf(params[P_SUB], 0.0, 1.0);
  const chorusN: f32 = clampf(params[P_CHORUS], 0.0, 1.0);
  const relN: f32    = clampf(params[P_REL], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  // envelope rates (fixed snappy attack, short filter decay; release knob-driven)
  const atkS: f32 = 0.006;
  const decS: f32 = 0.45;
  const relS: f32 = 0.02 + relN * 2.4;
  const atkRate: f32 = 1.0 / (atkS * sr);
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (relS * sr);
  const fSustain: f32 = 0.0;   // filter env decays fully toward base (classic pluck)

  // base cutoff in Hz, exponential 60 Hz .. ~16 kHz
  const baseHz: f32 = 60.0 * f32(Mathf.pow(256.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6 octaves
  const envOct: f32 = envAmt * 6.0;
  // resonance feedback 0..~3.6 (lush, just shy of self-oscillation)
  const reso: f32 = resoN * 3.6;

  // PWM: base duty 0.5, LFO swings it; depth from knob. Rate ~3 Hz slow drift.
  const pwmDepth: f32 = pwmN * 0.42;
  const pwmInc: f32 = 3.0 / sr;

  // chorus: classic ensemble — single triangle-ish LFO, L/R in quadrature.
  const chRate: f32 = 0.6;                 // ~0.6 Hz gentle wow
  const chRateInc: f32 = chRate / sr;
  const baseDelayMs: f32 = 11.0;           // ~11 ms center tap
  const baseDelay: f32 = baseDelayMs * 0.001 * sr;
  const chDepth: f32 = chorusN * 0.006 * sr; // up to ~6 ms swing
  const chMix: f32 = chorusN;                // dry/wet blend toward wet

  // headroom: 6 voices summed -> scale so a big chord stays < 1
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    let dry: f32 = 0.0;

    // advance the shared PWM modulator once per frame
    // (each voice reads its own staggered phase below)

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude envelope (A / sustain / R) -----------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {
        aenv = 1.0;
      } else if (astg == 3) {
        aenv -= relRate;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- filter envelope (A / D->sustain / R) -----------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {
        fenv -= decRate;
        if (fenv <= fSustain) { fenv = fSustain; fstg = 0; }
      } else if (fstg == 3) {
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- single DCO: saw + variable-width pulse ---------------
      const inc: f32 = vFreq[v] / sr;

      // per-voice PWM LFO
      let lfo: f32 = vLfoPh[v];
      lfo += pwmInc; if (lfo >= 1.0) lfo -= 1.0;
      vLfoPh[v] = lfo;
      const lfoTri: f32 = lfo < 0.5 ? (lfo * 4.0 - 1.0) : (3.0 - lfo * 4.0);
      let pw: f32 = 0.5 + pwmDepth * lfoTri;
      if (pw < 0.05) pw = 0.05;
      if (pw > 0.95) pw = 0.95;

      let ph: f32 = vPhase[v];
      ph += inc; if (ph >= 1.0) ph -= 1.0;
      vPhase[v] = ph;

      // band-limited saw
      let saw: f32 = 2.0 * ph - 1.0;
      saw -= polyBlep(ph, inc);

      // band-limited variable-width pulse (two saws)
      let sq: f32 = ph < pw ? 1.0 : -1.0;
      sq += polyBlep(ph, inc);
      let ph2: f32 = ph + (1.0 - pw);
      if (ph2 >= 1.0) ph2 -= 1.0;
      sq -= polyBlep(ph2, inc);

      // square SUB one octave down
      const subInc: f32 = inc * 0.5;
      let sph: f32 = vSubPh[v];
      sph += subInc; if (sph >= 1.0) sph -= 1.0;
      vSubPh[v] = sph;
      let sub: f32 = sph < 0.5 ? 1.0 : -1.0;
      sub += polyBlep(sph, subInc);
      let sph2: f32 = sph + 0.5;
      if (sph2 >= 1.0) sph2 -= 1.0;
      sub -= polyBlep(sph2, subInc);

      // a little noise for breath
      let rs: i32 = vNoise[v];
      rs ^= rs << 13; rs ^= rs >> 17; rs ^= rs << 5;
      vNoise[v] = rs;
      const noise: f32 = f32(rs) * (1.0 / 2147483648.0);

      // DCO mix: saw + pulse as the core, plus sub + a touch of noise
      let osc: f32 = saw * 0.55 + sq * 0.45 + sub * (subN * 0.9) + noise * 0.02;

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

      dry += s3 * aenv * vVel[v];
    }

    // ---- bus sum + gentle analog glue ---------------------------
    let mono: f32 = f32(Mathf.tanh(dry * voiceScale * 1.1));

    // ---- ENSEMBLE CHORUS (stereo BBD-style) ---------------------
    // write current mono signal into both delay lines
    chL[chWrite] = mono;
    chR[chWrite] = mono;

    chLfo += chRateInc; if (chLfo >= 1.0) chLfo -= 1.0;
    const aRad: f32 = chLfo * TWO_PI;
    const modL: f32 = f32(Mathf.sin(aRad));
    const modR: f32 = f32(Mathf.sin(aRad + 1.5707963)); // 90° apart for width

    const dlL: f32 = baseDelay + chDepth * modL;
    const dlR: f32 = baseDelay + chDepth * modR;

    let rl: f32 = f32(chWrite) - dlL;
    rl += f32(CHORUS_LEN);                 // bias positive (delay < CHORUS_LEN)
    let rr: f32 = f32(chWrite) - dlR;
    rr += f32(CHORUS_LEN);

    let il0: i32 = i32(rl) % CHORUS_LEN;
    if (il0 < 0) il0 += CHORUS_LEN;
    let il1: i32 = il0 + 1; if (il1 >= CHORUS_LEN) il1 -= CHORUS_LEN;
    const fl: f32 = rl - f32(i32(rl));
    const wetL: f32 = chL[il0] + (chL[il1] - chL[il0]) * fl;

    let ir0: i32 = i32(rr) % CHORUS_LEN;
    if (ir0 < 0) ir0 += CHORUS_LEN;
    let ir1: i32 = ir0 + 1; if (ir1 >= CHORUS_LEN) ir1 -= CHORUS_LEN;
    const fr: f32 = rr - f32(i32(rr));
    const wetR: f32 = chR[ir0] + (chR[ir1] - chR[ir0]) * fr;

    chWrite++; if (chWrite >= CHORUS_LEN) chWrite = 0;

    // blend: at chMix=0 pure mono dry; at chMix=1 wide wet ensemble
    let outL: f32 = mono * (1.0 - chMix * 0.5) + wetL * chMix;
    let outR: f32 = mono * (1.0 - chMix * 0.5) + wetR * chMix;

    outL *= level;
    outR *= level;

    // final safety clamp
    if (outL > 1.0) outL = 1.0; else if (outL < -1.0) outL = -1.0;
    if (outR > 1.0) outR = 1.0; else if (outR < -1.0) outR = -1.0;

    outBuf[f] = outL;
    outBuf[MAX_FRAMES + f] = outR;
  }
}
