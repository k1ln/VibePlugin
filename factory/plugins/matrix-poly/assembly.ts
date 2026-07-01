// =====================================================================
//  MATRIX POLY — a deeply-modulated dual-filter analog poly synthesizer.
//  Lineage of the great 80s flagship matrix-modulation polys: six voices,
//  each running TWO oscillators (a band-limited saw + a pulse with evolving
//  PWM) into a smooth resonant low-pass shaped by its own filter envelope.
//  A global LFO is matrix-routed simultaneously to filter cutoff, oscillator
//  pitch (a gentle vibrato) and pulse width, so held chords slowly breathe
//  and evolve — the signature lush, ever-moving pad. Pure algorithm, no
//  samples, no host imports. All math in f32 (Mathf.*).
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
const P_MODDEP:  i32 = 3;  // 0..1  -> LFO depth -> cutoff + pitch + PWM
const P_MODRATE: i32 = 4;  // 0..1  -> LFO rate
const P_ATTACK:  i32 = 5;  // 0..1  -> seconds
const P_RELEASE: i32 = 6;  // 0..1  -> seconds
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:     StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // oldest-voice steal

const vFreq:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhase1:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // saw phase
const vPhase2:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // pulse phase
const vLfoOff:  StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // per-voice LFO phase offset

// amplitude AR envelope (attack -> sustain -> release)
const vAEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel
// filter AR envelope
const vFEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// 4-pole low-pass filter state per voice
const vF0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vF3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;
let lfoPhase: f32 = 0.0;   // global LFO phase 0..1

// one-pole DC blocker state (removes the small DC from the unipolar PWM pulse)
let dcX1: f32 = 0.0;
let dcY1: f32 = 0.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhase1[v] = 0.0; vPhase2[v] = 0.0; vLfoOff[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vF0[v] = 0.0; vF1[v] = 0.0; vF2[v] = 0.0; vF3[v] = 0.0;
  }
  ageCounter = 0;
  lfoPhase = 0.0;
  dcX1 = 0.0;
  dcY1 = 0.0;
  params[P_CUTOFF]  = 0.45;
  params[P_RESO]    = 0.35;
  params[P_ENVAMT]  = 0.55;
  params[P_MODDEP]  = 0.5;
  params[P_MODRATE] = 0.35;
  params[P_ATTACK]  = 0.25;
  params[P_RELEASE] = 0.45;
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
  vPhase1[slot] = 0.0;
  vPhase2[slot] = 0.25;
  // spread LFO phase across voices so a chord shimmers rather than pumps as one
  vLfoOff[slot] = f32(slot) * (1.0 / f32(NUM_VOICES));
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
  const modDep: f32  = clampf(params[P_MODDEP], 0.0, 1.0);
  const modRateN: f32 = clampf(params[P_MODRATE], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 2.5;
  const relS: f32 = 0.01  + clampf(params[P_RELEASE], 0.0, 1.0) * 3.0;
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // envelope rates
  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // base cutoff in Hz, exponential 70 Hz .. ~14 kHz
  const baseHz: f32 = 70.0 * f32(Mathf.pow(200.0, cutoffN));
  // envelope sweeps cutoff up by up to ~5 octaves
  const envOct: f32 = envAmt * 5.0;
  // resonance feedback 0..~4 (sings near the top)
  const reso: f32 = resoN * 4.0;

  // LFO rate 0.05 .. ~9 Hz, exponential so slow pads are easy to dial
  const lfoHz: f32 = 0.05 * f32(Mathf.pow(180.0, modRateN));
  const lfoInc: f32 = lfoHz / sr;

  // matrix mod amounts (depth scales all three destinations)
  const cutModOct: f32 = modDep * 3.0;     // +/- 3 octaves of cutoff sweep
  const pitchModSemi: f32 = modDep * 0.35; // gentle vibrato in semitones
  const pwmDepth: f32 = modDep * 0.4;      // pulse width sweep around 0.5

  // headroom for 6 summed voices
  const voiceScale: f32 = 0.55;

  for (let f = 0; f < n; f++) {
    // advance the global LFO
    lfoPhase += lfoInc;
    if (lfoPhase >= 1.0) lfoPhase -= 1.0;

    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude AR envelope --------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {            // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {     // sustain
        aenv = 1.0;
      } else if (astg == 3) {     // release
        aenv -= relRate;
        if (aenv <= 0.0) { aenv = 0.0; astg = 0; }
      }
      vAEnv[v] = aenv;
      vAStage[v] = astg;

      if (astg == 0 && aenv <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- filter AR envelope -----------------------------------
      let fenv: f32 = vFEnv[v];
      let fstg: i32 = vFStage[v];
      if (fstg == 1) {
        fenv += atkRate;
        if (fenv >= 1.0) { fenv = 1.0; fstg = 2; }
      } else if (fstg == 2) {
        fenv = 1.0;
      } else if (fstg == 3) {
        fenv -= relRate;
        if (fenv <= 0.0) { fenv = 0.0; fstg = 0; }
      }
      vFEnv[v] = fenv;
      vFStage[v] = fstg;

      // ---- per-voice LFO value (bipolar -1..1) ------------------
      let lph: f32 = lfoPhase + vLfoOff[v];
      if (lph >= 1.0) lph -= 1.0;
      const lfo: f32 = f32(Mathf.sin(lph * TWO_PI));

      // ---- oscillators (saw + PWM pulse) ------------------------
      // pitch modulation (vibrato) from the matrix
      const pitchRatio: f32 = f32(Mathf.pow(2.0, (lfo * pitchModSemi) / 12.0));
      const baseInc: f32 = (vFreq[v] * pitchRatio) / sr;

      let p1: f32 = vPhase1[v];
      p1 += baseInc; if (p1 >= 1.0) p1 -= 1.0;
      let saw: f32 = 2.0 * p1 - 1.0;
      saw -= polyBlep(p1, baseInc);
      vPhase1[v] = p1;

      // pulse with LFO-driven PWM
      let pw: f32 = 0.5 + lfo * pwmDepth;
      if (pw < 0.05) pw = 0.05;
      if (pw > 0.95) pw = 0.95;
      let p2: f32 = vPhase2[v];
      p2 += baseInc; if (p2 >= 1.0) p2 -= 1.0;
      let sq: f32 = p2 < pw ? 1.0 : -1.0;
      sq += polyBlep(p2, baseInc);
      let p2b: f32 = p2 + (1.0 - pw);
      if (p2b >= 1.0) p2b -= 1.0;
      sq -= polyBlep(p2b, baseInc);
      vPhase2[v] = p2;

      let osc: f32 = saw * 0.6 + sq * 0.45;

      // ---- cutoff: base + filter env + LFO matrix ---------------
      const cutOct: f32 = envOct * fenv + lfo * cutModOct;
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, cutOct));
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

    let mix: f32 = outL * voiceScale * level;

    // one-pole DC blocker: y = x - x1 + R*y1  (R ~ 0.9985 @ 48k)
    const dcOut: f32 = mix - dcX1 + 0.9985 * dcY1;
    dcX1 = mix;
    dcY1 = dcOut;
    mix = dcOut;

    mix = f32(Mathf.tanh(mix * 1.1));

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
