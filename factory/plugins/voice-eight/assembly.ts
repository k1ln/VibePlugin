// =====================================================================
//  VOICE EIGHT — a fat unison analog poly (Oberheim Four/Eight Voice
//  lineage): each voice stacks two detuned saws + a sub through a smooth
//  resonant low-pass with its own envelope, with a wide unison Spread for
//  the huge stacked-SEM choir/brass. 8-voice poly. No host imports, no
//  allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vA: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vB: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSubp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFEnv: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vDrift: StaticArray<f32> = new StaticArray<f32>(NVOX);   // slow analog pitch drift per voice
const vGL: StaticArray<f32> = new StaticArray<f32>(NVOX);      // per-voice equal-power pan gain L
const vGR: StaticArray<f32> = new StaticArray<f32>(NVOX);      // per-voice equal-power pan gain R
const PANTAB: StaticArray<f32> = new StaticArray<f32>(NVOX);   // interleaved pan spread (any chord fans wide)
let vNext: i32 = 0;
let sampleRate: f32 = 48000.0;
let rngState: i32 = 0x51f7a3;

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_ENV: i32 = 2; const P_SPREAD: i32 = 3; const P_SUB: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0; rngState = 0x51f7a3;
  // interleaved so slots fill center -> wide, keeping any voice count spread
  PANTAB[0] = 0.0; PANTAB[1] = -0.78; PANTAB[2] = 0.78; PANTAB[3] = -0.4; PANTAB[4] = 0.4; PANTAB[5] = -1.0; PANTAB[6] = 1.0; PANTAB[7] = 0.16;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vA[i] = 0.0; vB[i] = 0.0; vSubp[i] = 0.0; vAmp[i] = 0.0; vFEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; vDrift[i] = 0.0; vGL[i] = 0.707; vGR[i] = 0.707; }
  params[P_CUTOFF] = 0.6; params[P_RESO] = 0.3; params[P_ENV] = 0.5; params[P_SPREAD] = 0.35; params[P_SUB] = 0.4; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vA[slot] = 0.0; vB[slot] = 0.0; vSubp[slot] = 0.0; vAmp[slot] = 0.0; vFEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const spreadN: f32 = clampf(params[P_SPREAD], 0.0, 1.0);
  const subN: f32 = clampf(params[P_SUB], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.008 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.45 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.6 * sampleRate)));
  const baseCut: f32 = 50.0 * f32(Mathf.exp(cutoffN * 5.2));
  const envSpan: f32 = envN * 7000.0;
  const k: f32 = 2.0 - 1.9 * resoN;
  const det: f32 = 1.0 + spreadN * 0.05;
  const out: f32 = level * 0.4;
  // Spread also fans the voices across the stereo field (equal-power pan)
  const width: f32 = spreadN * 0.92;
  for (let s = 0; s < NVOX; s++) {
    const pan: f32 = PANTAB[s] * width;   // interleaved spread
    vGL[s] = f32(Mathf.sqrt(0.5 * (1.0 - pan)));
    vGR[s] = f32(Mathf.sqrt(0.5 * (1.0 + pan)));
  }
  const driftLeak: f32 = 0.9998;
  const driftStep: f32 = 0.00006;   // ~+/-5 cents slow analog tuning drift

  for (let i = 0; i < n; i++) {
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      // slow bounded random-walk drift so each voice breathes like real analog
      vDrift[s] = vDrift[s] * driftLeak + rnd() * driftStep;
      const fr: f32 = vFreq[s] * (1.0 + vDrift[s]);
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      let a: f32 = vA[s] + fr / sampleRate; if (a >= 1.0) a -= 1.0; vA[s] = a;
      let b: f32 = vB[s] + (fr * det) / sampleRate; if (b >= 1.0) b -= 1.0; vB[s] = b;
      let sp: f32 = vSubp[s] + (fr * 0.5) / sampleRate; if (sp >= 1.0) sp -= 1.0; vSubp[s] = sp;
      const saw1: f32 = a * 2.0 - 1.0;
      const saw2: f32 = b * 2.0 - 1.0;
      const sub: f32 = sp < 0.5 ? 0.7 : -0.7;
      let osc: f32 = (saw1 + saw2 + sub * subN) * 0.4;
      vFEnv[s] *= fEnvCoef;
      let fc: f32 = baseCut + envSpan * vFEnv[s];
      if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
      const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
      const a1: f32 = 1.0 / (1.0 + g * (g + k));
      const hp: f32 = (osc - (g + k) * vBp[s] - vLp[s]) * a1;
      const bpN: f32 = g * hp + vBp[s]; const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      const val: f32 = lpN * vAmp[s] * vVel[s];
      mixL += val * vGL[s]; mixR += val * vGR[s];
    }
    let oL: f32 = mixL * out; let oR: f32 = mixR * out;
    if (oL > 1.4) oL = 1.4; else if (oL < -1.4) oL = -1.4;
    if (oR > 1.4) oR = 1.4; else if (oR < -1.4) oR = -1.4;
    outBuf[i] = oL; outBuf[MAX_FRAMES + i] = oR;
  }
}
