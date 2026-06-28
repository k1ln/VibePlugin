// =====================================================================
//  ANALOG POLY — a polyphonic analog-style synthesizer instrument.
//  Eight independent voices, each: two detuned oscillators (a saw + a
//  pulse) summed, fed through a resonant 4-pole (24 dB/oct) low-pass
//  driven by its own ADSR contour (Cutoff + envelope amount), then an
//  amplitude ADSR. Voices are allocated per noteId so chords ring with
//  independent envelopes. Pure algorithm, no samples, no host imports.
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
const P_DETUNE:  i32 = 0;  // 0..1  -> oscillator spread
const P_CUTOFF:  i32 = 1;  // 0..1  -> base filter cutoff
const P_RESO:    i32 = 2;  // 0..1  -> filter resonance
const P_ENVAMT:  i32 = 3;  // 0..1  -> filter envelope amount
const P_ATTACK:  i32 = 4;  // 0..1  -> seconds
const P_DECAY:   i32 = 5;  // 0..1  -> seconds
const P_SUSTAIN: i32 = 6;  // 0..1  -> level
const P_RELEASE: i32 = 7;  // 0..1  -> seconds

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhase1:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw phase
const vPhase2:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse phase

// amplitude envelope
const vAEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 dec 3 sus 4 rel
// filter envelope
const vFEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// ladder filter state (4 one-pole stages per voice)
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
    vPhase1[v] = 0.0; vPhase2[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  ageCounter = 0;
  params[P_DETUNE]  = 0.3;
  params[P_CUTOFF]  = 0.55;
  params[P_RESO]    = 0.35;
  params[P_ENVAMT]  = 0.6;
  params[P_ATTACK]  = 0.02;
  params[P_DECAY]   = 0.35;
  params[P_SUSTAIN] = 0.7;
  params[P_RELEASE] = 0.3;
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
  // fresh phases offset so detune beats start coherently but not phase-locked
  vPhase1[slot] = 0.0;
  vPhase2[slot] = 0.25;
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
  const detune: f32  = clampf(params[P_DETUNE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);

  const atkS: f32 = 0.001 + clampf(params[P_ATTACK], 0.0, 1.0)  * 1.5;
  const decS: f32 = 0.005 + clampf(params[P_DECAY], 0.0, 1.0)   * 1.5;
  const susL: f32 = clampf(params[P_SUSTAIN], 0.0, 1.0);
  const relS: f32 = 0.005 + clampf(params[P_RELEASE], 0.0, 1.0) * 2.0;

  // per-sample envelope coefficients (linear-ish rates)
  const atkRate: f32 = 1.0 / (atkS * sr);
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // detune in semitone fraction: up to ~ +/-0.18 semitone -> richer beating
  const detSemi: f32 = detune * 0.18;
  const ratioUp: f32   = f32(Mathf.pow(2.0, detSemi / 12.0));
  const ratioDown: f32 = f32(Mathf.pow(2.0, -detSemi / 12.0));

  // base cutoff in Hz, exponential 60 Hz .. ~16 kHz
  const baseHz: f32 = 60.0 * f32(Mathf.pow(256.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6 octaves
  const envOct: f32 = envAmt * 6.0;
  // resonance feedback 0..~4 (self-oscillation near top)
  const reso: f32 = resoN * 4.0;

  // headroom: 8 voices summed -> scale so a big chord stays < 1
  const voiceScale: f32 = 0.5;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;

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

      // ---- oscillators (2 detuned: saw + pulse) -----------------
      const baseInc: f32 = vFreq[v] / sr;
      const inc1: f32 = baseInc * ratioDown;   // saw, tuned down
      const inc2: f32 = baseInc * ratioUp;     // pulse, tuned up

      let p1: f32 = vPhase1[v];
      p1 += inc1; if (p1 >= 1.0) p1 -= 1.0;
      // band-limited saw
      let saw: f32 = 2.0 * p1 - 1.0;
      saw -= polyBlep(p1, inc1);
      vPhase1[v] = p1;

      let p2: f32 = vPhase2[v];
      p2 += inc2; if (p2 >= 1.0) p2 -= 1.0;
      // band-limited pulse (50% duty) via two saws
      const pw: f32 = 0.5;
      let sq: f32 = p2 < pw ? 1.0 : -1.0;
      sq += polyBlep(p2, inc2);
      let p2b: f32 = p2 + (1.0 - pw);
      if (p2b >= 1.0) p2b -= 1.0;
      sq -= polyBlep(p2b, inc2);
      vPhase2[v] = p2;

      // mix oscillators (saw a touch louder for body)
      let osc: f32 = saw * 0.62 + sq * 0.45;

      // ---- resonant 4-pole low-pass -----------------------------
      // cutoff from base + filter envelope (octaves), per-voice
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      // one-pole coefficient
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

      let voice: f32 = s3 * aenv * vVel[v];
      outL += voice;
    }

    // ---- sum + soft saturate for analog glue --------------------
    let mix: f32 = outL * voiceScale;
    mix = f32(Mathf.tanh(mix * 1.2));

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
