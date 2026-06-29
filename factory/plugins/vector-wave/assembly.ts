// =====================================================================
//  VECTOR WAVE — a polyphonic vector / wave-sequencing synthesizer.
//  Four single-cycle waves are generated in code (no samples) and laid
//  out on the corners of a square morph pad. A Vector X/Y pair bilinearly
//  crossfades between the four corner waves; a slow Wave-Sequence rate
//  steps a rotating offset through the corners so the timbre evolves over
//  time on a single held note. Up to eight voices keyed by noteId, each:
//  two slightly detuned vector-mixed oscillators -> resonant low-pass
//  driven by an ADSR contour. Pure algorithm, no samples, no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_VOICES: i32 = 8;

const TWO_PI: f32 = 6.28318530717959;
const TABLE_SIZE: i32 = 1024;   // single-cycle wavetable length
const TABLE_MASK: i32 = 1023;
const NUM_WAVES: i32 = 4;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// four single-cycle waves, generated at init, laid flat: wave w sample i -> w*TABLE_SIZE + i
const waves: StaticArray<f32> = new StaticArray<f32>(NUM_WAVES * TABLE_SIZE);

let sampleRate: f32 = 48000.0;

// ---- parameter indices (must match spec.json) -----------------------
const P_VECX:    i32 = 0;  // 0..1  -> vector X (corner crossfade)
const P_VECY:    i32 = 1;  // 0..1  -> vector Y (corner crossfade)
const P_SEQRATE: i32 = 2;  // 0..1  -> wave-sequence step rate
const P_CUTOFF:  i32 = 3;  // 0..1  -> low-pass cutoff
const P_ATTACK:  i32 = 4;  // 0..1  -> attack seconds
const P_RELEASE: i32 = 5;  // 0..1  -> release seconds
const P_DETUNE:  i32 = 6;  // 0..1  -> osc pair detune
const P_LEVEL:   i32 = 7;  // 0..1  -> output level

// ---- per-voice state (StaticArrays at module scope, no alloc) -------
const vNote:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // noteId or -1
const vActive: StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while sounding
const vGate:   StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 1 while key held
const vAge:    StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // for oldest-voice stealing

const vFreq:   StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);
const vVel:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES);

const vPhaseA: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc A phase 0..1
const vPhaseB: StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // osc B phase 0..1

const vEnv:    StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // amplitude env
const vStage:  StaticArray<i32> = new StaticArray<i32>(NUM_VOICES); // 0 idle 1 atk 2 sus 3 rel

const vLp:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // 1-pole LP state
const vBp:     StaticArray<f32> = new StaticArray<f32>(NUM_VOICES); // resonance state

let ageCounter: i32 = 0;

// wave-sequence position (advances over time, shared by all voices for a
// coherent evolving pad)
let seqPhase: f32 = 0.0;   // 0..NUM_WAVES, wraps; integer part selects rotation

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;

  // --- generate the four single-cycle corner waves (in code) ---------
  for (let i = 0; i < TABLE_SIZE; i++) {
    const t: f32 = f32(i) / f32(TABLE_SIZE);     // 0..1
    const ph: f32 = TWO_PI * t;

    // wave 0: pure sine (mellow)
    waves[0 * TABLE_SIZE + i] = f32(Mathf.sin(ph));

    // wave 1: triangle (soft hollow)
    let tri: f32 = 4.0 * (t < 0.5 ? t : 1.0 - t) - 1.0;
    waves[1 * TABLE_SIZE + i] = tri;

    // wave 2: band-limited-ish saw via partial sum (bright)
    let saw: f32 = 0.0;
    for (let k = 1; k <= 8; k++) {
      saw += f32(Mathf.sin(ph * f32(k))) / f32(k);
    }
    waves[2 * TABLE_SIZE + i] = saw * 0.55;

    // wave 3: odd-harmonic square/pulse via partial sum (vocal/reedy)
    let sq: f32 = 0.0;
    for (let k = 1; k <= 9; k += 2) {
      sq += f32(Mathf.sin(ph * f32(k))) / f32(k);
    }
    waves[3 * TABLE_SIZE + i] = sq * 0.85;
  }

  for (let v = 0; v < NUM_VOICES; v++) {
    vNote[v] = -1; vActive[v] = 0; vGate[v] = 0; vAge[v] = 0;
    vFreq[v] = 0.0; vVel[v] = 0.0;
    vPhaseA[v] = 0.0; vPhaseB[v] = 0.0;
    vEnv[v] = 0.0; vStage[v] = 0;
    vLp[v] = 0.0; vBp[v] = 0.0;
  }
  ageCounter = 0;
  seqPhase = 0.0;

  params[P_VECX]    = 0.5;
  params[P_VECY]    = 0.5;
  params[P_SEQRATE] = 0.3;
  params[P_CUTOFF]  = 0.6;
  params[P_ATTACK]  = 0.05;
  params[P_RELEASE] = 0.4;
  params[P_DETUNE]  = 0.25;
  params[P_LEVEL]   = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// linear-interpolated single-cycle table read for wave w at phase p (0..1)
