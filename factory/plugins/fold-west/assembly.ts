// =====================================================================
//  FOLD WEST — a West-Coast complex-oscillator wavefolder (Serge modular
//  lineage). Instead of subtracting harmonics with a filter, it ADDS
//  them by folding: a sine/triangle core (morphed by TIMBRE) is driven
//  into a smooth WAVEFOLDER whose depth blooms with an envelope, so a
//  held note grows brighter and more metallic then settles — the classic
//  Buchla/Serge "timbre from folding" movement. A gentle low-pass tames
//  the top. 6-voice poly. Controls: Fold, Timbre, Cutoff, Env, Decay, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 6;
const TAU: f32 = 6.2831853;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vPh: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFold: StaticArray<f32> = new StaticArray<f32>(NVOX);   // fold-bloom envelope
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
let sampleRate: f32 = 48000.0;

const P_FOLD: i32 = 0; const P_TIMBRE: i32 = 1; const P_CUTOFF: i32 = 2; const P_ENV: i32 = 3; const P_DECAY: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vPh[i] = 0.0; vAmp[i] = 0.0; vFold[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; }
  params[P_FOLD] = 0.5; params[P_TIMBRE] = 0.4; params[P_CUTOFF] = 0.7; params[P_ENV] = 0.6; params[P_DECAY] = 0.6; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vPh[slot] = 0.0; vAmp[slot] = 0.0; vFold[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0);
  vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const foldN: f32 = clampf(params[P_FOLD], 0.0, 1.0);
  const timbreN: f32 = clampf(params[P_TIMBRE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.006 * sampleRate);
  const decCoef: f32 = f32(Mathf.exp(-1.0 / ((0.2 + decayN * 2.6) * sampleRate)));
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.3 * sampleRate)));
  const foldEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.6 * sampleRate)));
  const baseCut: f32 = 200.0 * f32(Mathf.exp(cutoffN * 4.4));
  const k: f32 = 1.2;
  let fc: f32 = baseCut; if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
  const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
  const a1c: f32 = 1.0 / (1.0 + g * (g + k));
  const maxFold: f32 = 7.0;
  const out: f32 = level * 0.42;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] >= 1.0) { vAmp[s] = 1.0; vSt[s] = 3; } }
      else if (vSt[s] == 3) { vAmp[s] *= decCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      let ph: f32 = vPh[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; vPh[s] = ph;
      // core wave: sine morphed toward triangle by Timbre
      const sine: f32 = f32(Mathf.sin(ph * TAU));
      const tri: f32 = 1.0 - 4.0 * f32(Mathf.abs(ph - 0.5));
      let core: f32 = sine * (1.0 - timbreN) + tri * timbreN;
      // fold-bloom envelope
      vFold[s] *= foldEnvCoef;
      const foldAmt: f32 = 1.0 + foldN * maxFold * (1.0 - envN + envN * vFold[s]);
      // smooth wavefolder: repeated sine folding
      let folded: f32 = f32(Mathf.sin(core * foldAmt * 1.5708));
      // a touch of the second fold stage for richer harmonics at high fold
      folded = folded * 0.8 + f32(Mathf.sin(folded * (1.0 + foldN * 2.0) * 1.5708)) * 0.2;
      // gentle low-pass
      const hp: f32 = (folded - (g + k) * vBp[s] - vLp[s]) * a1c;
      const bpN: f32 = g * hp + vBp[s]; const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      mix += lpN * vAmp[s] * vVel[s];
    }
    let o: f32 = f32(Mathf.tanh(mix * out * 1.4));
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
