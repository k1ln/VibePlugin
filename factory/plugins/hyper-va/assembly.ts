// =====================================================================
//  HYPER VA — a modern hypersaw virtual-analog polyphonic synthesizer.
//  Lineage of the big digital VA leads/pads: each of 8 voices runs a
//  SUPERSAW oscillator — 7 detuned band-limited saws stacked around the
//  played pitch — plus a square sub an octave down. The stack feeds a
//  bright resonant 4-pole low-pass driven by its own envelope, then an
//  amplitude AR envelope. The 7 saws are panned across the stereo field
//  by Spread to bloom into a huge, shimmering trance lead/pad. Bright
//  DIGITAL character (no vintage warmth/drift). Pure algorithm, no
//  samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;
const NUM_SAWS: i32 = 7;          // detuned saws per supersaw stack

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_DETUNE:  i32 = 0;  // 0..1  -> supersaw detune spread
const P_CUTOFF:  i32 = 1;  // 0..1  -> base filter cutoff
const P_RESO:    i32 = 2;  // 0..1  -> filter resonance
const P_ENVAMT:  i32 = 3;  // 0..1  -> filter envelope amount
const P_SPREAD:  i32 = 4;  // 0..1  -> stereo width of the saw stack
const P_ATTACK:  i32 = 5;  // 0..1  -> seconds
const P_RELEASE: i32 = 6;  // 0..1  -> seconds
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- relative detune offsets of the 7 saws (centre = 0) --------------
// JP-style asymmetric spread; scaled by the Detune param at run time.
const sawOffset: StaticArray<f32> = new StaticArray<f32>(NUM_SAWS);
// fixed stereo pan position for each saw (-1..+1), scaled by Spread.
const sawPanBase: StaticArray<f32> = new StaticArray<f32>(NUM_SAWS);

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// supersaw phases: NUM_VOICES * NUM_SAWS, plus a sub phase per voice
const vSawPhase: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES * NUM_SAWS);
const vSubPhase: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

// amplitude AR envelope
const vAEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vAStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel
// filter AR envelope
const vFEnv:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFStage: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES);

// 4-pole low-pass state per voice, run on the LEFT and RIGHT sums.
const vFL0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFL1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFL2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFL3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFR0: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFR1: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFR2: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vFR3: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

let ageCounter: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;

  // symmetric, slightly irregular detune offsets so beating is rich.
  sawOffset[0] = -1.00;
  sawOffset[1] = -0.62;
  sawOffset[2] = -0.27;
  sawOffset[3] =  0.00;   // centre saw, no detune
  sawOffset[4] =  0.31;
  sawOffset[5] =  0.66;
  sawOffset[6] =  1.00;

  // alternating L/R pan layout; centre saw stays centred.
  sawPanBase[0] = -1.00;
  sawPanBase[1] =  0.66;
  sawPanBase[2] = -0.40;
  sawPanBase[3] =  0.00;
  sawPanBase[4] =  0.40;
  sawPanBase[5] = -0.66;
  sawPanBase[6] =  1.00;

  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vSubPhase[v] = 0.0;
    vAEnv[v] = 0.0; vAStage[v] = 0;
    vFEnv[v] = 0.0; vFStage[v] = 0;
    vFL0[v] = 0.0; vFL1[v] = 0.0; vFL2[v] = 0.0; vFL3[v] = 0.0;
    vFR0[v] = 0.0; vFR1[v] = 0.0; vFR2[v] = 0.0; vFR3[v] = 0.0;
    for (let s = 0; s < NUM_SAWS; s++) {
      // spread starting phases so the stack does not start phase-locked
      vSawPhase[v * NUM_SAWS + s] = f32(s) * 0.137;
    }
  }
  ageCounter = 0;

  params[P_DETUNE]  = 0.45;
  params[P_CUTOFF]  = 0.6;
  params[P_RESO]    = 0.3;
  params[P_ENVAMT]  = 0.55;
  params[P_SPREAD]  = 0.7;
  params[P_ATTACK]  = 0.05;
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
  vSubPhase[slot] = 0.0;
  vFL0[slot] = 0.0; vFL1[slot] = 0.0; vFL2[slot] = 0.0; vFL3[slot] = 0.0;
  vFR0[slot] = 0.0; vFR1[slot] = 0.0; vFR2[slot] = 0.0; vFR3[slot] = 0.0;
  for (let s = 0; s < NUM_SAWS; s++) {
    vSawPhase[slot * NUM_SAWS + s] = f32(s) * 0.137;
  }
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

