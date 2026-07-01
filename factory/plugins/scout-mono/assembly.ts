// =====================================================================
//  SCOUT MONO — a semi-modular mono with SAMPLE & HOLD (Roland
//  System-100 lineage). Two oscillators (saw + square) through a
//  resonant low-pass with its own envelope, and the signature patch: a
//  noise SAMPLE & HOLD that steps a new random value at S&H RATE and
//  holds it, modulating the filter cutoff (and a touch of pitch) by S&H
//  DEPTH — the burbling, sci-fi "random step" movement that keeps a held
//  note alive. Mono, last-note. Controls: Cutoff, Resonance, S&H Rate,
//  S&H Depth, Env Amount, Level. No host imports, no alloc in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let ph1: f32 = 0.0; let ph2: f32 = 0.0;
let curFreq: f32 = 220.0; let targetFreq: f32 = 220.0;
let gate: i32 = 0; let note: i32 = -1; let amp: f32 = 0.0; let fenv: f32 = 0.0;
let lp: f32 = 0.0; let bp: f32 = 0.0;
let rngState: i32 = 771349;
let shVal: f32 = 0.0; let shCount: f32 = 0.0; let shSmooth: f32 = 0.0;

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_SHRATE: i32 = 2; const P_SHDEPTH: i32 = 3; const P_ENV: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  ph1 = 0.0; ph2 = 0.0; curFreq = 220.0; targetFreq = 220.0; gate = 0; note = -1; amp = 0.0; fenv = 0.0; lp = 0.0; bp = 0.0;
  shVal = 0.0; shCount = 0.0; shSmooth = 0.0;
  params[P_CUTOFF] = 0.4; params[P_RESO] = 0.55; params[P_SHRATE] = 0.4; params[P_SHDEPTH] = 0.5; params[P_ENV] = 0.4; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const nf: f32 = f > 0.0 ? f : 220.0;
  if (gate == 0) curFreq = nf;
  targetFreq = nf; note = id; gate = 1; fenv = 1.0; amp = clampf(v, 0.1, 1.0);
}
export function noteOff(id: i32): void { if (id == note) gate = 0; }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const shRateN: f32 = clampf(params[P_SHRATE], 0.0, 1.0);
  const shDepthN: f32 = clampf(params[P_SHDEPTH], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const glide: f32 = f32(Mathf.exp(-1.0 / (0.01 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.5 * sampleRate)));
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (1.4 * sampleRate)));
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.2 * sampleRate)));
  const baseCut: f32 = 60.0 * f32(Mathf.exp(cutoffN * 4.8));
  const envSpan: f32 = envN * 6000.0;
  const k: f32 = 1.7 - 1.55 * resoN;
  const shRate: f32 = 0.5 + shRateN * 22.0;                   // Hz
  const shPeriod: f32 = sampleRate / shRate;
  const shSmoothCoef: f32 = f32(1.0 - Mathf.exp(-6.2831853 * 40.0 / sampleRate));   // small glide between steps
  const out: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    curFreq = targetFreq + (curFreq - targetFreq) * glide;
    if (gate != 0) { if (amp < 1.0) { amp += 0.004; if (amp > 1.0) amp = 1.0; } else { amp *= decCoef; } }
    else { amp *= relCoef; }
    fenv *= fEnvCoef;

    // sample & hold clock
    shCount += 1.0;
    if (shCount >= shPeriod) { shCount -= shPeriod; shVal = rnd(); }
    shSmooth += shSmoothCoef * (shVal - shSmooth);

    // S&H modulates pitch a touch + filter cutoff strongly
    const pitchMod: f32 = 1.0 + shDepthN * 0.06 * shSmooth;
    const f1: f32 = curFreq * pitchMod;
    let p1: f32 = ph1 + f1 / sampleRate; if (p1 >= 1.0) p1 -= 1.0; ph1 = p1;
    let p2: f32 = ph2 + (f1 * 0.5) / sampleRate; if (p2 >= 1.0) p2 -= 1.0; ph2 = p2;
    const saw: f32 = p1 * 2.0 - 1.0;
    const sq: f32 = p2 < 0.5 ? 0.6 : -0.6;
    let osc: f32 = (saw * 0.7 + sq * 0.5) * 0.6;

    let fc: f32 = (baseCut + envSpan * fenv) * f32(Mathf.exp(shDepthN * 1.8 * shSmooth));
    if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
    const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
    const a1: f32 = 1.0 / (1.0 + g * (g + k));
    const hp: f32 = (osc - (g + k) * bp - lp) * a1;
    const bpN: f32 = g * hp + bp; const lpN: f32 = g * bpN + lp; bp = bpN; lp = lpN;

    let o: f32 = f32(Mathf.tanh(lpN * amp * out * 1.4));
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
