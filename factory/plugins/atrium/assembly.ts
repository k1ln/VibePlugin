// =====================================================================
//  ATRIUM — natural, bright digital AMBIENCE room reverb
//
//  A dense early-reflection cloud feeding a smooth, airy diffuse tail.
//  The design targets the "invisible", ultra-natural ambience of a fine
//  digital room processor: high-diffusion input allpasses scatter the
//  signal into a cloud, which drives an 8-line feedback delay network
//  (FDN) built from mutually-prime delays for a colourless, metallic-ring
//  free decay. A gentle high-frequency air shelf opens the top without
//  the dark, boxy tone of cheaper rooms; per-channel decorrelation gives
//  a wide, enveloping stereo image that can collapse to mono.
//
//  Params: Mix, Size, Decay, Diffusion, Air, Width.
//    Size      scales every delay (small ambience -> large room)
//    Decay     sets the FDN feedback (tail length)
//    Diffusion thickens the input scatter / density
//    Air       opens the HF (damping -> brightness)
//    Width     stereo spread of the wet field (0 mono, 1 full)
//    Mix=0    -> essentially dry
//
//  Pure algorithm, no samples. All f32, no allocation in process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const P_MIX:  i32 = 0; // 0..1 dry/wet
const P_SIZE: i32 = 1; // 0..1 small ambience -> large room
const P_DECAY:i32 = 2; // 0..1 tail length
const P_DIFF: i32 = 3; // 0..1 density / diffusion
const P_AIR:  i32 = 4; // 0..1 HF openness
const P_WIDTH:i32 = 5; // 0..1 stereo width

const PI: f32 = 3.14159265358979;

// ---------------------------------------------------------------------
//  Buffer sizes. Delays are scaled by Size at run time but never exceed
//  these allocations. Picked near mutually-prime lengths (at 48k) to keep
//  the modal density even and avoid flutter/metallic ring.
// ---------------------------------------------------------------------

// Input diffusion allpasses (4 per channel) — short, scatter the attack.
const AP_LEN: i32 = 2048;
const AP0L: StaticArray<f32> = new StaticArray<f32>(AP_LEN);
const AP1L: StaticArray<f32> = new StaticArray<f32>(AP_LEN);
const AP2L: StaticArray<f32> = new StaticArray<f32>(AP_LEN);
const AP3L: StaticArray<f32> = new StaticArray<f32>(AP_LEN);
const AP0R: StaticArray<f32> = new StaticArray<f32>(AP_LEN);
const AP1R: StaticArray<f32> = new StaticArray<f32>(AP_LEN);
const AP2R: StaticArray<f32> = new StaticArray<f32>(AP_LEN);
const AP3R: StaticArray<f32> = new StaticArray<f32>(AP_LEN);

// base allpass delays (samples @ 48k) and their per-loop gains
const apBase0: f32 = 142.0;
const apBase1: f32 = 379.0;
const apBase2: f32 = 107.0;
const apBase3: f32 = 277.0;

// FDN: 8 comb-like delay lines with damping.
const FDN_N: i32 = 8;
const FDN_LEN: i32 = 8192;
const D0: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const D1: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const D2: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const D3: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const D4: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const D5: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const D6: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);
const D7: StaticArray<f32> = new StaticArray<f32>(FDN_LEN);

// base FDN delays @ 48k (samples), roughly mutually prime
const fdnBase: StaticArray<f32> = new StaticArray<f32>(FDN_N);

// write heads
let apW0L: i32 = 0; let apW1L: i32 = 0; let apW2L: i32 = 0; let apW3L: i32 = 0;
let apW0R: i32 = 0; let apW1R: i32 = 0; let apW2R: i32 = 0; let apW3R: i32 = 0;
const fdnW: StaticArray<i32> = new StaticArray<i32>(FDN_N);

// per-line damping state (one-pole LP inside the feedback path)
const damp: StaticArray<f32> = new StaticArray<f32>(FDN_N);

