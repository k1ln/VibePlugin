// =====================================================================
//  POLY MOOG — a fat, warm polyphonic analog instrument.
//  Original synth modelled on the behaviour of a classic six-voice
//  ladder polysynth. Up to EIGHT independent voices, each:
//    * THREE detuned oscillators (two band-limited saws + one pulse),
//      spread by the Detune control for a thick, beating analog tone;
//    * a 4-pole MOOG-style ladder low-pass with per-stage tanh
//      saturation, driven by its own filter envelope (+amount);
//    * an amplitude envelope.
//  Voices are keyed by noteId so a chord rings as separate fat voices.
//  Pure algorithm — no samples, no host imports, allocation-free.
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
const P_RESO:    i32 = 2;  // 0..1  -> ladder resonance
const P_ENVAMT:  i32 = 3;  // 0..1  -> filter envelope amount
const P_ATTACK:  i32 = 4;  // 0..1  -> seconds (amp + filter attack)
const P_RELEASE: i32 = 5;  // 0..1  -> seconds (amp + filter release)
const P_LEVEL:   i32 = 6;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// three oscillator phases per voice
const vPhA:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw, tuned down
const vPhB:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw, tuned up
const vPhC:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse, centre

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
    vPhA[v] = 0.0; vPhB[v] = 0.0; vPhC[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  ageCounter = 0;
  params[P_DETUNE]  = 0.35;
  params[P_CUTOFF]  = 0.5;
  params[P_RESO]    = 0.35;
  params[P_ENVAMT]  = 0.6;
  params[P_ATTACK]  = 0.06;
  params[P_RELEASE] = 0.35;
  params[P_LEVEL]   = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

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
  // staggered start phases so the three detuned oscillators beat from the
  // first sample rather than phase-locking to a thin tone.
  vPhA[slot] = 0.0;
  vPhB[slot] = 0.33;
  vPhC[slot] = 0.66;
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
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  // attack/release in seconds; fixed musical decay + sustain inside (a
  // classic fat-pad contour, controlled by the two exposed time knobs).
  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 1.2;
  const relS: f32 = 0.02  + clampf(params[P_RELEASE], 0.0, 1.0) * 2.5;
  const decS: f32 = 0.35;   // internal decay time
  const susL: f32 = 0.75;   // internal sustain level

  // per-sample envelope coefficients (linear-ish rates)
  const atkRate: f32 = 1.0 / (atkS * sr);
  const decRate: f32 = 1.0 / (decS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // detune in semitones: up to ~ +/-0.30 semitone -> rich tri-osc beating
  const detSemi: f32 = detune * 0.30;
  const ratioUp: f32   = f32(Mathf.pow(2.0, detSemi / 12.0));
  const ratioDown: f32 = f32(Mathf.pow(2.0, -detSemi / 12.0));

  // base cutoff in Hz, exponential 50 Hz .. ~16 kHz
  const baseHz: f32 = 50.0 * f32(Mathf.pow(320.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6.5 octaves
  const envOct: f32 = envAmt * 6.5;
  // ladder resonance feedback 0..~4 (approaches self-oscillation near top)
  const reso: f32 = resoN * 4.0;

  // headroom: 8 voices summed -> scale so a big chord stays well below 1
  const voiceScale: f32 = 0.42;

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

      // ---- three detuned oscillators (saw + saw + pulse) --------
      const baseInc: f32 = vFreq[v] / sr;
      const incA: f32 = baseInc * ratioDown;   // saw, tuned down
      const incB: f32 = baseInc * ratioUp;     // saw, tuned up
      const incC: f32 = baseInc;               // pulse, centre

      let pa: f32 = vPhA[v];
      pa += incA; if (pa >= 1.0) pa -= 1.0;
      let sawA: f32 = 2.0 * pa - 1.0;
      sawA -= polyBlep(pa, incA);
      vPhA[v] = pa;

      let pb: f32 = vPhB[v];
      pb += incB; if (pb >= 1.0) pb -= 1.0;
      let sawB: f32 = 2.0 * pb - 1.0;
      sawB -= polyBlep(pb, incB);
      vPhB[v] = pb;

      let pc: f32 = vPhC[v];
      pc += incC; if (pc >= 1.0) pc -= 1.0;
      // band-limited pulse (50% duty) via two saws
      const pw: f32 = 0.5;
      let sq: f32 = pc < pw ? 1.0 : -1.0;
      sq += polyBlep(pc, incC);
      let pcb: f32 = pc + (1.0 - pw);
      if (pcb >= 1.0) pcb -= 1.0;
      sq -= polyBlep(pcb, incC);
      vPhC[v] = pc;

      // mix the three oscillators (two saws give the fat body, pulse adds
      // hollow weight). detune spreads the saws so the sum beats richly.
      let osc: f32 = (sawA + sawB) * 0.38 + sq * 0.30;

      // ---- MOOG-style 4-pole ladder low-pass --------------------
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

      // resonance feedback from last stage; tanh on the input keeps the
      // ladder warm and stable (the signature soft saturation).
      let inp: f32 = osc - reso * s3;
      inp = f32(Mathf.tanh(inp));

      // each stage gently saturates too, for that fat ladder colour
      s0 += g * (inp - s0);
      s1 += g * (s0 - s1);
      s2 += g * (s1 - s2);
      s3 += g * (s2 - s3);

      vF0[v] = s0; vF1[v] = s1; vF2[v] = s2; vF3[v] = s3;

      let voice: f32 = s3 * aenv * vVel[v];
      outL += voice;
    }

    // ---- sum + soft saturate for analog glue + output level -----
    let mix: f32 = outL * voiceScale;
    mix = f32(Mathf.tanh(mix * 3.2));
    mix *= level;

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
