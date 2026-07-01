// =====================================================================
//  LATELY FM — a 2-operator FM voice with selectable OPERATOR WAVEFORMS
//  (Yamaha TX81Z lineage). Distinct from the sine-only FM units: the TX81Z's
//  signature is its 8 operator waves (sine, half-sine, abs-sine, quarter,
//  even, square-ish...) which give reedy/buzzy/hollow timbres — the famous
//  "Lately Bass". A modulator (with feedback) FMs a carrier, both using the
//  selected wave; ADSR + ratio + depth. 8-voice poly. No samples, no host
//  imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 8;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const vPhC: StaticArray<f32> = new StaticArray<f32>(NVOX);  // carrier phase
const vPhM: StaticArray<f32> = new StaticArray<f32>(NVOX);  // modulator phase
const vFb: StaticArray<f32> = new StaticArray<f32>(NVOX);   // last modulator out (feedback)
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vMEnv: StaticArray<f32> = new StaticArray<f32>(NVOX); // modulator (brightness) env
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX);
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;
let sampleRate: f32 = 48000.0;
let dcX: f32 = 0.0; let dcY: f32 = 0.0;   // DC blocker state (TX operator waves carry DC)
const ratioTab: StaticArray<f32> = new StaticArray<f32>(7);

const P_WAVE: i32 = 0;
const P_RATIO: i32 = 1;
const P_DEPTH: i32 = 2;
const P_FB: i32 = 3;
const P_DECAY: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// TX-style operator waveforms; ph in 0..1
@inline function opWave(ph: f32, w: i32): f32 {
  const s: f32 = f32(Mathf.sin(ph * 6.2831853));
  if (w == 0) return s;                               // sine
  if (w == 1) return ph < 0.5 ? s : 0.0;              // half sine
  if (w == 2) return s < 0.0 ? -s : s;                // abs sine
  if (w == 3) return (ph < 0.25 || (ph >= 0.5 && ph < 0.75)) ? (s < 0.0 ? -s : s) : 0.0; // quarter
  if (w == 4) { const s2: f32 = f32(Mathf.sin(ph * 12.566370)); return ph < 0.5 ? (s2 < 0.0 ? -s2 : s2) : 0.0; } // even abs
  return s >= 0.0 ? 1.0 : -1.0;                       // 5: square-ish (buzzy)
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vNext = 0; dcX = 0.0; dcY = 0.0;
  ratioTab[0]=0.5; ratioTab[1]=1.0; ratioTab[2]=2.0; ratioTab[3]=3.0; ratioTab[4]=4.0; ratioTab[5]=5.0; ratioTab[6]=7.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vPhC[i] = 0.0; vPhM[i] = 0.0; vFb[i] = 0.0; vAmp[i] = 0.0; vMEnv[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vNote[i] = -1; }
  params[P_WAVE] = 0.45; params[P_RATIO] = 0.5; params[P_DEPTH] = 0.5; params[P_FB] = 0.2; params[P_DECAY] = 0.5; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  vPhC[slot] = 0.0; vPhM[slot] = 0.0; vFb[slot] = 0.0; vAmp[slot] = 0.0; vMEnv[slot] = 1.0; vSt[slot] = 1;
  vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const waveN: f32 = clampf(params[P_WAVE], 0.0, 1.0);
  const ratioN: f32 = clampf(params[P_RATIO], 0.0, 1.0);
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const fbN: f32 = clampf(params[P_FB], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  let wave: i32 = i32(waveN * 5.999); if (wave < 0) wave = 0; if (wave > 5) wave = 5;
  // ratio: quantised-ish set 0.5,1,2,3,4,5,7
  let ri: i32 = i32(ratioN * 6.999); if (ri < 0) ri = 0; if (ri > 6) ri = 6;
  const ratio: f32 = ratioTab[ri];
  const depth: f32 = depthN * 6.0;       // FM index
  const fb: f32 = fbN * 0.7;
  const atkInc: f32 = 1.0 / (0.004 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.3 * sampleRate)));
  const mDecSec: f32 = 0.05 + decayN * decayN * 2.0;
  const mCoef: f32 = f32(Mathf.exp(-1.0 / (mDecSec * sampleRate)));
  const out: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      const fr: f32 = vFreq[s];
      if (vSt[s] == 1) { vAmp[s] += atkInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      vMEnv[s] *= mCoef;
      // modulator
      let pm: f32 = vPhM[s] + (fr * ratio) / sampleRate; if (pm >= 1.0) pm -= 1.0; vPhM[s] = pm;
      const mo: f32 = opWave(pm + vFb[s] * fb, wave);
      vFb[s] = mo;
      // carrier (FM'd by modulator * depth * brightness env)
      let pc: f32 = vPhC[s] + fr / sampleRate; if (pc >= 1.0) pc -= 1.0; vPhC[s] = pc;
      let cph: f32 = pc + mo * depth * vMEnv[s] * 0.159155;  // /2pi scaling for phase-mod
      cph -= f32(Mathf.floor(cph));
      const co: f32 = opWave(cph, wave);
      mix += co * vAmp[s] * vVel[s];
    }
    let o: f32 = mix * out;
    // DC blocker (one-pole high-pass) — removes the offset from rectified operator waves
    const dcO: f32 = o - dcX + 0.9985 * dcY; dcX = o; dcY = dcO; o = dcO;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
