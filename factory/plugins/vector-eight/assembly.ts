// =====================================================================
//  VECTOR EIGHT — a vector-synthesis poly (Sequential Prophet VS
//  lineage). Four oscillators (sine A, saw B, square C, hollow-digital D)
//  sit at the corners of a vector square and are blended by an X/Y
//  position. The signature SCAN orbits that position with an LFO, so the
//  timbre is in constant motion even on a single held chord. 8-voice poly
//  through a resonant two-pole low-pass.
//  Controls: Cutoff, Resonance, Vector X, Vector Y, Scan, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

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

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_VX: i32 = 2; const P_VY: i32 = 3; const P_SCAN: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0; vNext = 0; lfo = 0.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vPh[i] = 0.0; vAmp[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vLp[i] = 0.0; vBp[i] = 0.0; vNote[i] = -1; }
  params[P_CUTOFF] = 0.6; params[P_RESO] = 0.25; params[P_VX] = 0.4; params[P_VY] = 0.6; params[P_SCAN] = 0.4; params[P_LEVEL] = 0.8;
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

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const vxN: f32 = clampf(params[P_VX], 0.0, 1.0);
  const vyN: f32 = clampf(params[P_VY], 0.0, 1.0);
  const scanN: f32 = clampf(params[P_SCAN], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const atkInc: f32 = 1.0 / (0.01 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.5 * sampleRate)));
  const baseCut: f32 = 60.0 * f32(Mathf.exp(cutoffN * 5.2));
  const k: f32 = 2.0 - 1.9 * resoN;
  const lfoInc: f32 = (0.4 + scanN * 5.0) / sampleRate * 6.2831853;   // scan speed
  const scanDepth: f32 = scanN * 0.9;
  const out: f32 = level * 0.45;

  for (let i = 0; i < n; i++) {
    lfo += lfoInc; if (lfo > 6.2831853) lfo -= 6.2831853;
    // vector position: center (from VX/VY) + orbiting scan
    let px: f32 = (vxN * 2.0 - 1.0) + scanDepth * f32(Mathf.sin(lfo));
    let py: f32 = (vyN * 2.0 - 1.0) + scanDepth * f32(Mathf.cos(lfo * 0.73));
    if (px < -1.0) px = -1.0; else if (px > 1.0) px = 1.0;
    if (py < -1.0) py = -1.0; else if (py > 1.0) py = 1.0;
    const fx: f32 = (px + 1.0) * 0.5; const fy: f32 = (py + 1.0) * 0.5;
    const wA: f32 = (1.0 - fx) * fy;        // A top-left  (sine)
    const wB: f32 = fx * fy;                // B top-right (saw)
    const wC: f32 = fx * (1.0 - fy);        // C bot-right (square)
    const wD: f32 = (1.0 - fx) * (1.0 - fy);// D bot-left  (hollow digital)

    let fc: f32 = baseCut;
    if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
    const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
    const a1: f32 = 1.0 / (1.0 + g * (g + k));

    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      let ph: f32 = vPh[s] + fr / sampleRate; if (ph >= 1.0) ph -= 1.0; vPh[s] = ph;
      const ang: f32 = ph * 6.2831853;
      const oA: f32 = f32(Mathf.sin(ang));
      const oB: f32 = ph * 2.0 - 1.0;
      const oC: f32 = ph < 0.5 ? 1.0 : -1.0;
      const oD: f32 = (f32(Mathf.sin(ang)) + 0.5 * f32(Mathf.sin(ang * 3.0)) + 0.3 * f32(Mathf.sin(ang * 5.0))) * 0.6;
      let osc: f32 = (oA * wA + oB * wB + oC * wC + oD * wD) * 0.7;
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
