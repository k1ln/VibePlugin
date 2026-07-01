// =====================================================================
//  PATCH GRID — a patch-matrix modular voice (EMS Synthi 100 lineage).
//  The Synthi's pin matrix let anything modulate anything; its most
//  iconic sound is RING MODULATION between a played oscillator and a
//  free-running one, giving clangorous, inharmonic, bell-and-drone
//  timbres. Here osc1 tracks the note, OSC2 FREQ sets a free-running
//  second oscillator (absolute pitch, so the ring product goes
//  inharmonic), RING sets the ring-mod amount, NOISE adds the Synthi's
//  coloured noise, all through a resonant low-pass with a decay envelope.
//  Mono (last-note). Controls: Osc2 Freq, Ring, Noise, Cutoff, Decay, Level.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const TAU: f32 = 6.2831853;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let ph1: f32 = 0.0; let ph2: f32 = 0.0;
let curFreq: f32 = 220.0; let targetFreq: f32 = 220.0;
let gate: i32 = 0; let note: i32 = -1; let amp: f32 = 0.0;
let lp: f32 = 0.0; let bp: f32 = 0.0;
let rngState: i32 = 135791; let nz: f32 = 0.0;

const P_OSC2: i32 = 0; const P_RING: i32 = 1; const P_NOISE: i32 = 2; const P_CUTOFF: i32 = 3; const P_DECAY: i32 = 4; const P_LEVEL: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  ph1 = 0.0; ph2 = 0.0; curFreq = 220.0; targetFreq = 220.0; gate = 0; note = -1; amp = 0.0; lp = 0.0; bp = 0.0; nz = 0.0;
  params[P_OSC2] = 0.4; params[P_RING] = 0.5; params[P_NOISE] = 0.15; params[P_CUTOFF] = 0.55; params[P_DECAY] = 0.6; params[P_LEVEL] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const nf: f32 = f > 0.0 ? f : 220.0;
  if (gate == 0) curFreq = nf;
  targetFreq = nf; note = id; gate = 1; amp = clampf(v, 0.1, 1.0);
}
export function noteOff(id: i32): void { if (id == note) gate = 0; }

export function process(n: i32): void {
  const osc2N: f32 = clampf(params[P_OSC2], 0.0, 1.0);
  const ringN: f32 = clampf(params[P_RING], 0.0, 1.0);
  const noiseN: f32 = clampf(params[P_NOISE], 0.0, 1.0);
  const cutoffN: f32 = clampf(params[P_CUTOFF], 0.0, 1.0);
  const decayN: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0);

  const osc2Freq: f32 = 40.0 * f32(Mathf.exp(osc2N * 3.4));      // ~40..1200 Hz free-running
  const glide: f32 = f32(Mathf.exp(-1.0 / (0.01 * sampleRate)));
  const atkInc: f32 = 1.0 / (0.006 * sampleRate);
  const decCoef: f32 = f32(Mathf.exp(-1.0 / ((0.15 + decayN * 2.5) * sampleRate)));
  const relCoef: f32 = f32(Mathf.exp(-1.0 / (0.2 * sampleRate)));
  const baseCut: f32 = 55.0 * f32(Mathf.exp(cutoffN * 5.3));
  const k: f32 = 1.3;
  let fc: f32 = baseCut; if (fc < 30.0) fc = 30.0; if (fc > sampleRate * 0.45) fc = sampleRate * 0.45;
  const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
  const a1c: f32 = 1.0 / (1.0 + g * (g + k));
  const inc2: f32 = osc2Freq / sampleRate;
  const out: f32 = level * 0.6;

  for (let i = 0; i < n; i++) {
    curFreq = targetFreq + (curFreq - targetFreq) * glide;
    if (gate != 0) { if (amp < 1.0) { amp += atkInc; if (amp > 1.0) amp = 1.0; } else { amp *= decCoef; } }
    else { amp *= relCoef; }

    let p1: f32 = ph1 + curFreq / sampleRate; if (p1 >= 1.0) p1 -= 1.0; ph1 = p1;
    let p2: f32 = ph2 + inc2; if (p2 >= 1.0) p2 -= 1.0; ph2 = p2;
    const o1: f32 = p1 * 2.0 - 1.0;                    // saw (rich for ring mod)
    const o2: f32 = f32(Mathf.sin(p2 * TAU));          // sine carrier
    const ring: f32 = o1 * o2;
    // coloured noise (one-pole lowpassed)
    nz += 0.25 * (rnd() - nz);
    let v: f32 = o1 * (0.5 - ringN * 0.35) + ring * ringN * 1.4 + nz * noiseN * 1.2;

    const hp: f32 = (v - (g + k) * bp - lp) * a1c;
    const bpN: f32 = g * hp + bp; const lpN: f32 = g * bpN + lp; bp = bpN; lp = lpN;
    let o: f32 = f32(Mathf.tanh(lpN * amp * out * 1.4));
    outBuf[i] = o; outBuf[MAX_FRAMES + i] = o;
  }
}
