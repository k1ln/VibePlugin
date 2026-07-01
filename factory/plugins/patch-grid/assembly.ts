// =====================================================================
//  PATCH GRID — a patch-matrix modular voice pushed toward the EMS
//  Synthi 100. FOUR oscillators (saw / sine / triangle / pulse), a
//  coloured noise generator, a ring modulator (OSC1 x OSC2), a
//  trapezoid envelope and a high-resonance / self-oscillating state
//  variable filter feed a spring-style reverb and output.
//
//  The heart is a REAL 7x7 pin matrix: every source (rows) can be
//  patched into every destination (columns) with an independent,
//  automatable amount that the audio engine actually reads each
//  sample — anything modulates / feeds anything, just like the Synthi.
//
//    SOURCES (rows)   : OSC1 OSC2 OSC3 OSC4 NOISE RING ENV
//    DESTINATIONS(cols): OSC1f OSC2f OSC3f OSC4f CUTOFF FILT-IN OUT
//
//  Control columns (OSCnf, CUTOFF) treat the summed bus as a CV;
//  audio columns (FILT-IN, OUT) sum it as signal. Nothing patched to
//  FILT-IN / OUT == silence, exactly like a real pin board.
//
//  Mono (last-note). No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const TAU: f32 = 6.2831853;

const NSRC: i32 = 7;    // matrix rows (sources)
const NDST: i32 = 7;    // matrix cols (destinations)
const NMAT: i32 = 49;   // NSRC * NDST

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const rmat:   StaticArray<f32> = new StaticArray<f32>(NMAT);   // clamped routes for this block

// ---- parameter indices ---------------------------------------------
// knobs 0..9
const P_O2: i32 = 0; const P_O3: i32 = 1; const P_O4: i32 = 2;
const P_NOISE: i32 = 3; const P_CUT: i32 = 4; const P_RES: i32 = 5;
const P_ATK: i32 = 6; const P_DEC: i32 = 7; const P_REV: i32 = 8; const P_LEVEL: i32 = 9;
const P_MAT: i32 = 10;                       // matrix routes 10..58 = P_MAT + src*NDST + dst

// destination column indices
const D_O1F: i32 = 0; const D_O2F: i32 = 1; const D_O3F: i32 = 2; const D_O4F: i32 = 3;
const D_CUT: i32 = 4; const D_FIN: i32 = 5; const D_OUT: i32 = 6;

let sampleRate: f32 = 48000.0;
let ph1: f32 = 0.0; let ph2: f32 = 0.0; let ph3: f32 = 0.0; let ph4: f32 = 0.0;
let curFreq: f32 = 220.0; let targetFreq: f32 = 220.0;
let gate: i32 = 0; let note: i32 = -1; let amp: f32 = 0.0; let vel: f32 = 1.0;
let lp: f32 = 0.0; let bp: f32 = 0.0;
let dcX: f32 = 0.0; let dcY: f32 = 0.0;          // output DC blocker
let rngState: i32 = 135791; let nz: f32 = 0.0;

// previous-sample source values (break the modulation feedback loop)
let ps1: f32 = 0.0; let ps2: f32 = 0.0; let ps3: f32 = 0.0; let ps4: f32 = 0.0;
let ps5: f32 = 0.0; let ps6: f32 = 0.0; let ps7: f32 = 0.0;

