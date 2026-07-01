// =====================================================================
//  HEX GLOW — a 6-voice single-VCO poly with a built-in PHASER (Korg
//  Polysix lineage). One VCO (saw) + square sub per voice, a resonant
//  low-pass with its own envelope and an amp envelope; the whole poly mix
//  runs through the Polysix's signature effects section — here a 4-stage
//  modulated allpass PHASER (the distinct hook vs the factory's chorus
//  polys). 6-voice. No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 6;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vP: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSub: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFEnv: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
// phaser allpass states (L/R x4)
const apL: StaticArray<f32> = new StaticArray<f32>(4);
const apR: StaticArray<f32> = new StaticArray<f32>(4);
let phLfo: f32 = 0.0;
let sampleRate: f32 = 48000.0;

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_ENV: i32 = 2; const P_SUB: i32 = 3; const P_PHASE: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0; phLfo = 0.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vP[i] = 0.0; vSub[i] = 0.0; vAmp[i] = 0.0; vFEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; }
  for (let i = 0; i < 4; i++) { apL[i] = 0.0; apR[i] = 0.0; }
  params[P_CUTOFF] = 0.6; params[P_RESO] = 0.32; params[P_ENV] = 0.5; params[P_SUB] = 0.4; params[P_PHASE] = 0.4; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vP[slot] = 0.0; vSub[slot] = 0.0; vAmp[slot] = 0.0; vFEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const subN: f32 = clampf(params[P_SUB], 0.0, 1.0);
  const phaseN: f32 = clampf(params[P_PHASE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.006 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.4 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.5 * sampleRate)));
  const baseCut: f32 = 50.0 * f32(Mathf.exp(cutoffN * 5.3));
  const envSpan: f32 = envN * 7000.0;
  const k: f32 = 2.0 - 1.9 * resoN;
  const phRate: f32 = 0.2 + phaseN * 2.5;
  const phDepth: f32 = phaseN;
  const phMix: f32 = phaseN * 0.7;
  const phInc: f32 = phRate / sampleRate * 6.2831853;
  const out: f32 = level * 0.42;

  for (let i = 0; i < n; i++) {
    let mono: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      let p: f32 = vP[s] + fr / sampleRate; if (p >= 1.0) p -= 1.0; vP[s] = p;
      let sp: f32 = vSub[s] + (fr * 0.5) / sampleRate; if (sp >= 1.0) sp -= 1.0; vSub[s] = sp;
      const saw: f32 = p * 2.0 - 1.0;
      const sub: f32 = sp < 0.5 ? 0.7 : -0.7;
      let osc: f32 = (saw + sub * subN) * 0.5;
      vFEnv[s] *= fEnvCoef;
      let fc: f32 = baseCut + envSpan * vFEnv[s];
      if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
      const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
      const a1: f32 = 1.0 / (1.0 + g * (g + k));
      const hp: f32 = (osc - (g + k) * vBp[s] - vLp[s]) * a1;
      const bpN: f32 = g * hp + vBp[s]; const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      mono += lpN * vAmp[s] * vVel[s];
    }
    // built-in phaser (4-stage allpass, LFO-swept), stereo via phase offset
    phLfo += phInc; if (phLfo > 6.2831853) phLfo -= 6.2831853;
    const sweepL: f32 = 0.35 + 0.45 * (0.5 + 0.5 * f32(Mathf.sin(phLfo))) * (0.4 + phDepth);
    const sweepR: f32 = 0.35 + 0.45 * (0.5 + 0.5 * f32(Mathf.sin(phLfo + 1.2))) * (0.4 + phDepth);
    let yl: f32 = mono;
    let yr: f32 = mono;
    for (let a = 0; a < 4; a++) {
      const cl: f32 = sweepL;
      const inl: f32 = yl - cl * apL[a]; const outl: f32 = cl * inl + apL[a]; apL[a] = inl; yl = outl;
      const cr: f32 = sweepR;
      const inr: f32 = yr - cr * apR[a]; const outr: f32 = cr * inr + apR[a]; apR[a] = inr; yr = outr;
    }
    let ol: f32 = (mono + yl * phMix) * out;
    let orr: f32 = (mono + yr * phMix) * out;
    if (ol > 1.4) ol = 1.4; else if (ol < -1.4) ol = -1.4;
    if (orr > 1.4) orr = 1.4; else if (orr < -1.4) orr = -1.4;
    outBuf[i] = ol; outBuf[MAX_FRAMES + i] = orr;
  }
}
