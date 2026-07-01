// =====================================================================
//  GRIT WAVE — a gritty digital wavetable poly (Waldorf Microwave
//  lineage). Sister to the smooth Wave Storm, but harsher and more
//  aliased: an 8-frame wavetable (built at init, from near-sine up to
//  bright formant-heavy frames) is scanned by Position, the signature
//  SCAN sweeps that position with an LFO so the timbre morphs on a held
//  note, and DRIVE adds saturation + digital grain for the characterful
//  edge. 8-voice poly through a resonant two-pole low-pass.
//  Controls: Cutoff, Resonance, Position, Scan, Drive, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;
const NFRAMES: i32 = 8;
const FLEN: i32 = 256;
const TAU: f32 = 6.2831853;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const vDrift: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vGL: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vGR: StaticArray<f32> = new StaticArray<f32>(NVOX);
const WT: StaticArray<f32> = new StaticArray<f32>(NFRAMES * FLEN);

const vPh: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
let lfo: f32 = 0.0;
let sampleRate: f32 = 48000.0;

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_POS: i32 = 2; const P_SCAN: i32 = 3; const P_DRIVE: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
let rngState: i32 = 0x2b9f17;
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

function buildWavetable(): void {
  for (let f = 0; f < NFRAMES; f++) {
    const ff: f32 = f32(f) / f32(NFRAMES - 1);        // 0..1 frame morph
    const nharm: i32 = 1 + i32(ff * 40.0);            // more harmonics as frame rises
    const fc: f32 = 2.0 + ff * 10.0;                  // moving formant centre (harmonic index)
    let peak: f32 = 0.0001;
    for (let i = 0; i < FLEN; i++) {
      const ph: f32 = f32(i) / f32(FLEN);
      let v: f32 = 0.0;
      for (let h = 1; h <= nharm; h++) {
        let amp: f32 = 1.0 / f32(h);
        // formant emphasis for the digital/gritty character
        const d: f32 = f32(h) - fc;
        amp += 0.5 * f32(Mathf.exp(-(d * d) / 6.0));
        v += amp * f32(Mathf.sin(TAU * f32(h) * ph));
      }
      WT[f * FLEN + i] = v;
      const av: f32 = v < 0.0 ? -v : v; if (av > peak) peak = av;
    }
    const norm: f32 = 0.9 / peak;
    for (let i = 0; i < FLEN; i++) { WT[f * FLEN + i] = WT[f * FLEN + i] * norm; }
  }
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0; lfo = 0.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vPh[i] = 0.0; vAmp[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; }
  params[P_CUTOFF] = 0.6; params[P_RESO] = 0.3; params[P_POS] = 0.3; params[P_SCAN] = 0.4; params[P_DRIVE] = 0.35; params[P_LEVEL] = 0.8;
  buildWavetable();
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vPh[slot] = 0.0; vAmp[slot] = 0.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0);
  vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

@inline function readWT(framePos: f32, ph: f32): f32 {
  let fp: f32 = framePos; if (fp < 0.0) fp = 0.0; if (fp > f32(NFRAMES - 1)) fp = f32(NFRAMES - 1);
  const f0: i32 = i32(fp); let f1: i32 = f0 + 1; if (f1 > NFRAMES - 1) f1 = NFRAMES - 1;
  const fr: f32 = fp - f32(f0);
  const x: f32 = ph * f32(FLEN);
  let i0: i32 = i32(x); const xf: f32 = x - f32(i0); if (i0 >= FLEN) i0 = FLEN - 1;
  let i1: i32 = i0 + 1; if (i1 >= FLEN) i1 = 0;
  const a0: f32 = WT[f0 * FLEN + i0] + (WT[f0 * FLEN + i1] - WT[f0 * FLEN + i0]) * xf;
  const a1: f32 = WT[f1 * FLEN + i0] + (WT[f1 * FLEN + i1] - WT[f1 * FLEN + i0]) * xf;
  return a0 + (a1 - a0) * fr;
}

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const posN: f32 = clampf(params[P_POS], 0.0, 1.0);
  const scanN: f32 = clampf(params[P_SCAN], 0.0, 1.0);
  const driveN: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.008 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.45 * sampleRate)));
  const baseCut: f32 = 60.0 * f32(Mathf.exp(cutoffN * 5.2));
  const k: f32 = 2.0 - 1.9 * resoN;
  const lfoInc: f32 = (0.3 + scanN * 4.0) / sampleRate * TAU;
  const scanDepth: f32 = scanN * 3.5;
  const basePos: f32 = posN * f32(NFRAMES - 1);
  const drive: f32 = 1.0 + driveN * 5.0;
  const driveComp: f32 = 1.0 / (1.0 + driveN * 1.6);
  const out: f32 = level * 0.42;

  let fc: f32 = baseCut;
  if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
  const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
  const a1c: f32 = 1.0 / (1.0 + g * (g + k));

    const _width: f32 = 0.55;
  for (let _s = 0; _s < NVOX; _s++) { const _pr: i32 = (_s + 1) / 2; const _mg: f32 = _s == 0 ? 0.0 : (1.0 - f32(_pr - 1) / f32(NVOX)); const _pan: f32 = ((_s % 2 == 1) ? -_mg : _mg) * _width; vGL[_s] = f32(Mathf.sqrt(0.5 * (1.0 - _pan))); vGR[_s] = f32(Mathf.sqrt(0.5 * (1.0 + _pan))); }
  const _dLeak: f32 = 0.9998; const _dStep: f32 = 0.00006;

  for (let i = 0; i < n; i++) {
    lfo += lfoInc; if (lfo > TAU) lfo -= TAU;
    const framePos: f32 = basePos + scanDepth * (0.5 + 0.5 * f32(Mathf.sin(lfo)));
    let mixL: f32 = 0.0; let mixR: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      vDrift[s] = vDrift[s] * _dLeak + rnd() * _dStep;
      const fr: f32 = vFreq[s] * (1.0 + vDrift[s]);
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      let ph: f32 = vPh[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; vPh[s] = ph;
      let osc: f32 = readWT(framePos, ph);
      // drive grit: saturation
      osc = f32(Mathf.tanh(osc * drive)) * driveComp;
      const hp: f32 = (osc - (g + k) * vBp[s] - vLp[s]) * a1c;
      const bpN: f32 = g * hp + vBp[s]; const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      const _v: f32 = lpN * vAmp[s] * vVel[s]; mixL += _v * vGL[s]; mixR += _v * vGR[s];
    }
    let oL: f32 = mixL * out; let oR: f32 = mixR * out;
    if (oL > 1.4) oL = 1.4; else if (oL < -1.4) oL = -1.4; if (oR > 1.4) oR = 1.4; else if (oR < -1.4) oR = -1.4;
    outBuf[i] = oL; outBuf[MAX_FRAMES + i] = oR;
  }
}