// tone shaping states
const dcL: StaticArray<f32> = new StaticArray<f32>(1); // DC block
const dcR: StaticArray<f32> = new StaticArray<f32>(1);
let airLpL: f32 = 0.0; let airLpR: f32 = 0.0; // for HF air shelf

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  for (let i = 0; i < AP_LEN; i++) {
    AP0L[i] = 0.0; AP1L[i] = 0.0; AP2L[i] = 0.0; AP3L[i] = 0.0;
    AP0R[i] = 0.0; AP1R[i] = 0.0; AP2R[i] = 0.0; AP3R[i] = 0.0;
  }
  for (let i = 0; i < FDN_LEN; i++) {
    D0[i] = 0.0; D1[i] = 0.0; D2[i] = 0.0; D3[i] = 0.0;
    D4[i] = 0.0; D5[i] = 0.0; D6[i] = 0.0; D7[i] = 0.0;
  }
  apW0L = 0; apW1L = 0; apW2L = 0; apW3L = 0;
  apW0R = 0; apW1R = 0; apW2R = 0; apW3R = 0;

  // mutually-prime-ish base lengths (samples @ 48k)
  fdnBase[0] = 1153.0; fdnBase[1] = 1523.0; fdnBase[2] = 1777.0; fdnBase[3] = 2089.0;
  fdnBase[4] = 2371.0; fdnBase[5] = 2671.0; fdnBase[6] = 2953.0; fdnBase[7] = 3331.0;

  for (let i = 0; i < FDN_N; i++) { fdnW[i] = 0; damp[i] = 0.0; }
  dcL[0] = 0.0; dcR[0] = 0.0;
  airLpL = 0.0; airLpR = 0.0;

  params[P_MIX] = 0.35;
  params[P_SIZE] = 0.5;
  params[P_DECAY] = 0.55;
  params[P_DIFF] = 0.7;
  params[P_AIR] = 0.6;
  params[P_WIDTH] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

// One allpass step: read delayed sample at `dl`, write input + fb*delayed,
// return delayed - fb*input. Index wrapping by modulo on the static array.
@inline function apStep(buf: StaticArray<f32>, w: i32, dl: i32, len: i32, x: f32, g: f32): f32 {
  let r: i32 = w - dl;
  if (r < 0) r += len;
  const dlyd: f32 = buf[r];
  const v: f32 = x + dlyd * g;
  buf[w] = v;
  return dlyd - v * g;
}

