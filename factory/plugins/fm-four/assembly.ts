// =====================================================================
//  FM FOUR — programmable 4-operator FM synth (DX-lineage)
//  A general 4-operator phase-modulation engine, NOT a fixed tine EP.
//  Four sine operators (OP1..OP4) are wired by a selectable ALGORITHM:
//
//    0 STACK    : OP4 -> OP3 -> OP2 -> OP1(carrier)   (deep, clangy bass)
//    1 PAIR     : OP4 -> OP3(carrier) + OP2 -> OP1(carrier)  (two FM pairs)
//    2 PARALLEL : OP4,OP3,OP2 all -> OP1(carrier)     (rich additive-ish)
//
//  The top modulator(s) run at a selectable RATIO; FM DEPTH sets the
//  modulation index; OP-FEEDBACK self-modulates the top operator for the
//  gritty 80s edge. A single ADSR-ish env (Attack + Release, with a fast
//  body decay) shapes BOTH the amplitude AND the modulation index, so the
//  brightness evolves over the note like a real DX patch.
//  Pure algorithm: all f32, no allocation in process(), no host imports.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const MAX_VOICES: i32 = 12;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const TWO_PI: f32 = 6.2831853071795864769;

// ---- per-voice state (parallel StaticArrays, no allocation in process) ----
const vActive: StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = in use
const vGate:   StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // 1 = key held
const vNote:   StaticArray<i32> = new StaticArray<i32>(MAX_VOICES); // note id
const vFreq:   StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // carrier Hz
const vVel:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // 0..1
const vAmp:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // amp-env level
const vAge:    StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // LRU voice-steal
// four operator phases per voice (radians)
const vP1: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);
const vP2: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);
const vP3: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);
const vP4: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES);
const vFb: StaticArray<f32> = new StaticArray<f32>(MAX_VOICES); // feedback memory (top op output)

let ageCounter: f32 = 0.0;

// ---- parameter indices (MUST match spec.json) ----
const P_RATIO: i32 = 0; // modulator ratio        0..1 -> 0.5 .. 12
const P_DEPTH: i32 = 1; // FM depth / mod index   0..1 -> 0 .. ~10
const P_FB:    i32 = 2; // operator feedback       0..1
const P_ALGO:  i32 = 3; // algorithm select (stepped 0..2)
const P_ATK:   i32 = 4; // attack                  0..1
const P_REL:   i32 = 5; // release                 0..1
const P_LEVEL: i32 = 6; // output level            0..1

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let v = 0; v < MAX_VOICES; v++) {
    vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
    vFreq[v] = 0.0; vVel[v] = 0.0; vAmp[v] = 0.0; vAge[v] = 0.0;
    vP1[v] = 0.0; vP2[v] = 0.0; vP3[v] = 0.0; vP4[v] = 0.0; vFb[v] = 0.0;
  }
  ageCounter = 0.0;
  params[P_RATIO] = 0.32;  // ~ ratio 3.0  (clangy)
  params[P_DEPTH] = 0.55;
  params[P_FB]    = 0.25;
  params[P_ALGO]  = 0.0;   // STACK
  params[P_ATK]   = 0.02;
  params[P_REL]   = 0.45;
  params[P_LEVEL] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function noteOn(id: i32, freq: f32, velocity: f32): void {
  if (freq <= 0.0) freq = 1.0;
  let slot: i32 = -1;
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] != 0 && vNote[v] == id) { slot = v; break; }
  }
  if (slot < 0) {
    for (let v = 0; v < MAX_VOICES; v++) {
      if (vActive[v] == 0) { slot = v; break; }
    }
  }
  if (slot < 0) {
    let oldest: f32 = vAge[0]; slot = 0;
    for (let v = 1; v < MAX_VOICES; v++) {
      if (vAge[v] < oldest) { oldest = vAge[v]; slot = v; }
    }
  }
  ageCounter += 1.0;
  vActive[slot] = 1;
  vGate[slot]   = 1;
  vNote[slot]   = id;
  vFreq[slot]   = freq;
  vVel[slot]    = clampf(velocity, 0.0, 1.0);
  vAmp[slot]    = 0.0;
  vP1[slot] = 0.0; vP2[slot] = 0.0; vP3[slot] = 0.0; vP4[slot] = 0.0; vFb[slot] = 0.0;
  vAge[slot]    = ageCounter;
}

export function noteOff(id: i32): void {
  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] != 0 && vNote[v] == id) vGate[v] = 0;
  }
}

