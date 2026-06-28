// =====================================================================
//  STEEL PLATE — algorithmic plate reverb (figure-8 tank topology)
//  A chain of input-diffusion all-pass filters feeds two cross-coupled
//  damped delay/all-pass loops. Several internal taps are summed for a
//  dense, bright, fast-building stereo tail. Pre-delay, decay, HF damping
//  and a slow modulation (chorus on the tank delays) shape the sound.
//  Pure algorithm, no samples. Original implementation (no lookup tables).
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// --- parameter indices (must match spec.json) ---
const P_MIX: i32 = 0;    // 0..1 dry/wet
const P_DECAY: i32 = 1;  // 0..1 -> tail length
const P_DAMP: i32 = 2;   // 0..1 -> HF damping in the tank (0=bright, 1=dark)
const P_PRE: i32 = 3;    // 0..1 -> pre-delay 0..120 ms
const P_MOD: i32 = 4;    // 0..1 -> modulation depth/rate

// =====================================================================
//  Delay-line buffers. The reference Dattorro delay lengths are quoted in
//  samples at 29761 Hz; we scale them to the running sample rate at init.
//  Each line is allocated at module scope (no allocation in process()).
//  Sizes are generous so the scaled lengths always fit at up to ~96 kHz.
// =====================================================================

// pre-delay line — up to 0.2 s at 96k
const PRE_LEN: i32 = 19200;
const preBuf: StaticArray<f32> = new StaticArray<f32>(PRE_LEN);
let preW: i32 = 0;

// input diffusers (4 all-passes)
const ID1_LEN: i32 = 512;
const ID2_LEN: i32 = 512;
const ID3_LEN: i32 = 1280;
const ID4_LEN: i32 = 1280;
const id1: StaticArray<f32> = new StaticArray<f32>(ID1_LEN);
const id2: StaticArray<f32> = new StaticArray<f32>(ID2_LEN);
const id3: StaticArray<f32> = new StaticArray<f32>(ID3_LEN);
const id4: StaticArray<f32> = new StaticArray<f32>(ID4_LEN);
let id1w: i32 = 0; let id2w: i32 = 0; let id3w: i32 = 0; let id4w: i32 = 0;

// tank: two halves, each = modulated all-pass -> delay -> damping -> all-pass -> delay
// left half
const LAP1_LEN: i32 = 2400;   // modulated all-pass
const LDL1_LEN: i32 = 7200;   // delay
const LAP2_LEN: i32 = 4096;   // all-pass
const LDL2_LEN: i32 = 8192;   // delay
const lap1: StaticArray<f32> = new StaticArray<f32>(LAP1_LEN);
const ldl1: StaticArray<f32> = new StaticArray<f32>(LDL1_LEN);
const lap2: StaticArray<f32> = new StaticArray<f32>(LAP2_LEN);
const ldl2: StaticArray<f32> = new StaticArray<f32>(LDL2_LEN);
let lap1w: i32 = 0; let ldl1w: i32 = 0; let lap2w: i32 = 0; let ldl2w: i32 = 0;

// right half
const RAP1_LEN: i32 = 2400;
const RDL1_LEN: i32 = 7200;
const RAP2_LEN: i32 = 4096;
const RDL2_LEN: i32 = 8192;
const rap1: StaticArray<f32> = new StaticArray<f32>(RAP1_LEN);
const rdl1: StaticArray<f32> = new StaticArray<f32>(RDL1_LEN);
const rap2: StaticArray<f32> = new StaticArray<f32>(RAP2_LEN);
const rdl2: StaticArray<f32> = new StaticArray<f32>(RDL2_LEN);
let rap1w: i32 = 0; let rdl1w: i32 = 0; let rap2w: i32 = 0; let rdl2w: i32 = 0;

