// =====================================================================
//  ROVER MONO — a budget two-oscillator Moog mono (Moog Rogue lineage).
//  Two sawtooth oscillators: osc1 tracks the note, OSC2 INTERVAL tunes
//  the second up to +/- an octave for fat detune, unison, fifths or
//  octave stacks, and OSC MIX balances them. They run through a warm,
//  resonant FOUR-POLE Moog-style ladder low-pass with its own envelope
//  for the classic squelchy Moog bass and lead. Mono, last-note.
//  Controls: Cutoff, Resonance, Env Amount, Osc2 Interval, Osc Mix, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let ph1: f32 = 0.0; let ph2: f32 = 0.0;
let curFreq: f32 = 110.0; let targetFreq: f32 = 110.0;
let gate: i32 = 0; let note: i32 = -1; let amp: f32 = 0.0; let fenv: f32 = 0.0;
let lp1: f32 = 0.0; let bp1: f32 = 0.0; let lp2: f32 = 0.0; let bp2: f32 = 0.0;

const P_CUTOFF: i32 = 0; const P_RESO: i32 = 1; const P_ENV: i32 = 2; const P_INTERVAL: i32 = 3; const P_MIX: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  ph1 = 0.0; ph2 = 0.0; curFreq = 110.0; targetFreq = 110.0; gate = 0; note = -1; amp = 0.0; fenv = 0.0;
  lp1 = 0.0; bp1 = 0.0; lp2 = 0.0; bp2 = 0.0;
  params[P_CUTOFF] = 0.45; params[P_RESO] = 0.5; params[P_ENV] = 0.6; params[P_INTERVAL] = 0.52; params[P_MIX] = 0.5; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const nf: f32 = f > 0.0 ? f : 110.0;
  if (gate == 0) curFreq = nf;
  targetFreq = nf; note = id; gate = 1; fenv = 1.0; amp = clampf(v, 0.1, 1.0);
}
export function noteOff(id: i32): void { if (id == note) gate = 0; }

export function process(n: i32): void {
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const resoN: f32 = clampf(params[P_RESO], 0.0, 1.0);
  const envN: f32 = clampf(params[P_ENV], 0.0, 1.0);
  const intervalN: f32 = clampf(params[P_INTERVAL], 0.0, 1.0);
  const mixN: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const semis: f32 = intervalN * 24.0 - 12.0;                 // -12..+12 st
  const ratio2: f32 = f32(Mathf.pow(2.0, semis / 12.0));
  const glide: f32 = f32(Mathf.exp(-1.0 / (0.012 * sampleRate)));
  const fEnvCoef: f32 = f32(Mathf.exp(-1.0 / (0.5 * sampleRate)));
  const decCoef: f32 = f32(Mathf.exp(-1.0 / (1.5 * sampleRate)));
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.2 * sampleRate)));
  const baseCut: f32 = 45.0 * f32(Mathf.exp(cutoffN * 5.4));
  const envSpan: f32 = envN * 7500.0;
  const k: f32 = 1.7 - 1.55 * resoN;                         // per-stage damping
  const g1: f32 = mixN;                                       // osc mix
  const out: f32 = level * 0.55;

  for (let i = 0; i < n; i++) {
    curFreq = targetFreq + (curFreq - targetFreq) * glide;
    if (gate != 0) { if (amp < 1.0) { amp += 0.004; if (amp > 1.0) amp = 1.0; } else { amp *= decCoef; } }
    else { amp *= relCoef; }
    fenv *= fEnvCoef;

    let p1: f32 = ph1 + curFreq / sampleRate; if (p1 >= 1.0) p1 -= 1.0; ph1 = p1;
    let p2: f32 = ph2 + (curFreq * ratio2) / sampleRate; if (p2 >= 1.0) p2 -= 1.0; ph2 = p2;
    const o1: f32 = p1 * 2.0 - 1.0;
    const o2: f32 = p2 * 2.0 - 1.0;
    let osc: f32 = (o1 * (1.0 - g1) + o2 * g1) * 0.9;

    let fc: f32 = baseCut + envSpan * fenv;
    if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
    const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
    const a1: f32 = 1.0 / (1.0 + g * (g + k));
    // ladder = 2 cascaded SVF LP stages (4-pole)
    const hp1: f32 = (osc - (g + k) * bp1 - lp1) * a1;
    const b1: f32 = g * hp1 + bp1; const l1: f32 = g * b1 + lp1; bp1 = b1; lp1 = l1;
    const hp2: f32 = (l1 - (g + k) * bp2 - lp2) * a1;
    const b2: f32 = g * hp2 + bp2; const l2: f32 = g * b2 + lp2; bp2 = b2; lp2 = l2;

    let o: f32 = f32(Mathf.tanh(l2 * amp * out * 1.4));
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
