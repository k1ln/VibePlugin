// =====================================================================
//  WAVE STORM — a wavetable-SCANNING synth (Waldorf Blofeld lineage).
//  Distinct from the factory's fixed-wave PPG/Wavestation units: a smooth
//  wavetable of 8 single-cycle frames (built at init from harmonic spectra)
//  is scanned CONTINUOUSLY by a Position control AND swept by the envelope
//  (Scan), so the timbre morphs over each note. Resonant low-pass with its
//  own envelope, amp envelope, 8-voice poly. No host imports, no alloc in
//  process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;
const FRAMES: i32 = 8;
const FLEN: i32 = 256;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const vDrift: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vGL: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vGR: StaticArray<f32> = new StaticArray<f32>(NVOX);

const wt: StaticArray<f32> = new StaticArray<f32>(FRAMES * FLEN);

const vPh: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vEnv: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
let sampleRate: f32 = 48000.0;

const P_POS: i32 = 0; const P_SCAN: i32 = 1; const P_CUTOFF: i32 = 2; const P_RESO: i32 = 3; const P_ENV: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
let rngState: i32 = 0x2b9f17;
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

function buildWavetable(): void {
  for (let f = 0; f < FRAMES; f++) {
    const harm: i32 = 1 + f * 3;                 // 1..22 harmonics
    const tilt: f32 = f32(f) / f32(FRAMES - 1);  // brighter as frame rises
    for (let i = 0; i < FLEN; i++) {
      const ph: f32 = f32(i) / f32(FLEN);
      let s: f32 = 0.0;
      for (let h = 1; h <= harm; h++) {
        const amp: f32 = (1.0 / f32(h)) * (1.0 - tilt * 0.4 + tilt * 0.4 * f32(h) / f32(harm));
        s += f32(Mathf.sin(ph * 6.2831853 * f32(h))) * amp;
      }
      wt[f * FLEN + i] = s;
    }
    // normalise frame
    let pk: f32 = 0.0;
    for (let i = 0; i < FLEN; i++) { const a = wt[f * FLEN + i]; const aa = a < 0.0 ? -a : a; if (aa > pk) pk = aa; }
    const g: f32 = pk > 0.0001 ? 0.95 / pk : 1.0;
    for (let i = 0; i < FLEN; i++) wt[f * FLEN + i] *= g;
  }
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vPh[i] = 0.0; vAmp[i] = 0.0; vEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; }
  params[P_POS] = 0.3; params[P_SCAN] = 0.4; params[P_CUTOFF] = 0.65; params[P_RESO] = 0.3; params[P_ENV] = 0.45; params[P_LEVEL] = 0.8;
  buildWavetable();
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vPh[slot] = 0.0; vAmp[slot] = 0.0; vEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const posN: f32 = clampf(params[P_POS], 0.0, 1.0);
  const scanN: f32 = clampf(params[P_SCAN], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.006 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.4 * sampleRate)));
  const eCoef: f32 = f32(Mathf.exp(-1.0 / (0.6 * sampleRate)));
  const baseCut: f32 = 50.0 * f32(Mathf.exp(cutoffN * 5.3));
  const envSpan: f32 = envN * 7000.0;
  const k: f32 = 2.0 - 1.9 * resoN;
  const out: f32 = level * 0.45;

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
      vEnv[s] *= eCoef;
      // phase
      let ph: f32 = vPh[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; vPh[s] = ph;
      // wavetable position (scanned by envelope)
      let pos: f32 = posN + scanN * vEnv[s]; if (pos > 1.0) pos = 1.0; if (pos < 0.0) pos = 0.0;
      const fpos: f32 = pos * f32(FRAMES - 1);
      let f0: i32 = i32(fpos); if (f0 > FRAMES - 2) f0 = FRAMES - 2;
      const fmix: f32 = fpos - f32(f0);
      // read both frames at ph (linear interp within frame)
      const sp: f32 = ph * f32(FLEN);
      let i0: i32 = i32(sp); const sf: f32 = sp - f32(i0); const i1: i32 = (i0 + 1) & (FLEN - 1); i0 = i0 & (FLEN - 1);
      const baseA: i32 = f0 * FLEN; const baseB: i32 = (f0 + 1) * FLEN;
      const wa: f32 = wt[baseA + i0] + (wt[baseA + i1] - wt[baseA + i0]) * sf;
      const wb: f32 = wt[baseB + i0] + (wt[baseB + i1] - wt[baseB + i0]) * sf;
      const osc: f32 = wa + (wb - wa) * fmix;
      // resonant SVF LP
      let fc: f32 = baseCut + envSpan * vEnv[s];
      if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
      const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
      const a1: f32 = 1.0 / (1.0 + g * (g + k));
      const hp: f32 = (osc - (g + k) * vBp[s] - vLp[s]) * a1;
      const bpN: f32 = g * hp + vBp[s]; const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      const _v: f32 = lpN * vAmp[s] * vVel[s]; mixL += _v * vGL[s]; mixR += _v * vGR[s];
    }
    let oL: f32 = mixL * out; let oR: f32 = mixR * out;
    if (oL > 1.4) oL = 1.4; else if (oL < -1.4) oL = -1.4; if (oR > 1.4) oR = 1.4; else if (oR < -1.4) oR = -1.4;
    outBuf[i] = oL; outBuf[MAX_FRAMES + i] = oR;
  }
}
