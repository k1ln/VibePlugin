// =====================================================================
//  FM CORE — a clean two-operator FM voice (the textbook Chowning
//  algorithm). One modulator phase-modulates one carrier; a RATIO sets
//  the modulator:carrier frequency relationship, INDEX sets the FM depth,
//  and the signature INDEX ENV makes that depth decay over each note so
//  the tone starts bright and bell-like then settles — the classic FM
//  movement on a single held key. Operator FEEDBACK adds extra harmonics.
//  8-voice poly. Controls: Ratio, Index, Index Env, Feedback, Decay, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;
const TAU: f32 = 6.2831853;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vCar: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vMod: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFb:  StaticArray<f32> = new StaticArray<f32>(NVOX);   // last modulator output (feedback)
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vIEnv:StaticArray<f32> = new StaticArray<f32>(NVOX);   // index env (1 -> 0)
const vSt:  StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq:StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote:StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
let sampleRate: f32 = 48000.0;

const P_RATIO: i32 = 0; const P_INDEX: i32 = 1; const P_IENV: i32 = 2; const P_FB: i32 = 3; const P_DECAY: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vCar[i] = 0.0; vMod[i] = 0.0; vFb[i] = 0.0; vAmp[i] = 0.0; vIEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vNote[i] = -1; }
  params[P_RATIO] = 0.28; params[P_INDEX] = 0.4; params[P_IENV] = 0.6; params[P_FB] = 0.15; params[P_DECAY] = 0.55; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vCar[slot] = 0.0; vMod[slot] = 0.0; vFb[slot] = 0.0; vAmp[slot] = 0.0; vIEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const ratioN: f32 = clampf(params[P_RATIO], 0.0, 1.0);
  const indexN: f32 = clampf(params[P_INDEX], 0.0, 1.0);
  const ienvN: f32  = clampf(params[P_IENV], 0.0, 1.0);
  const fbN: f32    = clampf(params[P_FB], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0);

  // quantise ratio to musical half-integer steps (0.5 .. 7.0)
  const ratio: f32 = f32(i32((0.5 + ratioN * 6.5) * 2.0 + 0.5)) * 0.5;
  const index: f32 = indexN * 6.0;                       // max FM index
  const fb: f32 = fbN * 1.2;
  const atkInc: f32 = 1.0 / (0.004 * sampleRate);
  const decT: f32 = 0.08 + decayN * 2.4;
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (decT * sampleRate)));
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.3 * sampleRate)));
  const ienvCoef: f32 = f32(Mathf.exp(-1.0 / ((0.06 + (1.0 - ienvN) * 1.5) * sampleRate)));  // env speed
  const out: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] >= 1.0) { vAmp[s] = 1.0; vSt[s] = 3; } }
      else if (vSt[s] == 3) { vAmp[s] *= decCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      vIEnv[s] *= ienvCoef;
      const effIndex: f32 = index * (1.0 - ienvN + ienvN * vIEnv[s]);
      // modulator with feedback
      let mp: f32 = vMod[s] + (fr * ratio) / sampleRate; if (mp >= 1.0) mp -= 1.0; vMod[s] = mp;
      const modOut: f32 = f32(Mathf.sin(mp * TAU + fb * vFb[s]));
      vFb[s] = modOut;
      // carrier phase-modulated by modulator
      let cp: f32 = vCar[s] + fr / sampleRate; if (cp >= 1.0) cp -= 1.0; vCar[s] = cp;
      const car: f32 = f32(Mathf.sin(cp * TAU + effIndex * modOut));
      mix += car * vAmp[s] * vVel[s];
    }
    let o: f32 = mix * out;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