@inline function readWave(w: i32, p: f32): f32 {
  const fp: f32 = p * f32(TABLE_SIZE);
  const i0: i32 = i32(fp) & TABLE_MASK;
  const i1: i32 = (i0 + 1) & TABLE_MASK;
  const fr: f32 = fp - f32(i32(fp));
  const base: i32 = w * TABLE_SIZE;
  const a: f32 = waves[base + i0];
  const b: f32 = waves[base + i1];
  return a + (b - a) * fr;
}

// bilinear vector mix of the four corner waves at phase p.
// corners: 0=bottom-left, 2=bottom-right, 1=top-left, 3=top-right.
// rot rotates the corner assignment so the wave-sequence steps timbre.
@inline function vectorSample(p: f32, x: f32, y: f32, rot: i32): f32 {
  // pick corner waves with a rotating offset (the wave-sequence step)
  const wBL: i32 = (0 + rot) & 3;
  const wBR: i32 = (2 + rot) & 3;
  const wTL: i32 = (1 + rot) & 3;
  const wTR: i32 = (3 + rot) & 3;

  const sBL: f32 = readWave(wBL, p);
  const sBR: f32 = readWave(wBR, p);
  const sTL: f32 = readWave(wTL, p);
  const sTR: f32 = readWave(wTR, p);

  const bottom: f32 = sBL + (sBR - sBL) * x;
  const top: f32    = sTL + (sTR - sTL) * x;
  return bottom + (top - bottom) * y;
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
  vStage[slot]  = 1;   // attack
  vEnv[slot]    = 0.0;
  vPhaseA[slot] = 0.0;
  vPhaseB[slot] = 0.13;  // slight offset so detuned pair beats from the start
  vLp[slot]     = 0.0;
  vBp[slot]     = 0.0;
  vAge[slot]    = ageCounter++;
}

