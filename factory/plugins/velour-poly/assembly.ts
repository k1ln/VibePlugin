// =====================================================================
//  VELOUR POLY — a warm, velvety velocity-sensitive DCO polyphonic synth.
//  In the lineage of the smooth mid-80s Roman DCO polysynths: each of its
//  eight voices runs TWO digitally-clocked oscillators — a band-limited
//  saw and a band-limited pulse — with a gentle CROSS-MODULATION (the saw
//  bends the pulse's phase rate) for that slightly hollow, glassy bell-pad
//  character. The pair feeds a smooth resonant low-pass driven by its OWN
//  ADSR (Cutoff + Env Amount), then an amplitude ADSR whose level and
//  brightness track key VELOCITY. A stereo three-tap chorus widens the
//  whole thing into the famous lush velvet pad. Pure algorithm, no samples,
//  no host imports. All math is f32 (Mathf.*); process() allocates nothing.
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
const P_CUTOFF:   i32 = 0;  // 0..1  -> base filter cutoff
const P_RESO:     i32 = 1;  // 0..1  -> filter resonance
const P_ENVAMT:   i32 = 2;  // 0..1  -> filter envelope amount (octaves)
const P_CROSSMOD: i32 = 3;  // 0..1  -> DCO cross-modulation depth
const P_CHORUS:   i32 = 4;  // 0..1  -> stereo chorus depth/width
const P_ATTACK:   i32 = 5;  // 0..1  -> seconds
const P_RELEASE:  i32 = 6;  // 0..1  -> seconds
const P_LEVEL:    i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhase1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw DCO phase
const vPhase2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse DCO phase

// amplitude envelope (ADSR; sustain fixed velvety, decay gentle)
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 dec 3 sus 4 rel
// filter envelope
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// smooth resonant low-pass: 4 cascaded one-pole stages per voice
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

