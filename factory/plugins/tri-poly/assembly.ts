// =====================================================================
//  TRI POLY — a bright DCO poly with cross-modulation (Roland JX-3P
//  lineage). Two DCOs (saw + pulse) per voice with OSC-2 -> OSC-1 cross
//  modulation for metallic edge, a resonant low-pass with its own envelope,
//  and a built-in chorus for the lush JX shimmer. 8-voice poly. No host
//  imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;
const CH_LEN: i32 = 4096; const CH_MASK: i32 = CH_LEN - 1;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vP1: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vP2: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFEnv: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
const chL: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
let chW: i32 = 0; let chPh: f32 = 0.0;
let sampleRate: f32 = 48000.0;

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_ENV: i32 = 2; const P_XMOD: i32 = 3; const P_CHORUS: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0; chW = 0; chPh = 0.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vP1[i] = 0.0; vP2[i] = 0.0; vAmp[i] = 0.0; vFEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; }
  for (let i = 0; i < CH_LEN; i++) chL[i] = 0.0;
  params[P_CUTOFF] = 0.62; params[P_RESO] = 0.32; params[P_ENV] = 0.5; params[P_XMOD] = 0.2; params[P_CHORUS] = 0.55; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vP1[slot] = 0.0; vP2[slot] = 0.0; vAmp[slot] = 0.0; vFEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const xmodN: f32 = clampf(params[P_XMOD], 0.0, 1.0);
  const chorusN: f32 = clampf(params[P_CHORUS], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.005 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.35 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.5 * sampleRate)));
  const baseCut: f32 = 50.0 * f32(Mathf.exp(cutoffN * 5.3));
  const envSpan: f32 = envN * 7500.0;
  const k: f32 = 2.0 - 1.9 * resoN;
  const xmod: f32 = xmodN * 0.5;
  const chDepth: f32 = chorusN * 0.008 * sampleRate; const chBase: f32 = 0.007 * sampleRate; const chMix: f32 = chorusN * 0.6;
  const out: f32 = level * 0.42;

  for (let i = 0; i < n; i++) {
    let mono: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      // osc2 (pulse) — modulates osc1 frequency (cross-mod)
      let p2: f32 = vP2[s] + (fr * 1.5) / sampleRate; if (p2 >= 1.0) p2 -= 1.0; vP2[s] = p2;
      const pulse: f32 = p2 < 0.5 ? 1.0 : -1.0;
      // osc1 (saw) cross-modulated
      let p1: f32 = vP1[s] + (fr * (1.0 + pulse * xmod)) / sampleRate;
      p1 -= f32(Mathf.floor(p1)); vP1[s] = p1;
      const saw: f32 = p1 * 2.0 - 1.0;
      let osc: f32 = (saw * 0.6 + pulse * 0.4) * 0.5;
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
    chL[chW] = mono;
    chPh += 0.8 / sampleRate * 6.2831853; if (chPh > 6.2831853) chPh -= 6.2831853;
    const d1: f32 = chBase + chDepth * (0.5 + 0.5 * f32(Mathf.sin(chPh)));
    const d2: f32 = chBase + chDepth * (0.5 + 0.5 * f32(Mathf.sin(chPh + 2.6)));
    const r1: f32 = f32(chW) - d1; let i1: i32 = i32(r1); const fa: f32 = r1 - f32(i1);
    const r2: f32 = f32(chW) - d2; let i2: i32 = i32(r2); const fb2: f32 = r2 - f32(i2);
    const c1: f32 = chL[i1 & CH_MASK] + (chL[(i1 + 1) & CH_MASK] - chL[i1 & CH_MASK]) * fa;
    const c2: f32 = chL[i2 & CH_MASK] + (chL[(i2 + 1) & CH_MASK] - chL[i2 & CH_MASK]) * fb2;
    chW = (chW + 1) & CH_MASK;
    let l: f32 = (mono + c1 * chMix) * out;
    let r: f32 = (mono + c2 * chMix) * out;
    if (l > 1.4) l = 1.4; else if (l < -1.4) l = -1.4;
    if (r > 1.4) r = 1.4; else if (r < -1.4) r = -1.4;
    outBuf[i] = l; outBuf[MAX_FRAMES + i] = r;
  }
}
