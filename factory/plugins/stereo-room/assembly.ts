// =====================================================================
//  STEREO ROOM — early-digital stereo room reverb (effect)
//  Models the tight, defined character of an early-1980s digital room
//  box: a stereo MULTITAP early-reflection network (discrete, panned
//  reflections off the room walls) feeding a short-to-medium DIFFUSE
//  tail built from a Schroeder allpass diffuser into a small feedback
//  delay network. A gentle damping low-pass plus subtle quantisation
//  on the feedback path give the slightly grainy vintage-digital grain.
//
//  Params: Mix, Size, Decay, Diffusion, Pre-Delay.
//  Mix = 0 is bit-exact dry. Output is bounded well under full scale.
//  Pure algorithm, no samples, no imports, no alloc in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const PI: f32 = 3.14159265358979;

// --- parameter indices ---
const P_MIX:  i32 = 0;  // 0..1 dry/wet  (0 = bit-exact dry)
const P_SIZE: i32 = 1;  // 0..1 small room -> large room (scales all delays)
const P_DECAY:i32 = 2;  // 0..1 tail decay time (feedback amount)
const P_DIFF: i32 = 3;  // 0..1 diffusion (allpass coefficient + ER density)
const P_PRE:  i32 = 4;  // 0..1 pre-delay 0..120 ms

// --------------------------------------------------------------------
//  Buffer sizes. Everything is sized for the LARGEST room and longest
//  pre-delay at 48k-ish rates, then read with a scaled tap so Size can
//  shrink the geometry without reallocating. All pow-of-two for cheap
//  masking where convenient, but plain modulo is fine and clearer.
// --------------------------------------------------------------------

// pre-delay line: up to ~150 ms @ 48k
const PRE_LEN: i32 = 8192;            // 8192 / 48000 ~= 170 ms
const preL: StaticArray<f32> = new StaticArray<f32>(PRE_LEN);
const preR: StaticArray<f32> = new StaticArray<f32>(PRE_LEN);
let preW: i32 = 0;

// early-reflection multitap line (post pre-delay). ~80 ms max geometry.
const ER_LEN: i32 = 4096;             // 4096 / 48000 ~= 85 ms
const erL: StaticArray<f32> = new StaticArray<f32>(ER_LEN);
const erR: StaticArray<f32> = new StaticArray<f32>(ER_LEN);
let erW: i32 = 0;

// 8 multitap reflections per channel. Base tap times (samples @ 48k) and
// gains form an asymmetric stereo pattern off the room walls.
const ER_TAPS: i32 = 8;
const tapL:  StaticArray<f32> = new StaticArray<f32>(ER_TAPS); // base delay (samples)
const tapR:  StaticArray<f32> = new StaticArray<f32>(ER_TAPS);
const tapGL: StaticArray<f32> = new StaticArray<f32>(ER_TAPS);
const tapGR: StaticArray<f32> = new StaticArray<f32>(ER_TAPS);

// --- diffuser: 2 series allpasses per channel ---
const AP1_LEN: i32 = 1024;
const AP2_LEN: i32 = 1024;
const ap1L: StaticArray<f32> = new StaticArray<f32>(AP1_LEN);
const ap1R: StaticArray<f32> = new StaticArray<f32>(AP1_LEN);
const ap2L: StaticArray<f32> = new StaticArray<f32>(AP2_LEN);
const ap2R: StaticArray<f32> = new StaticArray<f32>(AP2_LEN);
let ap1W: i32 = 0;
let ap2W: i32 = 0;
const AP1_BASE: i32 = 142;            // samples @ 48k
const AP2_BASE: i32 = 379;
const AP1_OFF:  i32 = 23;             // small L/R offset for width
const AP2_OFF:  i32 = 41;

// --- feedback delay network: 4 comb-style delay lines ---
const FDN_LEN: i32 = 4096;
const d0: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const d1: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const d2: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const d3: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
let dW0: i32 = 0;
let dW1: i32 = 0;
let dW2: i32 = 0;
let dW3: i32 = 0;
// base delay lengths (samples @ 48k) — mutually prime-ish for density
const FDN_B0: i32 = 1116;
const FDN_B1: i32 = 1356;
const FDN_B2: i32 = 1722;
const FDN_B3: i32 = 1991;