export function noteOff(id: i32): void {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (vActive[i] == 1 && vGate[i] == 1 && vNote[i] == id) {
      vGate[i] = 0;
      vStage[i] = 3;  // release
    }
  }
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;

  // ---- read + map parameters once per block -------------------------
  const vecX: f32 = clampf(params[P_VECX], 0.0, 1.0);
  const vecY: f32 = clampf(params[P_VECY], 0.0, 1.0);
  const seqN: f32 = clampf(params[P_SEQRATE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);

  const atkS: f32 = 0.002 + clampf(params[P_ATTACK], 0.0, 1.0) * 2.0;
  const relS: f32 = 0.005 + clampf(params[P_RELEASE], 0.0, 1.0) * 3.0;
  const atkRate: f32 = 1.0 / (atkS * sr);
  const relRate: f32 = 1.0 / (relS * sr);

  // detune in semitone fraction -> beating between the osc pair
  const detSemi: f32 = clampf(params[P_DETUNE], 0.0, 1.0) * 0.4;
  const ratioUp: f32   = f32(Mathf.pow(2.0, detSemi / 12.0));
  const ratioDown: f32 = f32(Mathf.pow(2.0, -detSemi / 12.0));

  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.1;

  // base cutoff in Hz, exponential 80 Hz .. ~15 kHz
  const baseHz: f32 = 80.0 * f32(Mathf.pow(180.0, cutoffN));

  // wave-sequence step rate: 0 -> very slow (~0.05 steps/s), 1 -> ~12 steps/s
  const stepsPerSec: f32 = 0.05 + seqN * seqN * 12.0;
  const seqInc: f32 = stepsPerSec / sr;
  // sequence depth scales the pad orbit with the rate, so 0 = static timbre
  const seqAmt: f32 = seqN;

  // headroom for summed voices
  const voiceScale: f32 = 0.42;

  for (let f = 0; f < n; f++) {
    // advance the shared wave-sequence position
    seqPhase += seqInc;
    while (seqPhase >= f32(NUM_WAVES)) seqPhase -= f32(NUM_WAVES);
    const rot: i32 = i32(seqPhase) & 3;
    // smooth crossfade between this step and the next for click-free stepping
    const stepFrac: f32 = seqPhase - f32(i32(seqPhase));

    // the wave-sequence also walks the vector position around the pad so the
    // timbre evolves even when the joystick sits dead-centre. A small circular
    // orbit keeps it within bounds and guarantees an audible step animation.
    const ang: f32 = (seqPhase / f32(NUM_WAVES)) * TWO_PI;
    const orbit: f32 = 0.35 * seqAmt;
    const seqX: f32 = clampf(vecX + orbit * f32(Mathf.cos(ang)), 0.0, 1.0);
    const seqY: f32 = clampf(vecY + orbit * f32(Mathf.sin(ang)), 0.0, 1.0);

    let outL: f32 = 0.0;

    for (let v = 0; v < NUM_VOICES; v++) {
      if (vActive[v] == 0) continue;

      // ---- amplitude envelope (A / sustain / R) -----------------
      let env: f32 = vEnv[v];
      let stg: i32 = vStage[v];
      if (stg == 1) {            // attack
        env += atkRate;
        if (env >= 1.0) { env = 1.0; stg = 2; }
      } else if (stg == 2) {     // sustain (held)
        env = 1.0;
      } else if (stg == 3) {     // release
        env -= relRate;
        if (env <= 0.0) { env = 0.0; stg = 0; }
      }
      vEnv[v] = env;
      vStage[v] = stg;

      if (stg == 0 && env <= 0.0) {
        vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
        continue;
      }

      // ---- two detuned vector oscillators -----------------------
      const baseInc: f32 = vFreq[v] / sr;
      const incA: f32 = baseInc * ratioDown;
      const incB: f32 = baseInc * ratioUp;

      let pA: f32 = vPhaseA[v];
      pA += incA; if (pA >= 1.0) pA -= 1.0;
      vPhaseA[v] = pA;

      let pB: f32 = vPhaseB[v];
      pB += incB; if (pB >= 1.0) pB -= 1.0;
      vPhaseB[v] = pB;

      // vector mix at the current sequence step, crossfaded into the next.
      // seqX/seqY orbit the joystick over time so the sequence-rate animates it.
      const aCur: f32 = vectorSample(pA, seqX, seqY, rot);
      const aNxt: f32 = vectorSample(pA, seqX, seqY, (rot + 1) & 3);
      const oscA: f32 = aCur + (aNxt - aCur) * stepFrac;

      const bCur: f32 = vectorSample(pB, seqX, seqY, rot);
      const bNxt: f32 = vectorSample(pB, seqX, seqY, (rot + 1) & 3);
      const oscB: f32 = bCur + (bNxt - bCur) * stepFrac;

      let osc: f32 = (oscA + oscB) * 0.5;

      // ---- resonant 2-pole-ish low-pass (state-variable lite) ---
      let g: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * baseHz / sr));
      if (g > 0.99) g = 0.99;
      const res: f32 = 1.2;  // gentle fixed resonance for character
      let lp: f32 = vLp[v];
      let bp: f32 = vBp[v];
      const hp: f32 = osc - lp - res * bp;
      bp += g * hp;
      lp += g * bp;
      vBp[v] = bp;
      vLp[v] = lp;

      let voice: f32 = lp * env * vVel[v];
      outL += voice;
    }

    // ---- sum + soft saturate ------------------------------------
    let mix: f32 = outL * voiceScale * level;
    mix = f32(Mathf.tanh(mix));

    outBuf[f] = mix;
    outBuf[MAX_FRAMES + f] = mix;
  }
}
