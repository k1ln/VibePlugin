// =====================================================================
//  DIVIDE ENSEMBLE — a divide-down STRING + ORGAN machine (Roland RS-09
//  / Logan String Melody lineage). Distinct from the lush Solina/Crumar
//  string ensembles: it blends a STRINGS voice (sawtooth) and an ORGAN
//  voice (square, divide-down) per key, with slow attack/release and a
//  wide ENSEMBLE chorus. Fully polyphonic (12 voices). Controls: Strings,
//  Organ, Attack, Release, Ensemble, Level. No samples, no host imports,
//  no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 12;
const CH_LEN: i32 = 4096;
const CH_MASK: i32 = CH_LEN - 1;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vP1: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vP2: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;

const chL: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
const chR: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
let chW: i32 = 0; let chPh: f32 = 0.0;
let sampleRate: f32 = 48000.0;

const P_STR: i32 = 0;
const P_ORG: i32 = 1;
const P_ATK: i32 = 2;
const P_REL: i32 = 3;
const P_ENS: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vNext = 0; chW = 0; chPh = 0.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vP1[i] = 0.0; vP2[i] = 0.0; vAmp[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vNote[i] = -1; }
  for (let i = 0; i < CH_LEN; i++) { chL[i] = 0.0; chR[i] = 0.0; }
  params[P_STR] = 0.7; params[P_ORG] = 0.4; params[P_ATK] = 0.3; params[P_REL] = 0.5; params[P_ENS] = 0.6; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vP1[slot] = 0.0; vP2[slot] = 0.0; vAmp[slot] = 0.0; vSt[slot] = 1; vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const strN: f32 = clampf(params[P_STR], 0.0, 1.0);
  const orgN: f32 = clampf(params[P_ORG], 0.0, 1.0);
  const atkN: f32 = clampf(params[P_ATK], 0.0, 1.0);
  const relN: f32 = clampf(params[P_REL], 0.0, 1.0);
  const ensN: f32 = clampf(params[P_ENS], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / ((0.01 + atkN * atkN * 1.2) * sampleRate);
  const relSec: f32 = 0.05 + relN * relN * 2.0;
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (relSec * sampleRate)));
  const chDepth: f32 = (0.4 + ensN * 0.6) * 0.006 * sampleRate;
  const chBase: f32 = 0.008 * sampleRate;
  const chMix: f32 = 0.3 + ensN * 0.6;
  const norm: f32 = 1.0 / (strN + orgN + 0.2);
  const out: f32 = level * 0.42;

  for (let i = 0; i < n; i++) {
    let mono: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      let p1: f32 = vP1[s] + fr / sampleRate; if (p1 >= 1.0) p1 -= 1.0; vP1[s] = p1;
      let p2: f32 = vP2[s] + fr / sampleRate; if (p2 >= 1.0) p2 -= 1.0; vP2[s] = p2;
      const saw: f32 = p1 * 2.0 - 1.0;          // strings
      const sq: f32 = p2 < 0.5 ? 0.7 : -0.7;    // organ (divide-down square)
      const v: f32 = (saw * strN + sq * orgN) * norm;
      mono += v * vAmp[s] * vVel[s];
    }
    // 3-voice ensemble chorus into stereo
    chL[chW] = mono; chR[chW] = mono;
    chPh += 0.9 / sampleRate * 6.2831853; if (chPh > 6.2831853) chPh -= 6.2831853;
    const d1: f32 = chBase + chDepth * (0.5 + 0.5 * f32(Mathf.sin(chPh)));
    const d2: f32 = chBase + chDepth * (0.5 + 0.5 * f32(Mathf.sin(chPh + 2.094)));
    const d3: f32 = chBase + chDepth * (0.5 + 0.5 * f32(Mathf.sin(chPh + 4.188)));
    const r1: f32 = f32(chW) - d1; let i1: i32 = i32(r1); const fa: f32 = r1 - f32(i1);
    const r2: f32 = f32(chW) - d2; let i2: i32 = i32(r2); const fbb: f32 = r2 - f32(i2);
    const r3: f32 = f32(chW) - d3; let i3: i32 = i32(r3); const fc: f32 = r3 - f32(i3);
    const c1: f32 = chL[i1 & CH_MASK] + (chL[(i1 + 1) & CH_MASK] - chL[i1 & CH_MASK]) * fa;
    const c2: f32 = chL[i2 & CH_MASK] + (chL[(i2 + 1) & CH_MASK] - chL[i2 & CH_MASK]) * fbb;
    const c3: f32 = chR[i3 & CH_MASK] + (chR[(i3 + 1) & CH_MASK] - chR[i3 & CH_MASK]) * fc;
    chW = (chW + 1) & CH_MASK;
    let l: f32 = (mono + (c1 + c3) * 0.5 * chMix) * out;
    let r: f32 = (mono + (c2 + c3) * 0.5 * chMix) * out;
    if (l > 1.4) l = 1.4; else if (l < -1.4) l = -1.4;
    if (r > 1.4) r = 1.4; else if (r < -1.4) r = -1.4;
    outBuf[i] = l; outBuf[MAX_FRAMES + i] = r;
  }
}
