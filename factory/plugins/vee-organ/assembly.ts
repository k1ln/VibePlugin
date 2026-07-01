// =====================================================================
//  VEE ORGAN — a bright "combo" organ (Vox Continental lineage).
//  Distinct from the reedy Farfisa-style Combo Organ: the brighter, more
//  hollow Vox voicing. Each key sums drawbar-weighted harmonic partials
//  (sine-ish), with a key-click transient, a pitch vibrato and a tone
//  control. Fully polyphonic (12 voices). Controls: Low (16'+8' drawbars),
//  High (4'+2'+upper), Brightness, Vibrato, Click, Level.
//  No samples, no host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NVOX: i32 = 12;
const NPART: i32 = 6;   // partials per voice

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// partial frequency ratios (16',8',8'quint,4',2',upper)
const ratio: StaticArray<f32> = new StaticArray<f32>(NPART);

const vPh: StaticArray<f32> = new StaticArray<f32>(NVOX * NPART);
const vAmp: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vClick: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vSt: StaticArray<i32> = new StaticArray<i32>(NVOX); // 0 off,1 held,2 release
const vFreq: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vVel: StaticArray<f32> = new StaticArray<f32>(NVOX);
const vNote: StaticArray<i32> = new StaticArray<i32>(NVOX);
let vNext: i32 = 0;

let sampleRate: f32 = 48000.0;
let vibPh: f32 = 0.0;
let rngState: i32 = 8181;

const P_LOW: i32 = 0;
const P_HIGH: i32 = 1;
const P_BRIGHT: i32 = 2;
const P_VIB: i32 = 3;
const P_CLICK: i32 = 4;
const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  vNext = 0; vibPh = 0.0;
  for (let i = 0; i < NVOX; i++) { vSt[i] = 0; vAmp[i] = 0.0; vClick[i] = 0.0; vFreq[i] = 220.0; vVel[i] = 0.0; vNote[i] = -1; }
  for (let i = 0; i < NVOX * NPART; i++) vPh[i] = 0.0;
  ratio[0] = 0.5; ratio[1] = 1.0; ratio[2] = 1.5; ratio[3] = 2.0; ratio[4] = 4.0; ratio[5] = 6.0;
  params[P_LOW] = 0.7; params[P_HIGH] = 0.5; params[P_BRIGHT] = 0.6; params[P_VIB] = 0.3; params[P_CLICK] = 0.4; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const slot: i32 = vNext; vNext = (vNext + 1) % NVOX;
  for (let p = 0; p < NPART; p++) vPh[slot * NPART + p] = 0.0;
  vAmp[slot] = 0.0; vClick[slot] = 1.0; vSt[slot] = 1; vFreq[slot] = f > 0.0 ? f : 220.0; vVel[slot] = clampf(v, 0.05, 1.0); vNote[slot] = id;
}
export function noteOff(id: i32): void { for (let i = 0; i < NVOX; i++) { if (vSt[i] != 0 && vNote[i] == id) vSt[i] = 2; } }

export function process(n: i32): void {
  const lowN: f32 = clampf(params[P_LOW], 0.0, 1.0);
  const highN: f32 = clampf(params[P_HIGH], 0.0, 1.0);
  const brightN: f32 = clampf(params[P_BRIGHT], 0.0, 1.0);
  const vibN: f32 = clampf(params[P_VIB], 0.0, 1.0);
  const clickN: f32 = clampf(params[P_CLICK], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  // drawbar amplitudes per partial: Low controls 16'+8'(+quint), High controls 4'+2'+upper
  const amp0: f32 = lowN;          // 16'
  const amp1: f32 = 0.6 + lowN * 0.4; // 8' (always present)
  const amp2: f32 = lowN * 0.5;    // quint
  const amp3: f32 = highN;         // 4'
  const amp4: f32 = highN * 0.8 * (0.4 + brightN * 0.6); // 2'
  const amp5: f32 = highN * 0.6 * brightN; // upper (bright)
  const onInc: f32 = 1.0 / (0.006 * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.05 * sampleRate)));
  const clickCoef: f32 = f32(Mathf.exp(-1.0 / (0.004 * sampleRate)));
  vibPh += 6.5 / sampleRate * 6.2831853; if (vibPh > 6.2831853) vibPh -= 6.2831853;
  const vib: f32 = 1.0 + vibN * 0.012 * f32(Mathf.sin(vibPh));
  const norm: f32 = 1.0 / (amp0 + amp1 + amp2 + amp3 + amp4 + amp5 + 0.001);
  const out: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    let mix: f32 = 0.0;
    for (let s = 0; s < NVOX; s++) {
      if (vSt[s] == 0) continue;
      if (vSt[s] == 1) { vAmp[s] += onInc; if (vAmp[s] > 1.0) vAmp[s] = 1.0; }
      else { vAmp[s] *= relCoef; if (vAmp[s] < 0.0004) { vSt[s] = 0; continue; } }
      const fb: f32 = vFreq[s] * vib;
      const bi: i32 = s * NPART;
      let v: f32 = 0.0;
      // partials
      let ph0: f32 = vPh[bi] + fb * ratio[0] / sampleRate; if (ph0 >= 1.0) ph0 -= 1.0; vPh[bi] = ph0; v += f32(Mathf.sin(ph0 * 6.2831853)) * amp0;
      let ph1: f32 = vPh[bi+1] + fb * ratio[1] / sampleRate; if (ph1 >= 1.0) ph1 -= 1.0; vPh[bi+1] = ph1; v += f32(Mathf.sin(ph1 * 6.2831853)) * amp1;
      let ph2: f32 = vPh[bi+2] + fb * ratio[2] / sampleRate; if (ph2 >= 1.0) ph2 -= 1.0; vPh[bi+2] = ph2; v += f32(Mathf.sin(ph2 * 6.2831853)) * amp2;
      let ph3: f32 = vPh[bi+3] + fb * ratio[3] / sampleRate; if (ph3 >= 1.0) ph3 -= 1.0; vPh[bi+3] = ph3; v += f32(Mathf.sin(ph3 * 6.2831853)) * amp3;
      let ph4: f32 = vPh[bi+4] + fb * ratio[4] / sampleRate; if (ph4 >= 1.0) ph4 -= 1.0; vPh[bi+4] = ph4; v += f32(Mathf.sin(ph4 * 6.2831853)) * amp4;
      let ph5: f32 = vPh[bi+5] + fb * ratio[5] / sampleRate; if (ph5 >= 1.0) ph5 -= 1.0; vPh[bi+5] = ph5; v += f32(Mathf.sin(ph5 * 6.2831853)) * amp5;
      v *= norm;
      // key click
      vClick[s] *= clickCoef;
      v += rnd() * vClick[s] * clickN * 0.5;
      mix += v * vAmp[s] * vVel[s];
    }
    let o: f32 = mix * out;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
