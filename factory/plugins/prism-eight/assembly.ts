// =====================================================================
//  PRISM EIGHT — a flexible, slightly metallic analog/hybrid poly
//  (Rhodes Chroma lineage). Its signature is RING modulation between the
//  two oscillators: dial Ring up and the saws cross into clangorous,
//  bell-like, inharmonic territory the way the Chroma's patchable voice
//  could. Each of 8 voices runs two detuned saws through a resonant
//  two-pole low-pass with its own envelope.
//  Controls: Cutoff, Resonance, Env Amount, Ring, Detune, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const vDrift: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vGL: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vGR: StaticArray<f32> = new StaticArray<f32>(NVOX);

const vA: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vB: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFEnv: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
let sampleRate: f32 = 48000.0;

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_ENV: i32 = 2; const P_RING: i32 = 3; const P_DETUNE: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
let rngState: i32 = 0x2b9f17;
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vA[i] = 0.0; vB[i] = 0.0; vAmp[i] = 0.0; vFEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; }
  params[P_CUTOFF] = 0.55; params[P_RESO] = 0.3; params[P_ENV] = 0.5; params[P_RING] = 0.0; params[P_DETUNE] = 0.3; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vA[slot] = 0.0; vB[slot] = 0.0; vAmp[slot] = 0.0; vFEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0);
  vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const ringN: f32 = clampf(params[P_RING], 0.0, 1.0);
  const detN: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.007 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.42 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.55 * sampleRate)));
  const baseCut: f32 = 55.0 * f32(Mathf.exp(cutoffN * 5.3));
  const envSpan: f32 = envN * 8000.0;
  const k: f32 = 2.0 - 1.9 * resoN;
  // detune climbs with Detune; ring uses a wider ratio so the product is clangorous
  const det: f32 = 1.0 + detN * 0.04 + ringN * 0.9;       // osc2 ratio (ring pushes it up ~2x)
  const dryGain: f32 = 1.0 - ringN * 0.85;
  const ringGain: f32 = ringN * 1.7;
  const out: f32 = level * 0.9;

    const _width: f32 = 0.55;
  for (let _s = 0; _s < NVOX; _s++) { const _pr: i32 = (_s + 1) / 2; const _mg: f32 = _s == 0 ? 0.0 : (1.0 - f32(_pr - 1) / f32(NVOX)); const _pan: f32 = ((_s % 2 == 1) ? -_mg : _mg) * _width; vGL[_s] = f32(Mathf.sqrt(0.5 * (1.0 - _pan))); vGR[_s] = f32(Mathf.sqrt(0.5 * (1.0 + _pan))); }
  const _dLeak: f32 = 0.9998; const _dStep: f32 = 0.00006;

  for (let i = 0; i < n; i++) {
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      vDrift[s] = vDrift[s] * _dLeak + rnd() * _dStep;
      const fr: f32 = vFreq[s] * (1.0 + vDrift[s]);
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      let a: f32 = vA[s] + fr / sampleRate; if (a >= 1.0) a -= 1.0; vA[s] = a;
      let b: f32 = vB[s] + (fr * det) / sampleRate; if (b >= 1.0) b -= 1.0; vB[s] = b;
      const saw1: f32 = a * 2.0 - 1.0;
      const saw2: f32 = b * 2.0 - 1.0;
      const ringp: f32 = saw1 * saw2;                       // ring modulation product
      let osc: f32 = ((saw1 + saw2) * 0.5 * dryGain + ringp * ringGain) * 0.5;
      vFEnv[s] *= fEnvCoef;
      let fc: f32 = baseCut + envSpan * vFEnv[s];
      if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
      const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
      const a1: f32 = 1.0 / (1.0 + g * (g + k));
      const hp: f32 = (osc - (g + k) * vBp[s] - vLp[s]) * a1;
      const bpN: f32 = g * hp + vBp[s]; const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      const _v: f32 = lpN * vAmp[s] * vVel[s]; mixL += _v * vGL[s]; mixR += _v * vGR[s];
    }
    let oL: f32 = f32(Mathf.tanh(mixL * out)); let oR: f32 = f32(Mathf.tanh(mixR * out));
    outBuf[i] = oL; outBuf[MAX_FRAMES + i] = oR;
  }
}