export function process(n: i32): void {
  const mix: f32   = clampf(params[P_MIX], 0.0, 1.0);
  const sizeN: f32 = clampf(params[P_SIZE], 0.0, 1.0);
  const decayN: f32= clampf(params[P_DECAY], 0.0, 1.0);
  const diffN: f32 = clampf(params[P_DIFF], 0.0, 1.0);
  const airN: f32  = clampf(params[P_AIR], 0.0, 1.0);
  const widthN: f32= clampf(params[P_WIDTH], 0.0, 1.0);

  // sample-rate compensation so tuning holds away from 48k
  const srScale: f32 = sampleRate / 48000.0;

  // Size scales every delay: 0.45x (tight ambience) .. 1.6x (large room)
  const sizeMul: f32 = (0.45 + sizeN * 1.15) * srScale;

  // resolved FDN delay lengths
  let dl0: i32 = i32(fdnBase[0] * sizeMul); if (dl0 < 1) dl0 = 1; if (dl0 >= FDN_LEN) dl0 = FDN_LEN - 1;
  let dl1: i32 = i32(fdnBase[1] * sizeMul); if (dl1 < 1) dl1 = 1; if (dl1 >= FDN_LEN) dl1 = FDN_LEN - 1;
  let dl2: i32 = i32(fdnBase[2] * sizeMul); if (dl2 < 1) dl2 = 1; if (dl2 >= FDN_LEN) dl2 = FDN_LEN - 1;
  let dl3: i32 = i32(fdnBase[3] * sizeMul); if (dl3 < 1) dl3 = 1; if (dl3 >= FDN_LEN) dl3 = FDN_LEN - 1;
  let dl4: i32 = i32(fdnBase[4] * sizeMul); if (dl4 < 1) dl4 = 1; if (dl4 >= FDN_LEN) dl4 = FDN_LEN - 1;
  let dl5: i32 = i32(fdnBase[5] * sizeMul); if (dl5 < 1) dl5 = 1; if (dl5 >= FDN_LEN) dl5 = FDN_LEN - 1;
  let dl6: i32 = i32(fdnBase[6] * sizeMul); if (dl6 < 1) dl6 = 1; if (dl6 >= FDN_LEN) dl6 = FDN_LEN - 1;
  let dl7: i32 = i32(fdnBase[7] * sizeMul); if (dl7 < 1) dl7 = 1; if (dl7 >= FDN_LEN) dl7 = FDN_LEN - 1;

  // allpass delays scaled by size too
  let ad0: i32 = i32(apBase0 * sizeMul); if (ad0 < 1) ad0 = 1; if (ad0 >= AP_LEN) ad0 = AP_LEN - 1;
  let ad1: i32 = i32(apBase1 * sizeMul); if (ad1 < 1) ad1 = 1; if (ad1 >= AP_LEN) ad1 = AP_LEN - 1;
  let ad2: i32 = i32(apBase2 * sizeMul); if (ad2 < 1) ad2 = 1; if (ad2 >= AP_LEN) ad2 = AP_LEN - 1;
  let ad3: i32 = i32(apBase3 * sizeMul); if (ad3 < 1) ad3 = 1; if (ad3 >= AP_LEN) ad3 = AP_LEN - 1;

  // Decay -> feedback gain. A longer mean delay needs slightly higher gain
  // for the same RT60, but we keep it simple and bounded well under 1.
  const fb: f32 = 0.62 + decayN * 0.355; // 0.62 .. 0.975

  // Diffusion -> allpass coefficient (density of the scatter cloud)
  const apG: f32 = 0.45 + diffN * 0.3; // 0.45 .. 0.75

  // Air -> damping: high air = bright (little HF loss in the loop).
  // damping coeff is the one-pole LP amount applied to each line's feedback.
  // airN=1 -> almost no damping (bright/airy); airN=0 -> dark room.
  const dampCoef: f32 = 0.55 - airN * 0.5; // 0.55 (dark) .. 0.05 (open)

  // input HF air shelf: gently lift the very top of the wet signal
  const airHz: f32 = 2500.0 + airN * 9000.0;
  const airC: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * airHz / sampleRate));

  // DC blocker coefficient
  const dcR_c: f32 = 0.9985;

  // FDN normalisation: an 8x8 orthogonal-ish (Hadamard) mix keeps energy
  // bounded; scale output of the mix by 1/sqrt(N)*... we fold that into fb.
  const had: f32 = 0.35355339; // 1/sqrt(8)

  // width: blend mid/side. wMid scales the common part, wSide the difference.
  const wSide: f32 = widthN;
  const wMid: f32 = 1.0;

  const inputGain: f32 = 0.5 + diffN * 0.2; // slightly hotter cloud at high diffusion

  for (let f = 0; f < n; f++) {
    const xL: f32 = inBuf[f];
    const xR: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : xL;

    // --- input diffusion: 4 cascaded allpasses per channel ---
    let dL: f32 = xL * inputGain;
    dL = apStep(AP0L, apW0L, ad0, AP_LEN, dL, apG);
    dL = apStep(AP1L, apW1L, ad1, AP_LEN, dL, apG);
    dL = apStep(AP2L, apW2L, ad2, AP_LEN, dL, apG);
    dL = apStep(AP3L, apW3L, ad3, AP_LEN, dL, apG);

    let dR: f32 = xR * inputGain;
    dR = apStep(AP0R, apW0R, ad0, AP_LEN, dR, apG);
    dR = apStep(AP1R, apW1R, ad1, AP_LEN, dR, apG);
    dR = apStep(AP2R, apW2R, ad2, AP_LEN, dR, apG);
    dR = apStep(AP3R, apW3R, ad3, AP_LEN, dR, apG);

    apW0L++; if (apW0L >= AP_LEN) apW0L = 0;
    apW1L++; if (apW1L >= AP_LEN) apW1L = 0;
    apW2L++; if (apW2L >= AP_LEN) apW2L = 0;
    apW3L++; if (apW3L >= AP_LEN) apW3L = 0;
    apW0R++; if (apW0R >= AP_LEN) apW0R = 0;
    apW1R++; if (apW1R >= AP_LEN) apW1R = 0;
    apW2R++; if (apW2R >= AP_LEN) apW2R = 0;
    apW3R++; if (apW3R >= AP_LEN) apW3R = 0;

    // --- read the 8 FDN delay outputs ---
    let r0: i32 = fdnW[0] - dl0; if (r0 < 0) r0 += FDN_LEN;
    let r1: i32 = fdnW[1] - dl1; if (r1 < 0) r1 += FDN_LEN;
    let r2: i32 = fdnW[2] - dl2; if (r2 < 0) r2 += FDN_LEN;
    let r3: i32 = fdnW[3] - dl3; if (r3 < 0) r3 += FDN_LEN;
    let r4: i32 = fdnW[4] - dl4; if (r4 < 0) r4 += FDN_LEN;
    let r5: i32 = fdnW[5] - dl5; if (r5 < 0) r5 += FDN_LEN;
    let r6: i32 = fdnW[6] - dl6; if (r6 < 0) r6 += FDN_LEN;
    let r7: i32 = fdnW[7] - dl7; if (r7 < 0) r7 += FDN_LEN;

    let s0: f32 = D0[r0];
    let s1: f32 = D1[r1];
    let s2: f32 = D2[r2];
    let s3: f32 = D3[r3];
    let s4: f32 = D4[r4];
    let s5: f32 = D5[r5];
    let s6: f32 = D6[r6];
    let s7: f32 = D7[r7];

    // --- per-line damping (one-pole LP in the feedback) ---
    let m0: f32 = damp[0] + dampCoef * (s0 - damp[0]); damp[0] = m0;
    let m1: f32 = damp[1] + dampCoef * (s1 - damp[1]); damp[1] = m1;
    let m2: f32 = damp[2] + dampCoef * (s2 - damp[2]); damp[2] = m2;
    let m3: f32 = damp[3] + dampCoef * (s3 - damp[3]); damp[3] = m3;
    let m4: f32 = damp[4] + dampCoef * (s4 - damp[4]); damp[4] = m4;
    let m5: f32 = damp[5] + dampCoef * (s5 - damp[5]); damp[5] = m5;
    let m6: f32 = damp[6] + dampCoef * (s6 - damp[6]); damp[6] = m6;
    let m7: f32 = damp[7] + dampCoef * (s7 - damp[7]); damp[7] = m7;

    // --- 8-point Hadamard mix (lossless rotation, colourless decay) ---
    const a0: f32 = m0 + m1; const a1: f32 = m0 - m1;
    const a2: f32 = m2 + m3; const a3: f32 = m2 - m3;
    const a4: f32 = m4 + m5; const a5: f32 = m4 - m5;
    const a6: f32 = m6 + m7; const a7: f32 = m6 - m7;

    const b0: f32 = a0 + a2; const b1: f32 = a1 + a3;
    const b2: f32 = a0 - a2; const b3: f32 = a1 - a3;
    const b4: f32 = a4 + a6; const b5: f32 = a5 + a7;
    const b6: f32 = a4 - a6; const b7: f32 = a5 - a7;

    const h0: f32 = (b0 + b4) * had;
    const h1: f32 = (b1 + b5) * had;
    const h2: f32 = (b2 + b6) * had;
    const h3: f32 = (b3 + b7) * had;
    const h4: f32 = (b0 - b4) * had;
    const h5: f32 = (b1 - b5) * had;
    const h6: f32 = (b2 - b6) * had;
    const h7: f32 = (b3 - b7) * had;

    // --- inject the diffused input and write back with feedback ---
    // alternate channels into the lines so the two sides decorrelate
    D0[fdnW[0]] = dL + h0 * fb;
    D1[fdnW[1]] = dR + h1 * fb;
    D2[fdnW[2]] = dL + h2 * fb;
    D3[fdnW[3]] = dR + h3 * fb;
    D4[fdnW[4]] = dL + h4 * fb;
    D5[fdnW[5]] = dR + h5 * fb;
    D6[fdnW[6]] = dL + h6 * fb;
    D7[fdnW[7]] = dR + h7 * fb;

    fdnW[0]++; if (fdnW[0] >= FDN_LEN) fdnW[0] = 0;
    fdnW[1]++; if (fdnW[1] >= FDN_LEN) fdnW[1] = 0;
    fdnW[2]++; if (fdnW[2] >= FDN_LEN) fdnW[2] = 0;
    fdnW[3]++; if (fdnW[3] >= FDN_LEN) fdnW[3] = 0;
    fdnW[4]++; if (fdnW[4] >= FDN_LEN) fdnW[4] = 0;
    fdnW[5]++; if (fdnW[5] >= FDN_LEN) fdnW[5] = 0;
    fdnW[6]++; if (fdnW[6] >= FDN_LEN) fdnW[6] = 0;
    fdnW[7]++; if (fdnW[7] >= FDN_LEN) fdnW[7] = 0;

    // --- tap the tail: even lines -> L, odd lines -> R ---
    let wetL: f32 = (s0 + s2 + s4 + s6) * 0.32;
    let wetR: f32 = (s1 + s3 + s5 + s7) * 0.32;

    // --- HF air shelf: high-shelf lift on the wet field ---
    airLpL = airLpL + airC * (wetL - airLpL);
    airLpR = airLpR + airC * (wetR - airLpR);
    const hiL: f32 = wetL - airLpL; // high band
    const hiR: f32 = wetR - airLpR;
    const airAmt: f32 = 0.3 + airN * 0.9;
    wetL = wetL + hiL * airAmt;
    wetR = wetR + hiR * airAmt;

    // --- DC block (one-pole high-pass) ---
    const yL: f32 = wetL - dcL[0]; dcL[0] = wetL - yL * (1.0 - dcR_c);
    const yR: f32 = wetR - dcR[0]; dcR[0] = wetR - yR * (1.0 - dcR_c);
    wetL = yL; wetR = yR;

    // --- width: mid/side ---
    const mid: f32 = (wetL + wetR) * 0.5;
    const side: f32 = (wetL - wetR) * 0.5;
    wetL = mid * wMid + side * wSide;
    wetR = mid * wMid - side * wSide;

    // --- dry/wet ---
    const outL: f32 = xL * (1.0 - mix) + wetL * mix;
    const outR: f32 = xR * (1.0 - mix) + wetR * mix;

    outBuf[f] = clampf(outL, -1.2, 1.2);
    if (channels > 1) outBuf[MAX_FRAMES + f] = clampf(outR, -1.2, 1.2);
  }
}