// ---- stereo chorus delay lines (shared, not per-voice) --------------
const CHORUS_LEN: i32 = 2048; // ~42 ms at 48k, plenty for a lush chorus
const chL: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
const chR: StaticArray<f32> = new StaticArray<f32>(CHORUS_LEN);
let chWrite: i32 = 0;
let lfoPhase: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhase1[v] = 0.0; vPhase2[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  for (let i = 0; i < CHORUS_LEN; i++) { chL[i] = 0.0; chR[i] = 0.0; }
  chWrite = 0;
  lfoPhase = 0.0;
  ageCounter = 0;

  params[P_CUTOFF]   = 0.5;
  params[P_RESO]     = 0.3;
  params[P_ENVAMT]   = 0.55;
  params[P_CROSSMOD] = 0.25;
  params[P_CHORUS]   = 0.45;
  params[P_ATTACK]   = 0.15;
  params[P_RELEASE]  = 0.4;
  params[P_LEVEL]    = 0.7;
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
  // offset phases so the saw/pulse pair starts coherent but not phase-locked
  vPhase1[slot] = 0.0;
  vPhase2[slot] = 0.33;
  vAEnv[slot] = 0.0; vFEnv[slot] = 0.0;
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

// linear read of a chorus delay line, `delay` frames back from the write head
@inline function readDelay(buf: StaticArray<f32>, write: i32, delay: f32): f32 {
  let rp: f32 = f32(write) - delay;
  while (rp < 0.0) rp += f32(CHORUS_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1; if (i1 >= CHORUS_LEN) i1 -= CHORUS_LEN;
  const frac: f32 = rp - f32(i0);
  const a: f32 = buf[i0];
  const b: f32 = buf[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const xmodN: f32   = clampf(params[P_CROSSMOD], 0.0, 1.0);
  const chorusN: f32 = clampf(params[P_CHORUS], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 2.5;
  const relS: f32 = 0.01  + clampf(params[P_RELEASE], 0.0, 1.0) * 3.0;

  // velvety internal contour: gentle decay to a high sustain
  const decS: f32 = 0.6;
  const susL: f32 = 0.78;

  const atkRate: f32 = 1.0 / (atkS * sr);
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // cross-mod depth: the saw stage modulates the pulse phase increment
  const xmod: f32 = xmodN * 0.6;

  // base cutoff in Hz, exponential 80 Hz .. ~14 kHz (smooth, slightly dark)
  const baseHz: f32 = 80.0 * f32(Mathf.pow(180.0, cutoffN));
  // envelope sweeps cutoff up by up to ~5 octaves
  const envOct: f32 = envAmt * 5.0;
  // resonance feedback 0..~3.4 (smooth, never harsh self-oscillation)
  const reso: f32 = resoN * 3.4;

  // ---- chorus setup -------------------------------------------------
  // a slow ~0.5 Hz LFO; depth and a static stereo spread scale with Chorus
  const lfoInc: f32 = 0.5 / sr;
  const baseDelayMs: f32 = 12.0;                 // center tap
  const baseDelay: f32 = baseDelayMs * 0.001 * sr;
  const modDepth: f32 = (1.0 + chorusN * 5.0) * 0.001 * sr; // up to ~6 ms sweep
  const chMix: f32 = chorusN;                    // 0 dry .. 1 wide

  // headroom: 8 voices summed -> scale so a big chord stays < 1
  const voiceScale: f32 = 0.42;

  let lp: f32 = lfoPhase;
  let wr: i32 = chWrite;

  for (let f = 0; f < n; f++) {
    let dry: f32 = 0.0;

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

      const vel: f32 = vVel[v];

      // ---- the two DCOs (saw + pulse) with cross-modulation -----
      const baseInc: f32 = vFreq[v] / sr;

      // saw DCO
      let p1: f32 = vPhase1[v];
      p1 += baseInc; if (p1 >= 1.0) p1 -= 1.0;
      let saw: f32 = 2.0 * p1 - 1.0;
      saw -= polyBlep(p1, baseInc);
      vPhase1[v] = p1;

      // cross-mod: the saw bends the pulse's instantaneous rate
      let inc2: f32 = baseInc * (1.0 + xmod * saw);
      if (inc2 < 0.0) inc2 = 0.0;
      if (inc2 > 0.5) inc2 = 0.5;

      // pulse DCO (50% duty) via two band-limited saws
      let p2: f32 = vPhase2[v];
      p2 += inc2; if (p2 >= 1.0) p2 -= 1.0;
      const pw: f32 = 0.5;
      let sq: f32 = p2 < pw ? 1.0 : -1.0;
      sq += polyBlep(p2, inc2);
      let p2b: f32 = p2 + (1.0 - pw);
      if (p2b >= 1.0) p2b -= 1.0;
      sq -= polyBlep(p2b, inc2);
      vPhase2[v] = p2;

      // velvety DCO mix: saw for body, pulse for the slightly hollow tone
      let osc: f32 = saw * 0.55 + sq * 0.42;

      // ---- smooth resonant low-pass -----------------------------
      // velocity opens the filter a touch for expressive dynamics
      const velBright: f32 = 0.5 + 0.5 * vel;
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv)) * velBright;
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      let s0: f32 = vF0[v];
      let s1: f32 = vF1[v];
      let s2: f32 = vF2[v];
      let s3: f32 = vF3[v];

      // resonance feedback from the last stage; tanh keeps it smooth
      let inp: f32 = osc - reso * s3;
      inp = f32(Mathf.tanh(inp));

      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vF0[v] = s0; vF1[v] = s1; vF2[v] = s2; vF3[v] = s3;

      // velocity shapes loudness; squared for a gentle dynamic curve
      const velAmp: f32 = 0.25 + 0.75 * vel * vel;
      dry += s3 * aenv * velAmp;
    }

    dry *= voiceScale;

    // ---- stereo chorus ----------------------------------------------
    // write the mono dry voice sum into both delay lines
    chL[wr] = dry;
    chR[wr] = dry;

    lp += lfoInc; if (lp >= 1.0) lp -= 1.0;
    const lfoL: f32 = f32(Mathf.sin(TWO_PI * lp));
    const lfoR: f32 = f32(Mathf.sin(TWO_PI * lp + PI * 0.5)); // 90° apart -> width

    const dL: f32 = baseDelay + modDepth * (0.5 + 0.5 * lfoL);
    const dR: f32 = baseDelay + modDepth * (0.5 + 0.5 * lfoR);

    const wetL: f32 = readDelay(chL, wr, dL);
    const wetR: f32 = readDelay(chR, wr, dR);

    wr++; if (wr >= CHORUS_LEN) wr = 0;

    // blend dry center with the widened wet taps
    let outL: f32 = dry * (1.0 - 0.5 * chMix) + wetL * chMix;
    let outR: f32 = dry * (1.0 - 0.5 * chMix) + wetR * chMix;

    // final velvet glue + output level
    outL = f32(Mathf.tanh(outL * 2.3)) * level;
    outR = f32(Mathf.tanh(outR * 2.3)) * level;

    outBuf[f] = outL;
    outBuf[MAX_FRAMES + f] = outR;
  }

  lfoPhase = lp;
  chWrite = wr;
}
