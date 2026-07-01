// =====================================================================
//  MULTI MONO — an expressive single-VCO mono (Multimoog lineage).
//  One VCO (saw + variable pulse) + a square sub through a Moog-style
//  resonant low-pass with its own envelope; the signature is an OSC MOD
//  (LFO -> pitch vibrato + pulse-width) for the lip/aftertouch-style
//  expression. Mono (last-note). No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let ph: f32 = 0.0; let phs: f32 = 0.0; let lfo: f32 = 0.0;
let targetFreq: f32 = 0.0; let curFreq: f32 = 0.0;
let gate: i32 = 0; let note: i32 = -1; let amp: f32 = 0.0; let fenv: f32 = 0.0;
let lp: f32 = 0.0; let bp: f32 = 0.0;

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_ENV: i32 = 2; const P_MOD: i32 = 3; const P_SUB: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  ph = 0.0; phs = 0.0; lfo = 0.0; targetFreq = 0.0; curFreq = 0.0; gate = 0; note = -1; amp = 0.0; fenv = 0.0; lp = 0.0; bp = 0.0;
  params[P_CUTOFF] = 0.5; params[P_RESO] = 0.4; params[P_ENV] = 0.6; params[P_MOD] = 0.3; params[P_SUB] = 0.4; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const nf: f32 = f > 0.0 ? f : 220.0;
  if (gate == 0 && curFreq <= 0.0) curFreq = nf;
  targetFreq = nf; note = id; gate = 1; fenv = 1.0; amp = clampf(v, 0.1, 1.0);
}
export function noteOff(id: i32): void { if (id == note) gate = 0; }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const modN: f32 = clampf(params[P_MOD], 0.0, 1.0);
  const subN: f32 = clampf(params[P_SUB], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.5 * sampleRate)));
  const aRel: f32 = f32(Mathf.exp(-1.0 / (0.25 * sampleRate)));
  const glideCoef: f32 = f32(Mathf.exp(-1.0 / (0.015 * sampleRate)));
  const baseCut: f32 = 50.0 * f32(Mathf.exp(cutoffN * 5.3));
  const envSpan: f32 = envN * 8000.0;
  const k: f32 = 2.0 - 1.92 * resoN;
  const lfoInc: f32 = 5.5 / sampleRate * 6.2831853;
  const vibDepth: f32 = modN * 0.03;       // +/-3% pitch vibrato
  const pwmDepth: f32 = modN * 0.35;
  const out: f32 = level * 0.6;

  for (let i = 0; i < n; i++) {
    curFreq = targetFreq + (curFreq - targetFreq) * glideCoef;
    if (gate != 0) { amp += (1.0 - amp) * 0.003; if (amp > 1.0) amp = 1.0; } else { amp *= aRel; }
    fenv *= fEnvCoef;
    lfo += lfoInc; if (lfo > 6.2831853) lfo -= 6.2831853;
    const lfv: f32 = f32(Mathf.sin(lfo));
    const f: f32 = curFreq * (1.0 + vibDepth * lfv);
    let p: f32 = ph + f / sampleRate; if (p >= 1.0) p -= 1.0; ph = p;
    let sp: f32 = phs + (f * 0.5) / sampleRate; if (sp >= 1.0) sp -= 1.0; phs = sp;
    const pw: f32 = 0.5 + pwmDepth * lfv;
    const saw: f32 = p * 2.0 - 1.0;
    const pulse: f32 = p < pw ? 1.0 : -1.0;
    const sub: f32 = sp < 0.5 ? 0.7 : -0.7;
    let osc: f32 = (saw * 0.6 + pulse * 0.4 + sub * subN) * 0.5;
    let fc: f32 = baseCut + envSpan * fenv;
    if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
    const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
    const a1: f32 = 1.0 / (1.0 + g * (g + k));
    const hp: f32 = (osc - (g + k) * bp - lp) * a1;
    const bpN: f32 = g * hp + bp; const lpN: f32 = g * bpN + lp; bp = bpN; lp = lpN;
    let o: f32 = lpN * amp * out;
    if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