// per-line damping low-pass state
let damp0: f32 = 0.0;
let damp1: f32 = 0.0;
let damp2: f32 = 0.0;
let damp3: f32 = 0.0;

// --------------------------------------------------------------------

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  // clear all state
  for (let i = 0; i < PRE_LEN; i++) { preL[i] = 0.0; preR[i] = 0.0; }
  for (let i = 0; i < ER_LEN;  i++) { erL[i] = 0.0;  erR[i] = 0.0;  }
  for (let i = 0; i < AP1_LEN; i++) { ap1L[i] = 0.0; ap1R[i] = 0.0; }
  for (let i = 0; i < AP2_LEN; i++) { ap2L[i] = 0.0; ap2R[i] = 0.0; }
  for (let i = 0; i < FDN_LEN; i++) { d0[i] = 0.0; d1[i] = 0.0; d2[i] = 0.0; d3[i] = 0.0; }
  preW = 0; erW = 0; ap1W = 0; ap2W = 0;
  dW0 = 0; dW1 = 0; dW2 = 0; dW3 = 0;
  damp0 = 0.0; damp1 = 0.0; damp2 = 0.0; damp3 = 0.0;

  // multitap reflection pattern (asymmetric L/R for a real stereo image)
  // delays in samples @ 48k, gains decaying with arrival time
  tapL[0] = 71.0;   tapGL[0] = 0.84;
  tapL[1] = 197.0;  tapGL[1] = 0.72;
  tapL[2] = 421.0;  tapGL[2] = 0.61;
  tapL[3] = 683.0;  tapGL[3] = 0.52;
  tapL[4] = 1009.0; tapGL[4] = 0.43;
  tapL[5] = 1453.0; tapGL[5] = 0.35;
  tapL[6] = 1979.0; tapGL[6] = 0.28;
  tapL[7] = 2557.0; tapGL[7] = 0.22;

  tapR[0] = 113.0;  tapGR[0] = 0.80;
  tapR[1] = 251.0;  tapGR[1] = 0.69;
  tapR[2] = 487.0;  tapGR[2] = 0.58;
  tapR[3] = 769.0;  tapGR[3] = 0.49;
  tapR[4] = 1129.0; tapGR[4] = 0.41;
  tapR[5] = 1567.0; tapGR[5] = 0.33;
  tapR[6] = 2113.0; tapGR[6] = 0.26;
  tapR[7] = 2729.0; tapGR[7] = 0.20;

  params[P_MIX]   = 0.35;
  params[P_SIZE]  = 0.5;
  params[P_DECAY] = 0.5;
  params[P_DIFF]  = 0.7;
  params[P_PRE]   = 0.1;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// read a delay line at an integer sample offset behind the write head
@inline function tap(buf: StaticArray<f32>, len: i32, w: i32, d: i32): f32 {
  let r: i32 = w - d;
  while (r < 0) r += len;
  return buf[r];
}

