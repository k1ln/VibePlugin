// =====================================================================
//  LINEAR DREAM — an LA-synthesis voice (Roland D-50 lineage).
//  "Linear Arithmetic": each note layers a short PCM ATTACK transient over
//  a synthesised SUSTAIN body. Three original attack samples (mallet,
//  blown, pluck — self-authored CC0) are baked in as base64 Int16 PCM @
//  22050 Hz (C3) and played once at note onset; a sawtooth body runs
//  through a per-voice resonant low-pass with a decaying filter envelope
//  and an amp envelope. 8-voice poly + a lush built-in chorus.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const SAMP_CAP: i32 = 12000;
const SAMP_SR: f32 = 22050.0;
const BASE_HZ: f32 = 130.81;
const NVOX: i32 = 8;
const NATK: i32 = 3;
const CH_LEN: i32 = 4096;
const CH_MASK: i32 = CH_LEN - 1;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const samp: StaticArray<f32> = new StaticArray<f32>(SAMP_CAP);
let sampLen: i32 = 0;
const aOff: StaticArray<i32> = new StaticArray<i32>(NATK);
const aLen: StaticArray<i32> = new StaticArray<i32>(NATK);

const vAPos: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vASmp: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vOsc:  StaticArray<f32> = new StaticArray<f32>(NVOX);
const vAmp:  StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFEnv: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt:   StaticArray<i32> = new StaticArray<i32>(NVOX);
const vVel:  StaticArray<f32> = new StaticArray<f32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vLp:   StaticArray<f32> = new StaticArray<f32>(NVOX);
const vBp:   StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;

const chL: StaticArray<f32> = new StaticArray<f32>(CH_LEN);
let chW: i32 = 0;
let chPh: f32 = 0.0;

let sampleRate: f32 = 48000.0;

const P_ATTACK: i32 = 0;  // attack-transient select 0..2
const P_CUTOFF: i32 = 1;
const P_RESO: i32 = 2;
const P_ENV: i32 = 3;     // filter envelope amount
const P_CHORUS: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function b64sym(c: i32): i32 {
  if (c >= 65 && c <= 90)  return c - 65;
  if (c >= 97 && c <= 122) return c - 71;
  if (c >= 48 && c <= 57)  return c + 4;
  if (c == 43) return 62; if (c == 47) return 63; return -1;
}

const PCM_B64: string = "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";

function decodePCM(): void {
  const s = PCM_B64; const n = s.length;
  let buf: i32 = 0, bits: i32 = 0, lo: i32 = -1, si: i32 = 0;
  for (let i = 0; i < n; i++) {
    const v = b64sym(s.charCodeAt(i)); if (v < 0) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; const byte = (buf >> bits) & 0xFF;
      if (lo < 0) { lo = byte; } else { let val = (byte << 8) | lo; if (val >= 32768) val -= 65536; if (si < SAMP_CAP) { samp[si] = f32(val) / 32768.0; si++; } lo = -1; } }
  }
  sampLen = si;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vNext = 0; chW = 0; chPh = 0.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vAPos[i] = 0.0; vOsc[i] = 0.0; vAmp[i] = 0.0; vFEnv[i] = 0.0; vVel[i] = 0.0; vFreq[i] = BASE_HZ; vLp[i] = 0.0; vBp[i] = 0.0; vASmp[i] = 0; vNote[i] = -1; }
  for (let i = 0; i < CH_LEN; i++) chL[i] = 0.0;
  aOff[0]=0; aLen[0]=2866; aOff[1]=2866; aLen[1]=2866; aOff[2]=5732; aLen[2]=2866;
  params[P_ATTACK] = 0.0;
  params[P_CUTOFF] = 0.55;
  params[P_RESO] = 0.35;
  params[P_ENV] = 0.6;
  params[P_CHORUS] = 0.5;
  params[P_LEVEL] = 0.8;
  decodePCM();
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  let sel: i32 = i32(clampf(params[P_ATTACK], 0.0, 1.0) * 2.999); if (sel < 0) sel = 0; if (sel >= NATK) sel = NATK - 1;
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vASmp[slot] = sel; vAPos[slot] = 0.0; vOsc[slot] = 0.0;
  vAmp[slot] = 0.0; vFEnv[slot] = 1.0; vSt[slot] = 1;
  vVel[slot] = clampf(v, 0.05, 1.0); vFreq[slot] = f > 0.0 ? f : BASE_HZ;
  vLp[slot] = 0.0; vBp[slot] = 0.0; vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const chorusN: f32 = clampf(params[P_CHORUS], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.005 * sampleRate);            // ~5 ms amp attack
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.25 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.5 * sampleRate))); // filter env decay
  const baseCut: f32 = 60.0;
  const cutSpan: f32 = f32(Mathf.exp(cutoffN * 5.0));        // cutoff scaler
  const envSpan: f32 = envN * 6000.0;
  const k: f32 = 2.0 - 1.9 * resoN;
  const aRate0: f32 = SAMP_SR / sampleRate;
  const chDepth: f32 = chorusN * 0.009 * sampleRate;
  const chBase: f32 = 0.007 * sampleRate;
  const chPhInc: f32 = 0.7 / sampleRate * 6.2831853;
  const chMix: f32 = chorusN * 0.6;
  const out: f32 = level * 0.42;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr0: f32 = vFreq[s];
      // amp env
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      // PCM attack transient (plays once, pitched)
      let atk: f32 = 0.0;
      const al: i32 = aLen[vASmp[s]];
      const apos: f32 = vAPos[s];
      const aip: i32 = i32(apos);
      if (aip < al - 1) {
        const ao: i32 = aOff[vASmp[s]];
        const af: f32 = apos - f32(aip);
        atk = samp[ao + aip] + (samp[ao + aip + 1] - samp[ao + aip]) * af;
        vAPos[s] = apos + (fr0 / BASE_HZ) * aRate0;
      }
      // synth saw body
      let ph: f32 = vOsc[s] + fr0 / sampleRate;
      if (ph >= 1.0) ph -= 1.0;
      vOsc[s] = ph;
      const saw: f32 = ph * 2.0 - 1.0;
      // per-voice resonant SVF low-pass with filter env
      vFEnv[s] *= fEnvCoef;
      let fc: f32 = baseCut * cutSpan + envSpan * vFEnv[s];
      if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
      const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
      const a1: f32 = 1.0 / (1.0 + g * (g + k));
      const hp: f32 = (saw - (g + k) * vBp[s] - vLp[s]) * a1;
      const bpN: f32 = g * hp + vBp[s];
      const lpN: f32 = g * bpN + vLp[s];
      vBp[s] = bpN; vLp[s] = lpN;
      const body: f32 = lpN;
      mix += (atk * 0.9 + body * 0.8) * vAmp[s] * vVel[s];
    }
    // chorus
    chL[chW] = mix;
    chPh += chPhInc; if (chPh > 6.2831853) chPh -= 6.2831853;
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
    outBuf[i] = l;
    outBuf[MAX_FRAMES + i] = r;
  }
}