export function process(n: i32): void {
  // ---- resolve params once per block ----
  const ratio: f32  = 0.5 + clampf(params[P_RATIO], 0.0, 1.0) * 11.5;   // 0.5 .. 12
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const fbN: f32    = clampf(params[P_FB], 0.0, 1.0);
  const atkN: f32   = clampf(params[P_ATK], 0.0, 1.0);
  const relN: f32   = clampf(params[P_REL], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0) * 0.8;
  // algorithm: stepped 0..2 (round, clamp)
  let algo: i32 = i32(clampf(params[P_ALGO], 0.0, 2.0) + 0.5);
  if (algo < 0) algo = 0; if (algo > 2) algo = 2;

  // peak modulation index — strong enough to clearly move bell<->bass<->pad
  const peakIndex: f32 = depthN * 10.0;
  // feedback amount (radians of self-PM on the top operator)
  const fbAmt: f32 = fbN * fbN * 3.0;

  // amp attack: 1 ms .. 400 ms
  const atkSec: f32 = 0.001 + atkN * atkN * 0.399;
  const atkCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (atkSec * sampleRate)));
  // release: 40 ms .. ~4 s
  const relSec: f32 = 0.04 + relN * relN * 3.96;
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (relSec * sampleRate)));
  // body decay while held (so brightness/level evolves; longer than release)
  const decSec: f32 = relSec * 2.5 + 0.5;
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (decSec * sampleRate)));

  // modulation-index envelope follows the amp env shape but with a faster
  // settle, so the patch starts bright and mellows — the DX "evolving" feel.
  const idxDecCoef: f32 = f32(Mathf.exp(-1.0 / ((relSec * 0.6 + 0.05) * sampleRate)));

  const invSr: f32 = 1.0 / sampleRate;

  // ---- clear output block ----
  for (let f = 0; f < n; f++) {
    outBuf[f] = 0.0;
    outBuf[MAX_FRAMES + f] = 0.0;
  }

  for (let v = 0; v < MAX_VOICES; v++) {
    if (vActive[v] == 0) continue;

    const f0: f32 = vFreq[v];
    const vel: f32 = vVel[v];
    const gate: i32 = vGate[v];

    // operator increments. carrier(s) at f0, modulators at f0*ratio.
    const incCar: f32 = TWO_PI * f0 * invSr;
    const incMod: f32 = TWO_PI * f0 * ratio * invSr;

    let p1: f32 = vP1[v]; // OP1 carrier
    let p2: f32 = vP2[v]; // OP2
    let p3: f32 = vP3[v]; // OP3
    let p4: f32 = vP4[v]; // OP4 top modulator (carries feedback)
    let fb: f32 = vFb[v];
    let amp: f32 = vAmp[v];

    // per-voice mod-index env: starts at velocity-scaled peak, decays
    // We track it implicitly off a separate running multiplier per sample.
    // Use vFb? no — reuse a local that decays each sample from 1.
    // Re-derive its current value from amp would be wrong; keep simple: a
    // local decaying scalar restarted each block is not persistent, so we
    // fold the index env into amp shape: index = peak * (idxEnvFloor + ...).
    // Simpler + persistent: drive index by a normalized amp (amp/vel).

    const ampTarget: f32 = vel;
    let reachedAtk: bool = amp >= ampTarget * 0.999 || ampTarget <= 0.0001;

    for (let f = 0; f < n; f++) {
      // amp envelope
      if (gate != 0 && !reachedAtk) {
        amp += atkCoef * (ampTarget - amp);
        if (amp >= ampTarget * 0.999) { amp = ampTarget; reachedAtk = true; }
      } else if (gate != 0) {
        amp *= decCoef;
      } else {
        amp *= relCoef;
      }

      // modulation index evolves: brighter at the start of the note, then
      // mellows. Normalized envelope (amp/vel) ^ shaping gives the evolution;
      // velocity also opens the index (harder hits = brighter).
      const normAmp: f32 = vel > 0.0001 ? amp / vel : amp;
      const idxEnv: f32 = 0.25 + 0.75 * normAmp;        // 1.0 at peak -> 0.25 tail
      const index: f32 = peakIndex * idxEnv * (0.5 + 0.5 * vel);

      // ---- operator outputs (sine) ----
      // top operator OP4 with self-feedback
      const op4: f32 = Mathf.sin(p4 + fb * fbAmt);
      fb = op4; // store for next-sample feedback

      let s: f32;
      if (algo == 0) {
        // STACK: OP4 -> OP3 -> OP2 -> OP1
        const op3: f32 = Mathf.sin(p3 + op4 * index);
        const op2: f32 = Mathf.sin(p2 + op3 * index);
        s = Mathf.sin(p1 + op2 * index);
      } else if (algo == 1) {
        // PAIR: (OP4->OP3) + (OP2->OP1), two carriers summed
        const op3: f32 = Mathf.sin(p3 + op4 * index);   // carrier A
        const op1: f32 = Mathf.sin(p1 + Mathf.sin(p2) * index); // OP2->OP1 carrier B
        s = (op3 + op1) * 0.5;
      } else {
        // PARALLEL: OP4 + OP3 + OP2 all modulate OP1 carrier
        const m: f32 = (op4 + Mathf.sin(p3) + Mathf.sin(p2)) * 0.5;
        s = Mathf.sin(p1 + m * index);
      }

      s *= amp;
      outBuf[f] += s;

      // advance phases. carriers at incCar; modulators (p2,p3,p4) at incMod.
      // In PAIR, p3 is a carrier so it runs at incCar; p1 always carrier.
      p1 += incCar; if (p1 >= TWO_PI) p1 -= TWO_PI;
      if (algo == 1) {
        p3 += incCar; if (p3 >= TWO_PI) p3 -= TWO_PI;   // carrier A
        p4 += incMod; if (p4 >= TWO_PI) p4 -= TWO_PI;   // modulates A
        p2 += incMod; if (p2 >= TWO_PI) p2 -= TWO_PI;   // modulates B
      } else {
        p2 += incMod; if (p2 >= TWO_PI) p2 -= TWO_PI;
        p3 += incMod; if (p3 >= TWO_PI) p3 -= TWO_PI;
        p4 += incMod; if (p4 >= TWO_PI) p4 -= TWO_PI;
      }
    }

    vP1[v] = p1; vP2[v] = p2; vP3[v] = p3; vP4[v] = p4; vFb[v] = fb;
    vAmp[v] = amp;

    if (gate == 0 && amp < 0.00008) {
      vActive[v] = 0; vGate[v] = 0; vNote[v] = -1;
    }
  }

  // ---- output level + soft safety limit, copy mono to stereo ----
  for (let f = 0; f < n; f++) {
    let s: f32 = outBuf[f] * level;
    if (s > 1.2) s = 1.2; else if (s < -1.2) s = -1.2;
    s = f32(s - 0.16666667 * s * s * s);   // gentle soft clip, peak < 1.0
    outBuf[f] = s;
    outBuf[MAX_FRAMES + f] = s;
  }
}