// spring-ish reverb (2 combs + 1 allpass, mono)
const RVA: i32 = 1621; const RVB: i32 = 1949; const RVP: i32 = 487;
const rvaBuf: StaticArray<f32> = new StaticArray<f32>(RVA);
const rvbBuf: StaticArray<f32> = new StaticArray<f32>(RVB);
const rvpBuf: StaticArray<f32> = new StaticArray<f32>(RVP);
let ria: i32 = 0; let rib: i32 = 0; let rip: i32 = 0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return f32(rngState) / 1073741824.0 - 1.0; }
@inline function pow2(x: f32): f32 { return f32(Mathf.pow(2.0, x)); }
// tune knob -> free-running frequency, ~1.5 Hz (LFO) .. ~2.4 kHz (audio)
@inline function tuneFreq(t: f32): f32 { return f32(1.5 * Mathf.exp(clampf(t, 0.0, 1.0) * 7.3)); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  ph1 = 0.0; ph2 = 0.0; ph3 = 0.0; ph4 = 0.0;
  curFreq = 220.0; targetFreq = 220.0; gate = 0; note = -1; amp = 0.0; vel = 1.0; lp = 0.0; bp = 0.0; nz = 0.0; dcX = 0.0; dcY = 0.0;
  ps1 = 0.0; ps2 = 0.0; ps3 = 0.0; ps4 = 0.0; ps5 = 0.0; ps6 = 0.0; ps7 = 0.0;
  ria = 0; rib = 0; rip = 0;
  for (let i = 0; i < RVA; i++) rvaBuf[i] = 0.0;
  for (let i = 0; i < RVB; i++) rvbBuf[i] = 0.0;
  for (let i = 0; i < RVP; i++) rvpBuf[i] = 0.0;
  for (let i = 0; i < MAX_PARAMS; i++) params[i] = 0.0;

  // module knobs
  params[P_O2] = 0.36; params[P_O3] = 0.5; params[P_O4] = 0.2;
  params[P_NOISE] = 0.35; params[P_CUT] = 0.5; params[P_RES] = 0.6;
  params[P_ATK] = 0.14; params[P_DEC] = 0.5; params[P_REV] = 0.22; params[P_LEVEL] = 0.8;

  // default patch — a bright clangorous plucked drone (so it sounds on load)
  params[P_MAT + 0 * NDST + D_FIN] = 0.85;   // OSC1  -> FILT-IN
  params[P_MAT + 0 * NDST + D_OUT] = 0.25;   // OSC1  -> OUT (some dry)
  params[P_MAT + 5 * NDST + D_OUT] = 0.70;   // RING  -> OUT (clang)
  params[P_MAT + 4 * NDST + D_FIN] = 0.22;   // NOISE -> FILT-IN
  params[P_MAT + 6 * NDST + D_CUT] = 0.60;   // ENV   -> CUTOFF (filter envelope)
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 59; }

export function noteOn(id: i32, f: f32, v: f32): void {
  const nf: f32 = f > 0.0 ? f : 220.0;
  if (gate == 0) curFreq = nf;
  targetFreq = nf; note = id; gate = 1; vel = clampf(v, 0.1, 1.0);
}
export function noteOff(id: i32): void { if (id == note) gate = 0; }