export function process(n: i32): void {
  const mix: f32  = clampf(params[P_MIX],  0.0, 1.0);
  const size: f32 = clampf(params[P_SIZE], 0.0, 1.0);
  const decay: f32= clampf(params[P_DECAY],0.0, 1.0);
  const diff: f32 = clampf(params[P_DIFF], 0.0, 1.0);
  const preN: f32 = clampf(params[P_PRE],  0.0, 1.0);

  // sample-rate scale relative to the 48k design
  const srScale: f32 = sampleRate / 48000.0;

  // pre-delay 0..120 ms
  let preSamp: i32 = i32(preN * 0.120 * sampleRate);
  if (preSamp < 0) preSamp = 0;
  if (preSamp > PRE_LEN - 1) preSamp = PRE_LEN - 1;

  // Size scales the room geometry: 0.45x (small) .. 1.25x (large)
  const geo: f32 = (0.45 + size * 0.80) * srScale;

  // FDN feedback from Decay: short-to-medium room (never a long hall)
  // 0.0 -> ~0.45 (very short), 1.0 -> ~0.86 (medium tail)
  const fb: f32 = 0.45 + decay * 0.41;

  // diffusion controls allpass coefficient and ER tail blend
  const apC: f32 = 0.45 + diff * 0.30;        // 0.45 .. 0.75

  // damping: a touch more high-cut on bigger / longer settings for realism
  const dampC: f32 = clampf(0.18 + (1.0 - decay) * 0.25, 0.0, 0.9);

  // scaled FDN line lengths (clamped into buffer)
  let l0: i32 = i32(f32(FDN_B0) * geo); if (l0 < 1) l0 = 1; if (l0 > FDN_LEN - 1) l0 = FDN_LEN - 1;
  let l1: i32 = i32(f32(FDN_B1) * geo); if (l1 < 1) l1 = 1; if (l1 > FDN_LEN - 1) l1 = FDN_LEN - 1;
  let l2: i32 = i32(f32(FDN_B2) * geo); if (l2 < 1) l2 = 1; if (l2 > FDN_LEN - 1) l2 = FDN_LEN - 1;
  let l3: i32 = i32(f32(FDN_B3) * geo); if (l3 < 1) l3 = 1; if (l3 > FDN_LEN - 1) l3 = FDN_LEN - 1;

  // scaled allpass lengths
  let a1l: i32 = i32(f32(AP1_BASE) * geo);            if (a1l < 1) a1l = 1; if (a1l > AP1_LEN - 1) a1l = AP1_LEN - 1;
  let a1r: i32 = i32(f32(AP1_BASE + AP1_OFF) * geo);  if (a1r < 1) a1r = 1; if (a1r > AP1_LEN - 1) a1r = AP1_LEN - 1;
  let a2l: i32 = i32(f32(AP2_BASE) * geo);            if (a2l < 1) a2l = 1; if (a2l > AP2_LEN - 1) a2l = AP2_LEN - 1;
  let a2r: i32 = i32(f32(AP2_BASE + AP2_OFF) * geo);  if (a2r < 1) a2r = 1; if (a2r > AP2_LEN - 1) a2r = AP2_LEN - 1;

  // wet output trim so the tail sits well under full scale
  const wetTrim: f32 = 0.32;

  const baseR: i32 = MAX_FRAMES;

  for (let f = 0; f < n; f++) {
    const dryL: f32 = inBuf[f];
    const dryR: f32 = channels > 1 ? inBuf[baseR + f] : dryL;

    // --- pre-delay ---
    preL[preW] = dryL;
    preR[preW] = dryR;
    const pL: f32 = tap(preL, PRE_LEN, preW, preSamp);
    const pR: f32 = tap(preR, PRE_LEN, preW, preSamp);
    preW++; if (preW >= PRE_LEN) preW = 0;

    // --- write into ER line, gather multitap early reflections ---
    erL[erW] = pL;
    erR[erW] = pR;
    let eL: f32 = 0.0;
    let eR: f32 = 0.0;
    for (let t = 0; t < ER_TAPS; t++) {
      let dl: i32 = i32(tapL[t] * geo); if (dl > ER_LEN - 1) dl = ER_LEN - 1;
      let dr: i32 = i32(tapR[t] * geo); if (dr > ER_LEN - 1) dr = ER_LEN - 1;
      // diffusion thins/cross-feeds the later taps for density control
      const g: f32 = 0.4 + diff * 0.6;
      eL += tap(erL, ER_LEN, erW, dl) * tapGL[t] * g;
      eR += tap(erR, ER_LEN, erW, dr) * tapGR[t] * g;
    }
    erW++; if (erW >= ER_LEN) erW = 0;
    eL *= 0.5;
    eR *= 0.5;

    // --- diffuser: 2 series allpasses per channel (feeds the tail) ---
    const inDiffL: f32 = pL + eL * 0.6;
    const inDiffR: f32 = pR + eR * 0.6;

    // allpass 1
    const a1xL: f32 = tap(ap1L, AP1_LEN, ap1W, a1l);
    const a1xR: f32 = tap(ap1R, AP1_LEN, ap1W, a1r);
    const a1yL: f32 = f32(-apC * inDiffL + a1xL);
    const a1yR: f32 = f32(-apC * inDiffR + a1xR);
    ap1L[ap1W] = f32(inDiffL + apC * a1yL);
    ap1R[ap1W] = f32(inDiffR + apC * a1yR);
    ap1W++; if (ap1W >= AP1_LEN) ap1W = 0;

    // allpass 2
    const a2xL: f32 = tap(ap2L, AP2_LEN, ap2W, a2l);
    const a2xR: f32 = tap(ap2R, AP2_LEN, ap2W, a2r);
    const a2yL: f32 = f32(-apC * a1yL + a2xL);
    const a2yR: f32 = f32(-apC * a1yR + a2xR);
    ap2L[ap2W] = f32(a1yL + apC * a2yL);
    ap2R[ap2W] = f32(a1yR + apC * a2yR);
    ap2W++; if (ap2W >= AP2_LEN) ap2W = 0;

    const diffL: f32 = a2yL;
    const diffR: f32 = a2yR;

    // --- feedback delay network (4 lines, lattice mix for stereo tail) ---
    const t0: f32 = tap(d0, FDN_LEN, dW0, l0);
    const t1: f32 = tap(d1, FDN_LEN, dW1, l1);
    const t2: f32 = tap(d2, FDN_LEN, dW2, l2);
    const t3: f32 = tap(d3, FDN_LEN, dW3, l3);

    // damping low-pass on each line (one-pole)
    damp0 = f32(damp0 + (1.0 - dampC) * (t0 - damp0));
    damp1 = f32(damp1 + (1.0 - dampC) * (t1 - damp1));
    damp2 = f32(damp2 + (1.0 - dampC) * (t2 - damp2));
    damp3 = f32(damp3 + (1.0 - dampC) * (t3 - damp3));

    // Householder-style feedback matrix mixing
    const s: f32 = f32((damp0 + damp1 + damp2 + damp3) * 0.5);
    const f0: f32 = f32(s - damp0);
    const f1: f32 = f32(s - damp1);
    const f2: f32 = f32(s - damp2);
    const f3: f32 = f32(s - damp3);

    // inject the diffused signal, apply decay feedback, write lines.
    // subtle vintage-digital grain: quantise the feedback to ~13-bit.
    const qScale: f32 = 4096.0;
    let w0: f32 = f32(diffL + f0 * fb);
    let w1: f32 = f32(diffR + f1 * fb);
    let w2: f32 = f32(diffL * 0.7 + f2 * fb);
    let w3: f32 = f32(diffR * 0.7 + f3 * fb);
    w0 = f32(Mathf.floor(w0 * qScale) / qScale);
    w1 = f32(Mathf.floor(w1 * qScale) / qScale);
    w2 = f32(Mathf.floor(w2 * qScale) / qScale);
    w3 = f32(Mathf.floor(w3 * qScale) / qScale);
    // soft safety clamp on the feedback storage
    d0[dW0] = clampf(w0, -1.2, 1.2);
    d1[dW1] = clampf(w1, -1.2, 1.2);
    d2[dW2] = clampf(w2, -1.2, 1.2);
    d3[dW3] = clampf(w3, -1.2, 1.2);
    dW0++; if (dW0 >= FDN_LEN) dW0 = 0;
    dW1++; if (dW1 >= FDN_LEN) dW1 = 0;
    dW2++; if (dW2 >= FDN_LEN) dW2 = 0;
    dW3++; if (dW3 >= FDN_LEN) dW3 = 0;

    // stereo tap of the tail
    const tailL: f32 = f32((damp0 + damp2) * 0.5);
    const tailR: f32 = f32((damp1 + damp3) * 0.5);

    // wet = early reflections + diffuse tail
    let wetL: f32 = f32((eL + tailL) * wetTrim);
    let wetR: f32 = f32((eR + tailR) * wetTrim);

    // equal-power-ish dry/wet (Mix = 0 -> bit-exact dry)
    const outL: f32 = f32(dryL * (1.0 - mix) + wetL * mix);
    const outR: f32 = f32(dryR * (1.0 - mix) + wetR * mix);

    outBuf[f] = clampf(outL, -1.0, 1.0);
    outBuf[baseR + f] = clampf(outR, -1.0, 1.0);
  }
}