// polyBLEP correction removes the worst aliasing on saw edges
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
  const detuneN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32   = clampf(params[P_RESO], 0.0, 1.0);
  const envAmt: f32  = clampf(params[P_ENVAMT], 0.0, 1.0);
  const spreadN: f32 = clampf(params[P_SPREAD], 0.0, 1.0);
  const level: f32   = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0)  * 2.0;
  const relS: f32 = 0.010 + clampf(params[P_RELEASE], 0.0, 1.0) * 3.0;

  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // detune amount: up to ~ +/- 0.55 semitone at the extreme saws -> huge
  const detSemi: f32 = detuneN * 0.55;

  // base cutoff in Hz, exponential 80 Hz .. ~18 kHz (bright digital top)
  const baseHz: f32 = 80.0 * f32(Mathf.pow(225.0, cutoffN));
  // envelope sweeps cutoff up by up to ~6.5 octaves
  const envOct: f32 = envAmt * 6.5;
  // resonance feedback 0..~3.8
  const reso: f32 = resoN * 3.8;

  // per-saw equal-power pan gains depend only on params -> compute once.
  // (kept in locals; NUM_SAWS is small and fixed.)
  const sp: f32 = spreadN;

  // headroom: 8 voices * (supersaw+sub) summed -> normalise.
  // supersaw normalised internally to ~unit; voice gain modest.
  const voiceScale: f32 = 0.34;

  for (let f = 0; f < n; f++) {
    let outL: f32 = 0.0;
    let outR: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude AR envelope --------------------------------
      let aenv: f32 = vAEnv[v];
      let astg: i32 = vAStage[v];
      if (astg == 1) {            // attack
        aenv += atkRate;
        if (aenv >= 1.0) { aenv = 1.0; astg = 2; }
      } else if (astg == 2) {     // sustain (held at 1)
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

      // ---- supersaw: 7 detuned saws, panned across the field ----
      const baseInc: f32 = vFreq[v] / sr;
      const phBase: i32 = v * NUM_SAWS;

      let sawL: f32 = 0.0;
      let sawR: f32 = 0.0;

      for (let s = 0; s < NUM_SAWS; s++) {
        // detune ratio for this saw
        const semi: f32 = sawOffset[s] * detSemi;
        const ratio: f32 = f32(Mathf.pow(2.0, semi / 12.0));
        const inc: f32 = baseInc * ratio;

        let p: f32 = vSawPhase[phBase + s];
        p += inc; if (p >= 1.0) p -= 1.0;
        let saw: f32 = 2.0 * p - 1.0;
        saw -= polyBlep(p, inc);
        vSawPhase[phBase + s] = p;

        // the centre saw is a touch louder for a defined pitch core
        const sg: f32 = s == 3 ? 0.85 : 0.6;

        // pan: equal-power, position = base pan * spread
        const pan: f32 = sawPanBase[s] * sp;            // -1..+1
        const ang: f32 = (pan * 0.5 + 0.5) * (PI * 0.5); // 0..pi/2
        const gl: f32 = f32(Mathf.cos(ang));
        const gr: f32 = f32(Mathf.sin(ang));

        const sv: f32 = saw * sg;
        sawL += sv * gl;
        sawR += sv * gr;
      }

      // normalise the stack (sum of ~7 weighted saws)
      const norm: f32 = 0.32;
      sawL *= norm;
      sawR *= norm;

      // ---- square sub one octave down (mono, centred) -----------
      let subp: f32 = vSubPhase[v];
      const subInc: f32 = baseInc * 0.5;
      subp += subInc; if (subp >= 1.0) subp -= 1.0;
      vSubPhase[v] = subp;
      const sub: f32 = subp < 0.5 ? 0.28 : -0.28;

      let inL: f32 = sawL + sub;
      let inR: f32 = sawR + sub;

      // ---- bright resonant 4-pole low-pass (per channel) --------
      let fc: f32 = baseHz * f32(Mathf.pow(2.0, envOct * fenv));
      if (fc > sr * 0.45) fc = sr * 0.45;
      if (fc < 20.0) fc = 20.0;

      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * fc / sr));
      if (g > 0.99) g = 0.99;

      // LEFT ladder
      let l0: f32 = vFL0[v];
      let l1: f32 = vFL1[v];
      let l2: f32 = vFL2[v];
      let l3: f32 = vFL3[v];
      let il: f32 = inL - reso * l3;
      il = f32(Mathf.tanh(il));
      l0 += g * (il - l0);
      l1 += g * (l0 - l1);
      l2 += g * (l1 - l2);
      l3 += g * (l2 - l3);
      vFL0[v] = l0; vFL1[v] = l1; vFL2[v] = l2; vFL3[v] = l3;

      // RIGHT ladder
      let r0: f32 = vFR0[v];
      let r1: f32 = vFR1[v];
      let r2: f32 = vFR2[v];
      let r3: f32 = vFR3[v];
      let ir: f32 = inR - reso * r3;
      ir = f32(Mathf.tanh(ir));
      r0 += g * (ir - r0);
      r1 += g * (r0 - r1);
      r2 += g * (r1 - r2);
      r3 += g * (r2 - r3);
      vFR0[v] = r0; vFR1[v] = r1; vFR2[v] = r2; vFR3[v] = r3;

      const amp: f32 = aenv * vVel[v];
      outL += l3 * amp;
      outR += r3 * amp;
    }

    // ---- sum + gentle soft clip + output level ------------------
    let mixL: f32 = outL * voiceScale;
    let mixR: f32 = outR * voiceScale;
    mixL = f32(Mathf.tanh(mixL * 1.1)) * level;
    mixR = f32(Mathf.tanh(mixR * 1.1)) * level;

    outBuf[f] = mixL;
    outBuf[MAX_FRAMES + f] = mixR;
  }
}
