// =====================================================================
//  HALO ENSEMBLE — a lush preset ensemble poly (Korg Lambda / Sigma
//  lineage). A fully-polyphonic divide-down-style string/organ machine:
//  each of 8 voices runs two detuned oscillators morphed by TONE from
//  bowed strings (saw) toward hollow organ (pulse), through a low-pass,
//  and the whole poly mix passes into the signature ENSEMBLE — a three-
//  tap BBD-style modulated chorus that gives the wide, shimmering
//  string-machine wash. Shimmer widens the voice detune.
//  Controls: Tone, Cutoff, Attack, Ensemble, Shimmer, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;
const TAU: f32 = 6.2831853;
const CH_LEN: i32 = 4096;                 // chorus delay line (~85ms @48k)

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const chLine: StaticArray<f32> = new StaticArray<f32>(CH_LEN);

const vA: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vB: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
let sampleRate: f32 = 48000.0;
let chWrite: i32 = 0;
let lfo1: f32 = 0.0; let lfo2: f32 = 1.7; let lfo3: f32 = 3.9;
let lp: f32 = 0.0; let bp: f32 = 0.0;

const P_TONE: i32 = 0; const P_CUTOFF: i32 = 1; const P_ATTACK: i32 = 2; const P_ENS: i32 = 3; const P_SHIMMER: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0; chWrite = 0; lp = 0.0; bp = 0.0;
  lfo1 = 0.0; lfo2 = 1.7; lfo3 = 3.9;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vA[i] = 0.0; vB[i] = 0.0; vAmp[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vNote[i] = -1; }
  for (let i = 0; i < CH_LEN; i++) chLine[i] = 0.0;
  params[P_TONE] = 0.35; params[P_CUTOFF] = 0.6; params[P_ATTACK] = 0.3; params[P_ENS] = 0.6; params[P_SHIMMER] = 0.5; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vA[slot] = 0.0; vB[slot] = 0.0; vAmp[slot] = 0.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

@inline function readCh(delaySamp: f32): f32 {
  let rp: f32 = f32(chWrite) - delaySamp;
  while (rp < 0.0) rp += f32(CH_LEN);
  while (rp >= f32(CH_LEN)) rp -= f32(CH_LEN);
  const i0: i32 = i32(rp); let i1: i32 = i0 + 1; if (i1 >= CH_LEN) i1 = 0;
  const frac: f32 = rp - f32(i0);
  return chLine[i0] + (chLine[i1] - chLine[i0]) * frac;
}

export function process(n: i32): void {
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const attackN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const ensN: f32 = clampf(params[P_ENS], 0.0, 1.0);
  const shimmerN: f32 = clampf(params[P_SHIMMER], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / ((0.005 + attackN * 0.5) * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.4 * sampleRate)));
  const det: f32 = 1.0 + shimmerN * 0.03;
  const pulseMix: f32 = toneN * 0.7;
  const baseCut: f32 = 70.0 * f32(Mathf.exp(cutoffN * 5.0));
  const k: f32 = 1.3;
  let fc: f32 = baseCut; if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
  const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
  const a1c: f32 = 1.0 / (1.0 + g * (g + k));

  const l1inc: f32 = 0.6 / sampleRate * TAU;
  const l2inc: f32 = 0.87 / sampleRate * TAU;
  const l3inc: f32 = 1.13 / sampleRate * TAU;
  const chBase: f32 = 0.011 * sampleRate;                 // ~11ms centre
  const chDepth: f32 = ensN * 0.006 * sampleRate;         // sweep depth
  const wet: f32 = ensN;
  const out: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] >= 1.0) { vAmp[s] = 1.0; vSt[s] = 3; } }
      else if (vSt[s] == 3) { /* sustain while held */ }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      let a: f32 = vA[s] + fr / sampleRate; if (a >= 1.0) a -= 1.0; vA[s] = a;
      let b: f32 = vB[s] + (fr * det) / sampleRate; if (b >= 1.0) b -= 1.0; vB[s] = b;
      const saw: f32 = (a * 2.0 - 1.0 + b * 2.0 - 1.0) * 0.5;
      const pulse: f32 = (a < 0.5 ? 1.0 : -1.0);
      const wave: f32 = saw * (1.0 - pulseMix) + pulse * pulseMix;
      mix += wave * vAmp[s] * vVel[s];
    }
    mix *= 0.5;
    // low-pass the raw poly
    const hp: f32 = (mix - (g + k) * bp - lp) * a1c;
    const bpN: f32 = g * hp + bp; const lpN: f32 = g * bpN + lp; bp = bpN; lp = lpN;
    const dry: f32 = lpN;

    // write to chorus line, read three modulated taps
    chLine[chWrite] = dry;
    lfo1 += l1inc; if (lfo1 > TAU) lfo1 -= TAU;
    lfo2 += l2inc; if (lfo2 > TAU) lfo2 -= TAU;
    lfo3 += l3inc; if (lfo3 > TAU) lfo3 -= TAU;
    const t1: f32 = readCh(chBase + chDepth * (1.0 + f32(Mathf.sin(lfo1))));
    const t2: f32 = readCh(chBase * 1.6 + chDepth * (1.0 + f32(Mathf.sin(lfo2))));
    const t3: f32 = readCh(chBase * 2.2 + chDepth * (1.0 + f32(Mathf.sin(lfo3))));
    const ensL: f32 = dry * (1.0 - wet * 0.5) + (t1 + t3) * wet * 0.6;
    const ensR: f32 = dry * (1.0 - wet * 0.5) + (t2 + t1) * wet * 0.6;

    // soft-clip so full chords stay clean while single notes are present
    let oL: f32 = f32(Mathf.tanh(ensL * out * 1.6)); let oR: f32 = f32(Mathf.tanh(ensR * out * 1.6));
    outBuf[i] = oL; outBuf[MAX_FRAMES + i] = oR;
    chWrite += 1; if (chWrite >= CH_LEN) chWrite = 0;
  }
}