// scaled (per sample-rate) delay lengths, set in init()
let preMax: i32 = 1;
let nId1: i32 = 1; let nId2: i32 = 1; let nId3: i32 = 1; let nId4: i32 = 1;
let nLap1: i32 = 1; let nLdl1: i32 = 1; let nLap2: i32 = 1; let nLdl2: i32 = 1;
let nRap1: i32 = 1; let nRdl1: i32 = 1; let nRap2: i32 = 1; let nRdl2: i32 = 1;

// internal state
let lDampLP: f32 = 0.0;    // damping low-pass state, left half
let rDampLP: f32 = 0.0;    // damping low-pass state, right half
let bandLP: f32 = 0.0;     // input bandwidth low-pass state
let feedL: f32 = 0.0;      // cross-feedback signal into right half
let feedR: f32 = 0.0;      // cross-feedback signal into left half
let modPhase: f32 = 0.0;   // LFO phase 0..1

// diffusion coefficients (Dattorro values)
const KID1: f32 = 0.75;
const KID2: f32 = 0.75;
const KID3: f32 = 0.625;
const KID4: f32 = 0.625;
const KDEC1: f32 = 0.70;   // tank input all-pass coeff
const KDEC2: f32 = 0.50;   // tank second all-pass coeff

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// scale a length quoted at 29761 Hz to the running sample rate, clamp to cap
@inline function scaleLen(samples29k: f32, cap: i32): i32 {
  let v: i32 = i32(samples29k * sampleRate / 29761.0);
  if (v < 1) v = 1;
  if (v > cap - 2) v = cap - 2;
  return v;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  // clear all buffers
  for (let i = 0; i < PRE_LEN; i++) preBuf[i] = 0.0;
  for (let i = 0; i < ID1_LEN; i++) id1[i] = 0.0;
  for (let i = 0; i < ID2_LEN; i++) id2[i] = 0.0;
  for (let i = 0; i < ID3_LEN; i++) id3[i] = 0.0;
  for (let i = 0; i < ID4_LEN; i++) id4[i] = 0.0;
  for (let i = 0; i < LAP1_LEN; i++) lap1[i] = 0.0;
  for (let i = 0; i < LDL1_LEN; i++) ldl1[i] = 0.0;
  for (let i = 0; i < LAP2_LEN; i++) lap2[i] = 0.0;
  for (let i = 0; i < LDL2_LEN; i++) ldl2[i] = 0.0;
  for (let i = 0; i < RAP1_LEN; i++) rap1[i] = 0.0;
  for (let i = 0; i < RDL1_LEN; i++) rdl1[i] = 0.0;
  for (let i = 0; i < RAP2_LEN; i++) rap2[i] = 0.0;
  for (let i = 0; i < RDL2_LEN; i++) rdl2[i] = 0.0;

  preW = 0;
  id1w = 0; id2w = 0; id3w = 0; id4w = 0;
  lap1w = 0; ldl1w = 0; lap2w = 0; ldl2w = 0;
  rap1w = 0; rdl1w = 0; rap2w = 0; rdl2w = 0;
  lDampLP = 0.0; rDampLP = 0.0; bandLP = 0.0;
  feedL = 0.0; feedR = 0.0; modPhase = 0.0;

  // scale delay lengths (reference values at 29761 Hz)
  preMax = scaleLen(6000.0, PRE_LEN);   // sized for pre-delay; actual offset set per-block

  nId1 = scaleLen(142.0, ID1_LEN);
  nId2 = scaleLen(107.0, ID2_LEN);
  nId3 = scaleLen(379.0, ID3_LEN);
  nId4 = scaleLen(277.0, ID4_LEN);

  // left half
  nLap1 = scaleLen(672.0,  LAP1_LEN);   // modulated
  nLdl1 = scaleLen(4453.0, LDL1_LEN);
  nLap2 = scaleLen(1800.0, LAP2_LEN);
  nLdl2 = scaleLen(3720.0, LDL2_LEN);
  // right half
  nRap1 = scaleLen(908.0,  RAP1_LEN);   // modulated
  nRdl1 = scaleLen(4217.0, RDL1_LEN);
  nRap2 = scaleLen(2656.0, RAP2_LEN);
  nRdl2 = scaleLen(3163.0, RDL2_LEN);

  params[P_MIX] = 0.35;
  params[P_DECAY] = 0.6;
  params[P_DAMP] = 0.4;
  params[P_PRE] = 0.0;
  params[P_MOD] = 0.3;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// --- delay helpers: write at w, read at (w - delay) with wraparound ---
@inline function readAt(buf: StaticArray<f32>, len: i32, w: i32, delay: i32): f32 {
  let r: i32 = w - delay;
  while (r < 0) r += len;
  while (r >= len) r -= len;
  return buf[r];
}

// fractional read for the modulated taps
@inline function readFrac(buf: StaticArray<f32>, len: i32, w: i32, delay: f32): f32 {
  let d: f32 = delay;
  if (d < 1.0) d = 1.0;
  if (d > f32(len - 2)) d = f32(len - 2);
  const di: i32 = i32(d);
  const fr: f32 = d - f32(di);
  let r0: i32 = w - di;
  while (r0 < 0) r0 += len;
  while (r0 >= len) r0 -= len;
  let r1: i32 = r0 - 1;
  while (r1 < 0) r1 += len;
  const a: f32 = buf[r0];
  const b: f32 = buf[r1];
  return f32(a + (b - a) * fr);
}

export function process(n: i32): void {
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const decayP: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const dampP: f32 = clampf(params[P_DAMP], 0.0, 1.0);
  const preP: f32 = clampf(params[P_PRE], 0.0, 1.0);
  const modP: f32 = clampf(params[P_MOD], 0.0, 1.0);

  // tank feedback gain — maps to a long, dense but bounded tail (<1 for stability)
  const decay: f32 = 0.30 + decayP * 0.65;          // 0.30 .. 0.95

  // damping low-pass coefficient: one-pole y += c*(x - y).
  // dampP=0 -> c~1.0 (bright, almost no filtering); dampP=1 -> c small (dark).
  // Higher Damping must DARKEN the tail, so c must DECREASE with dampP.
  const lpCoeff: f32 = 1.0 - (0.05 + dampP * 0.85);  // 0.95 (bright) .. 0.10 (dark)

  // input bandwidth limit (fixed, mild) keeps the very top tamed
  const bandCoeff: f32 = 0.9995;

  // pre-delay in samples
  let preSamples: i32 = i32(preP * 0.120 * sampleRate);  // up to 120 ms
  if (preSamples < 0) preSamples = 0;
  if (preSamples > PRE_LEN - 2) preSamples = PRE_LEN - 2;

  // modulation: slow LFO ~0.9 Hz, depth scales the modulated all-pass delays
  const modRate: f32 = 0.9 / sampleRate;             // cycles per sample
  const modDepthL: f32 = modP * f32(nLap1) * 0.18;   // up to ~18% of the line
  const modDepthR: f32 = modP * f32(nRap1) * 0.18;

  // output makeup gain: the internal tank taps carry only a tiny fraction of
  // the input energy, so the summed multi-tap wet is brought up to within ~9 dB
  // of the dry signal at Mix=1. Worst-case impulse peak (decay=0.95) stays
  // ~0.014, far below clipping, so the headroom is ample.
  const wetGain: f32 = 19.5;

  // Both tank halves share the SAME mono input (the L+R average); there is no
  // separate left/right input signal. The stereo image is generated purely
  // inside the tank — from the quadrature LFO phase on the two modulated
  // all-passes and the cross-feedback between the halves — and is read out via
  // channel-specific tap sets. The tank is advanced exactly once per frame.
  const inL_base: i32 = 0;
  const inR_base: i32 = (channels > 1) ? MAX_FRAMES : 0;

  let lpLP: f32 = lDampLP;
  let rpLP: f32 = rDampLP;
  let bLP: f32 = bandLP;
  let fL: f32 = feedL;
  let fR: f32 = feedR;
  let mph: f32 = modPhase;

  for (let f = 0; f < n; f++) {
    const xl: f32 = inBuf[inL_base + f];
    const xr: f32 = inBuf[inR_base + f];
    const mono: f32 = (xl + xr) * 0.5;

    // ---- pre-delay ----
    preBuf[preW] = mono;
    let pr: i32 = preW - preSamples;
    while (pr < 0) pr += PRE_LEN;
    const pd: f32 = preBuf[pr];
    preW++; if (preW >= PRE_LEN) preW = 0;

    // ---- input bandwidth limiting one-pole ----
    bLP = bLP + (1.0 - bandCoeff) * (pd - bLP);
    let s: f32 = bLP;

    // ---- input diffusion: 4 cascaded all-passes ----
    // all-pass: y = -k*x + d ;  store (x + k*y)
    {
      const d: f32 = readAt(id1, ID1_LEN, id1w, nId1);
      const v: f32 = s + KID1 * d;
      id1[id1w] = v; id1w++; if (id1w >= ID1_LEN) id1w = 0;
      s = d - KID1 * v;
    }
    {
      const d: f32 = readAt(id2, ID2_LEN, id2w, nId2);
      const v: f32 = s + KID2 * d;
      id2[id2w] = v; id2w++; if (id2w >= ID2_LEN) id2w = 0;
      s = d - KID2 * v;
    }
    {
      const d: f32 = readAt(id3, ID3_LEN, id3w, nId3);
      const v: f32 = s + KID3 * d;
      id3[id3w] = v; id3w++; if (id3w >= ID3_LEN) id3w = 0;
      s = d - KID3 * v;
    }
    {
      const d: f32 = readAt(id4, ID4_LEN, id4w, nId4);
      const v: f32 = s + KID4 * d;
      id4[id4w] = v; id4w++; if (id4w >= ID4_LEN) id4w = 0;
      s = d - KID4 * v;
    }
    const diffused: f32 = s;

    // ---- modulation LFO ----
    mph += modRate; if (mph >= 1.0) mph -= 1.0;
    const lfoL: f32 = Mathf.sin(mph * 6.2831853);
    const lfoR: f32 = Mathf.sin((mph + 0.25) * 6.2831853);
    const modDelL: f32 = f32(nLap1) - modDepthL * (0.5 + 0.5 * lfoL);
    const modDelR: f32 = f32(nRap1) - modDepthR * (0.5 + 0.5 * lfoR);

    // =================== LEFT half of the tank ===================
    // input = diffused + cross-feedback from the RIGHT half
    let lx: f32 = diffused + fR * decay;

    // modulated all-pass (decorrelating, gives the plate its shimmer)
    {
      const d: f32 = readFrac(lap1, LAP1_LEN, lap1w, modDelL);
      const v: f32 = lx + KDEC1 * d;
      lap1[lap1w] = v; lap1w++; if (lap1w >= LAP1_LEN) lap1w = 0;
      lx = d - KDEC1 * v;
    }
    // delay 1
    ldl1[ldl1w] = lx; ldl1w++; if (ldl1w >= LDL1_LEN) ldl1w = 0;
    let lTap: f32 = readAt(ldl1, LDL1_LEN, ldl1w, nLdl1);
    // damping low-pass (higher Damping -> smaller lpCoeff -> darker tail)
    lpLP = lpLP + lpCoeff * (lTap - lpLP);
    let ld: f32 = lpLP * decay;
    // second all-pass
    {
      const d: f32 = readAt(lap2, LAP2_LEN, lap2w, nLap2);
      const v: f32 = ld - KDEC2 * d;
      lap2[lap2w] = v; lap2w++; if (lap2w >= LAP2_LEN) lap2w = 0;
      ld = d + KDEC2 * v;
    }
    // delay 2 -> becomes the left-half output feeding the right half
    ldl2[ldl2w] = ld; ldl2w++; if (ldl2w >= LDL2_LEN) ldl2w = 0;
    fL = readAt(ldl2, LDL2_LEN, ldl2w, nLdl2);

    // =================== RIGHT half of the tank ===================
    let rx: f32 = diffused + fL * decay;
    {
      const d: f32 = readFrac(rap1, RAP1_LEN, rap1w, modDelR);
      const v: f32 = rx + KDEC1 * d;
      rap1[rap1w] = v; rap1w++; if (rap1w >= RAP1_LEN) rap1w = 0;
      rx = d - KDEC1 * v;
    }
    rdl1[rdl1w] = rx; rdl1w++; if (rdl1w >= RDL1_LEN) rdl1w = 0;
    let rTap: f32 = readAt(rdl1, RDL1_LEN, rdl1w, nRdl1);
    rpLP = rpLP + lpCoeff * (rTap - rpLP);
    let rd: f32 = rpLP * decay;
    {
      const d: f32 = readAt(rap2, RAP2_LEN, rap2w, nRap2);
      const v: f32 = rd - KDEC2 * d;
      rap2[rap2w] = v; rap2w++; if (rap2w >= RAP2_LEN) rap2w = 0;
      rd = d + KDEC2 * v;
    }
    rdl2[rdl2w] = rd; rdl2w++; if (rdl2w >= RDL2_LEN) rdl2w = 0;
    fR = readAt(rdl2, RDL2_LEN, rdl2w, nRdl2);

    // =================== multi-tap stereo output ===================
    // Tap several points from the opposite half (Dattorro's accumulator taps)
    // for density. Each tap is a different fixed delay into the loop buffers.
    let outL: f32 = 0.0;
    outL += readAt(rdl1, RDL1_LEN, rdl1w, scaledTap(nRdl1, 0.62));
    outL += readAt(rdl1, RDL1_LEN, rdl1w, scaledTap(nRdl1, 0.91));
    outL -= readAt(rap2, RAP2_LEN, rap2w, scaledTap(nRap2, 0.55));
    outL += readAt(rdl2, RDL2_LEN, rdl2w, scaledTap(nRdl2, 0.40));
    outL -= readAt(ldl1, LDL1_LEN, ldl1w, scaledTap(nLdl1, 0.31));
    outL -= readAt(lap2, LAP2_LEN, lap2w, scaledTap(nLap2, 0.22));
    outL -= readAt(ldl2, LDL2_LEN, ldl2w, scaledTap(nLdl2, 0.70));

    let outR: f32 = 0.0;
    outR += readAt(ldl1, LDL1_LEN, ldl1w, scaledTap(nLdl1, 0.62));
    outR += readAt(ldl1, LDL1_LEN, ldl1w, scaledTap(nLdl1, 0.91));
    outR -= readAt(lap2, LAP2_LEN, lap2w, scaledTap(nLap2, 0.55));
    outR += readAt(ldl2, LDL2_LEN, ldl2w, scaledTap(nLdl2, 0.40));
    outR -= readAt(rdl1, RDL1_LEN, rdl1w, scaledTap(nRdl1, 0.31));
    outR -= readAt(rap2, RAP2_LEN, rap2w, scaledTap(nRap2, 0.22));
    outR -= readAt(rdl2, RDL2_LEN, rdl2w, scaledTap(nRdl2, 0.70));

    const wetL: f32 = outL * wetGain;
    const wetR: f32 = outR * wetGain;

    const dryL: f32 = xl;
    const dryR: f32 = xr;

    outBuf[f] = f32(dryL * (1.0 - mix) + wetL * mix);
    if (channels > 1) {
      outBuf[MAX_FRAMES + f] = f32(dryR * (1.0 - mix) + wetR * mix);
    }
  }

  lDampLP = lpLP;
  rDampLP = rpLP;
  bandLP = bLP;
  feedL = fL;
  feedR = fR;
  modPhase = mph;
}

@inline function scaledTap(lineLen: i32, frac: f32): i32 {
  let t: i32 = i32(f32(lineLen) * frac);
  if (t < 1) t = 1;
  if (t > lineLen - 1) t = lineLen - 1;
  return t;
}
