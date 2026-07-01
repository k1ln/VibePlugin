// =====================================================================
//  AURORA VA — a clean modern virtual-analog lead (Nord Lead lineage).
//  Distinct from the hypersaw VA: a single morphable oscillator whose
//  Shape control sweeps continuously sine -> triangle -> saw -> pulse,
//  with oscillator SYNC for bite, a clean resonant low-pass with its own
//  envelope, and a snappy amp envelope. 8-voice poly. No samples, no host
//  imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vPh: StaticArray<f32> = new StaticArray<f32>(NVOX);   // master phase
const vPhS: StaticArray<f32> = new StaticArray<f32>(NVOX);  // sync-slave phase
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

const P_SHAPE: i32 = 0;
const P_CUTOFF: i32 = 1;
const P_RESO: i32 = 2;
const P_SYNC: i32 = 3;
const P_ENV: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// morph sine -> triangle -> saw -> pulse over shape 0..1
@inline function morphWave(ph: f32, shape: f32): f32 {
  const sine: f32 = f32(Mathf.sin(ph * 6.2831853));
  const tri: f32 = 1.0 - 4.0 * f32(Mathf.abs(ph - 0.5));
  const saw: f32 = ph * 2.0 - 1.0;
  const pulse: f32 = ph < 0.5 ? 0.85 : -0.85;
  if (shape < 0.333) { const t = shape / 0.333; return sine * (1.0 - t) + tri * t; }
  if (shape < 0.666) { const t = (shape - 0.333) / 0.333; return tri * (1.0 - t) + saw * t; }
  const t = (shape - 0.666) / 0.334; return saw * (1.0 - t) + pulse * t;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vNext = 0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vPh[i] = 0.0; vPhS[i] = 0.0; vAmp[i] = 0.0; vFEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; }
  params[P_SHAPE] = 0.6; params[P_CUTOFF] = 0.6; params[P_RESO] = 0.35; params[P_SYNC] = 0.0; params[P_ENV] = 0.5; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vPh[slot] = 0.0; vPhS[slot] = 0.0; vAmp[slot] = 0.0; vFEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const shapeN: f32 = clampf(params[P_SHAPE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const syncN: f32 = clampf(params[P_SYNC], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.004 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.3 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.45 * sampleRate)));
  const baseCut: f32 = 50.0 * f32(Mathf.exp(cutoffN * 5.4));
  const envSpan: f32 = envN * 8000.0;
  const k: f32 = 2.0 - 1.92 * resoN;
  const syncRatio: f32 = 1.0 + syncN * 2.5;   // sync-slave runs higher
  const out: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      // master phase (controls sync reset)
      let pm: f32 = vPh[s] + fr / sampleRate;
      let reset: bool = false;
      if (pm >= 1.0) { pm -= 1.0; reset = true; } vPh[s] = pm;
      // sync slave
      let ps: f32 = vPhS[s] + (fr * syncRatio) / sampleRate; if (ps >= 1.0) ps -= 1.0;
      if (reset && syncN > 0.01) ps = 0.0;
      vPhS[s] = ps;
      const osc: f32 = morphWave(syncN > 0.01 ? ps : pm, shapeN);
      // resonant SVF LP
      vFEnv[s] *= fEnvCoef;
      let fc: f32 = baseCut + envSpan * vFEnv[s];
      if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
      const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
      const a1: f32 = 1.0 / (1.0 + g * (g + k));
      const hp: f32 = (osc - (g + k) * vBp[s] - vLp[s]) * a1;
      const bpN: f32 = g * hp + vBp[s]; const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      mix += lpN * vAmp[s] * vVel[s];
    }
    let o: f32 = mix * out;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
