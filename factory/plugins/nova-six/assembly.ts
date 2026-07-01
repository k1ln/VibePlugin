// =====================================================================
//  NOVA SIX — a 6-voice DCO poly synth (Roland Juno-106 lineage).
//  Distinct from the warm Juno-60 voice (Juno Glow) by its signature
//  HIGH-PASS FILTER: a single stable DCO (saw + variable pulse with PWM)
//  plus a square sub, into a resonant low-pass with its own decay
//  envelope, then a non-resonant HIGH-PASS that carves the low end, and a
//  lush BBD-style chorus. Pure algorithm, no host imports, no alloc in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;
const CH_LEN: i32 = 4096;
const CH_MASK: i32 = CH_LEN - 1;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vP1: StaticArray<f32> = new StaticArray<f32>(NVOX); // saw/pulse phase
const vSub: StaticArray<f32> = new StaticArray<f32>(NVOX); // sub phase
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFEnv: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX); // 0 off,1 held,2 release
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vHp1: StaticArray<f32> = new StaticArray<f32>(NVOX); // HP state
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;

const chL: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
let chW: i32 = 0; let chPh: f32 = 0.0;
let sampleRate: f32 = 48000.0;
let lfoPh: f32 = 0.0;

const P_CUTOFF: i32 = 0;
const P_RESO: i32 = 1;
const P_HPF: i32 = 2;
const P_ENV: i32 = 3;
const P_CHORUS: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vNext = 0; chW = 0; chPh = 0.0; lfoPh = 0.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vP1[i] = 0.0; vSub[i] = 0.0; vAmp[i] = 0.0; vFEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vHp1[i] = 0.0; vNote[i] = -1; }
  for (let i = 0; i < CH_LEN; i++) chL[i] = 0.0;
  params[P_CUTOFF] = 0.6; params[P_RESO] = 0.3; params[P_HPF] = 0.15; params[P_ENV] = 0.5; params[P_CHORUS] = 0.55; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vP1[slot] = 0.0; vSub[slot] = 0.0; vAmp[slot] = 0.0; vFEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0);
  vLp[slot] = 0.0; vBp[slot] = 0.0; vHp1[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const hpfN: f32 = clampf(params[P_HPF], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const chorusN: f32 = clampf(params[P_CHORUS], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.006 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.4 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.6 * sampleRate)));
  const baseCut: f32 = 50.0 * f32(Mathf.exp(cutoffN * 5.3));
  const envSpan: f32 = envN * 7000.0;
  const k: f32 = 2.0 - 1.9 * resoN;
  // HP coefficient (one-pole high-pass): hpfN high -> higher corner
  const hpCut: f32 = 20.0 * f32(Mathf.exp(hpfN * 5.0));
  const hpco: f32 = clampf(hpCut / sampleRate * 6.2831853, 0.0, 0.9);
  // PWM lfo
  lfoPh += 0.6 / sampleRate * 6.2831853; if (lfoPh > 6.2831853) lfoPh -= 6.2831853;
  const pw: f32 = 0.5 + 0.35 * f32(Mathf.sin(lfoPh));
  const chDepth: f32 = chorusN * 0.009 * sampleRate; const chBase: f32 = 0.007 * sampleRate;
  const chMix: f32 = chorusN * 0.6;
  const out: f32 = level * 0.42;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      // DCO: saw + pulse(PWM)
      let p: f32 = vP1[s] + fr / sampleRate; if (p >= 1.0) p -= 1.0; vP1[s] = p;
      const saw: f32 = p * 2.0 - 1.0;
      const pulse: f32 = p < pw ? 1.0 : -1.0;
      let sp: f32 = vSub[s] + (fr * 0.5) / sampleRate; if (sp >= 1.0) sp -= 1.0; vSub[s] = sp;
      const sub: f32 = sp < 0.5 ? 0.6 : -0.6;
      let osc: f32 = (saw * 0.6 + pulse * 0.4 + sub) * 0.5;
      // resonant LP (SVF) with filter env
      vFEnv[s] *= fEnvCoef;
      let fc: f32 = baseCut + envSpan * vFEnv[s];
      if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
      const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
      const a1: f32 = 1.0 / (1.0 + g * (g + k));
      const hp: f32 = (osc - (g + k) * vBp[s] - vLp[s]) * a1;
      const bpN: f32 = g * hp + vBp[s]; const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      // one-pole high-pass (carve low end)
      vHp1[s] += (lpN - vHp1[s]) * hpco;
      const hpOut: f32 = lpN - vHp1[s];
      mix += hpOut * vAmp[s] * vVel[s];
    }
    // chorus
    chL[chW] = mix;
    chPh += 0.7 / sampleRate * 6.2831853; if (chPh > 6.2831853) chPh -= 6.2831853;
    const d1: f32 = chBase + chDepth * (0.5 + 0.5 * f32(Mathf.sin(chPh)));
    const d2: f32 = chBase + chDepth * (0.5 + 0.5 * f32(Mathf.sin(chPh + 2.6)));
    const r1: f32 = f32(chW) - d1; let i1: i32 = i32(r1); const fa: f32 = r1 - f32(i1);
    const r2: f32 = f32(chW) - d2; let i2: i32 = i32(r2); const fb2: f32 = r2 - f32(i2);
    const c1: f32 = chL[i1 & CH_MASK] + (chL[(i1 + 1) & CH_MASK] - chL[i1 & CH_MASK]) * fa;
    const c2: f32 = chL[i2 & CH_MASK] + (chL[(i2 + 1) & CH_MASK] - chL[i2 & CH_MASK]) * fb2;
    chW = (chW + 1) & CH_MASK;
    let l: f32 = (mix + c1 * chMix) * out;
    let r: f32 = (mix + c2 * chMix) * out;
    if (l > 1.4) l = 1.4; else if (l < -1.4) l = -1.4;
    if (r > 1.4) r = 1.4; else if (r < -1.4) r = -1.4;
    outBuf[i] = l; outBuf[MAX_FRAMES + i] = r;
  }
}