export function process(n: i32): void {
  // ---- read knobs -------------------------------------------------
  const noiseN: f32 = clampf(params[P_NOISE], 0.0, 1.0);
  const cutN: f32   = clampf(params[P_CUT], 0.0, 1.0);
  const resN: f32   = clampf(params[P_RES], 0.0, 1.0);
  const atkN: f32   = clampf(params[P_ATK], 0.0, 1.0);
  const decN: f32   = clampf(params[P_DEC], 0.0, 1.0);
  const revN: f32   = clampf(params[P_REV], 0.0, 1.0);
  const level: f32  = clampf(params[P_LEVEL], 0.0, 1.0);

  // snapshot the matrix once per block
  for (let m = 0; m < NMAT; m++) rmat[m] = clampf(params[P_MAT + m], 0.0, 1.0);

  // free-running oscillator base frequencies (OSC1 is keyboard-tracked)
  const f2b: f32 = tuneFreq(params[P_O2]);
  const f3b: f32 = tuneFreq(params[P_O3]);
  const f4b: f32 = tuneFreq(params[P_O4]);

  const glide: f32 = f32(Mathf.exp(-1.0 / (0.008 * sampleRate)));
  const atkInc: f32 = 1.0 / ((0.002 + atkN * 1.4) * sampleRate);
  const relCoef: f32 = f32(Mathf.exp(-1.0 / ((0.02 + decN * 3.2) * sampleRate)));
  const baseCut: f32 = 45.0 * f32(Mathf.exp(cutN * 5.4));
  const kRes: f32 = 1.5 - resN * 1.46;             // -> ~0.04 at full res: near self-oscillation
  const nyq: f32 = sampleRate * 0.45;
  const noiseCoef: f32 = 0.02 + noiseN * 0.7;      // colour: brighter as it rises
  const outScale: f32 = level * 0.5;

  for (let i = 0; i < n; i++) {
    // glide + trapezoid envelope (attack up, sustain, release down)
    curFreq = targetFreq + (curFreq - targetFreq) * glide;
    if (gate != 0) { if (amp < 1.0) { amp += atkInc; if (amp > 1.0) amp = 1.0; } }
    else { amp *= relCoef; }

    // ---- modulation buses from PREVIOUS-sample sources (CV columns) ----
    const m0: f32 = ps1 * rmat[0 * NDST + D_O1F] + ps2 * rmat[1 * NDST + D_O1F] + ps3 * rmat[2 * NDST + D_O1F] + ps4 * rmat[3 * NDST + D_O1F] + ps5 * rmat[4 * NDST + D_O1F] + ps6 * rmat[5 * NDST + D_O1F] + ps7 * rmat[6 * NDST + D_O1F];
    const m1: f32 = ps1 * rmat[0 * NDST + D_O2F] + ps2 * rmat[1 * NDST + D_O2F] + ps3 * rmat[2 * NDST + D_O2F] + ps4 * rmat[3 * NDST + D_O2F] + ps5 * rmat[4 * NDST + D_O2F] + ps6 * rmat[5 * NDST + D_O2F] + ps7 * rmat[6 * NDST + D_O2F];
    const m2: f32 = ps1 * rmat[0 * NDST + D_O3F] + ps2 * rmat[1 * NDST + D_O3F] + ps3 * rmat[2 * NDST + D_O3F] + ps4 * rmat[3 * NDST + D_O3F] + ps5 * rmat[4 * NDST + D_O3F] + ps6 * rmat[5 * NDST + D_O3F] + ps7 * rmat[6 * NDST + D_O3F];
    const m3: f32 = ps1 * rmat[0 * NDST + D_O4F] + ps2 * rmat[1 * NDST + D_O4F] + ps3 * rmat[2 * NDST + D_O4F] + ps4 * rmat[3 * NDST + D_O4F] + ps5 * rmat[4 * NDST + D_O4F] + ps6 * rmat[5 * NDST + D_O4F] + ps7 * rmat[6 * NDST + D_O4F];
    const mc: f32 = ps1 * rmat[0 * NDST + D_CUT] + ps2 * rmat[1 * NDST + D_CUT] + ps3 * rmat[2 * NDST + D_CUT] + ps4 * rmat[3 * NDST + D_CUT] + ps5 * rmat[4 * NDST + D_CUT] + ps6 * rmat[5 * NDST + D_CUT] + ps7 * rmat[6 * NDST + D_CUT];

    // ---- oscillators (with matrix FM, +/-2 octaves per bus) ----
    let f1: f32 = curFreq * pow2(clampf(m0, -2.0, 2.0) * 2.0); if (f1 < 0.02) f1 = 0.02; if (f1 > nyq) f1 = nyq;
    let f2: f32 = f2b     * pow2(clampf(m1, -2.0, 2.0) * 2.0); if (f2 < 0.02) f2 = 0.02; if (f2 > nyq) f2 = nyq;
    let f3: f32 = f3b     * pow2(clampf(m2, -2.0, 2.0) * 2.0); if (f3 < 0.02) f3 = 0.02; if (f3 > nyq) f3 = nyq;
    let f4: f32 = f4b     * pow2(clampf(m3, -2.0, 2.0) * 2.0); if (f4 < 0.02) f4 = 0.02; if (f4 > nyq) f4 = nyq;

    ph1 += f1 / sampleRate; if (ph1 >= 1.0) ph1 -= 1.0;
    ph2 += f2 / sampleRate; if (ph2 >= 1.0) ph2 -= 1.0;
    ph3 += f3 / sampleRate; if (ph3 >= 1.0) ph3 -= 1.0;
    ph4 += f4 / sampleRate; if (ph4 >= 1.0) ph4 -= 1.0;

    const s1: f32 = ph1 * 2.0 - 1.0;                      // OSC1 saw
    const s2: f32 = f32(Mathf.sin(ph2 * TAU));            // OSC2 sine
    const s3: f32 = 4.0 * f32(Mathf.abs(ph3 - 0.5)) - 1.0; // OSC3 triangle
    const s4: f32 = ph4 < 0.5 ? 1.0 : -1.0;              // OSC4 pulse
    const s5: f32 = s1 * s2;                              // RING = OSC1 x OSC2
    nz += noiseCoef * (rnd() - nz);
    const s6: f32 = nz * 1.6;                             // NOISE (coloured)
    const s7: f32 = amp;                                 // ENV (unipolar 0..1)

    // ---- audio buses from CURRENT sources ----
    const filtIn: f32 = s1 * rmat[0 * NDST + D_FIN] + s2 * rmat[1 * NDST + D_FIN] + s3 * rmat[2 * NDST + D_FIN] + s4 * rmat[3 * NDST + D_FIN] + s6 * rmat[4 * NDST + D_FIN] + s5 * rmat[5 * NDST + D_FIN] + s7 * rmat[6 * NDST + D_FIN];
    const outBus: f32 = s1 * rmat[0 * NDST + D_OUT] + s2 * rmat[1 * NDST + D_OUT] + s3 * rmat[2 * NDST + D_OUT] + s4 * rmat[3 * NDST + D_OUT] + s6 * rmat[4 * NDST + D_OUT] + s5 * rmat[5 * NDST + D_OUT] + s7 * rmat[6 * NDST + D_OUT];

    // ---- state-variable low-pass (high-Q / near self-oscillating) ----
    let fc: f32 = baseCut * pow2(clampf(mc, -2.0, 3.0) * 2.0);
    if (fc < 20.0) fc = 20.0; if (fc > nyq) fc = nyq;
    const g: f32 = f32(Mathf.tan(3.14159265 * fc / sampleRate));
    const a1c: f32 = 1.0 / (1.0 + g * (g + kRes));
    const hp: f32 = (filtIn - (g + kRes) * bp - lp) * a1c;
    const bpN: f32 = g * hp + bp; const lpN: f32 = g * bpN + lp; bp = bpN; lp = lpN;
    let audio: f32 = f32(Mathf.tanh(lpN * 1.2)) + outBus;

    // ---- spring-ish reverb ----
    const ca: f32 = rvaBuf[ria]; const cb: f32 = rvbBuf[rib];
    rvaBuf[ria] = audio + ca * 0.80; rvbBuf[rib] = audio + cb * 0.78;
    ria++; if (ria >= RVA) ria = 0; rib++; if (rib >= RVB) rib = 0;
    const cs: f32 = (ca + cb) * 0.5;
    const apv: f32 = rvpBuf[rip]; const apOut: f32 = -0.6 * cs + apv; rvpBuf[rip] = cs + 0.6 * apOut;
    rip++; if (rip >= RVP) rip = 0;
    const mixed: f32 = audio + apOut * revN * 0.9;

    const o: f32 = f32(Mathf.tanh(mixed * amp * vel * outScale * 1.7));
    const dc: f32 = o - dcX + 0.9975 * dcY; dcX = o; dcY = dc;   // remove DC
    outBuf[i] = dc; outBuf[MAX_FRAMES + i] = dc;

    // remember sources for next sample's modulation
    ps1 = s1; ps2 = s2; ps3 = s3; ps4 = s4; ps5 = s6; ps6 = s5; ps7 = s7;
  }
}
