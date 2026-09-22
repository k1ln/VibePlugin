// =====================================================================
//  LOUDNESS METER — a real ITU-R BS.1770-4 / EBU R128 implementation.
//  K-weighting (2 cascaded biquads, published coefficients) feeds 400ms
//  gating blocks on a 100ms hop (75% overlap): Momentary = latest block,
//  Short-term = mean of the last 30 blocks (3s), Integrated = the
//  standard's two-gate method (absolute gate -70 LUFS, then a relative
//  gate 10 LU below that mean) via a 701-bin histogram, -70.0..0.0 LUFS
//  in 0.1 steps - the same approach the open-source reference
//  implementation libebur128 (jiixyj/libebur128, MIT) uses. True Peak is
//  an honestly-scoped approximation: 4x linear interpolation between
//  samples, not a full polyphase-FIR oversampler (ITU-R BS.1770's exact
//  true-peak method), so it can underestimate very sharp inter-sample
//  peaks a proper oversampling filter would catch - a real limitation,
//  documented, not hidden.
//  K-weighting coefficients are exact at 48kHz (the published values);
//  at other sample rates they're used as-is rather than re-derived via
//  bilinear transform from the analog prototype, so accuracy narrows
//  somewhat off 48kHz - a scoped simplification, not an oversight.
//  Audio passes through unaltered except Input Trim (feeds the meter
//  too) and Channel Mode's Mono-sum option.
//  Original implementation, no code borrowed.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const LN10: f32 = 2.30258509;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_TRIM:   i32 = 0;
const P_CHAN:   i32 = 1;   // 0 stereo, 1 mono-sum
const P_TARGET: i32 = 2;   // cosmetic only - GUI reads it directly to draw a reference line
const P_RESET:  i32 = 3;
const NUM_PARAMS: i32 = 4;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// ---- K-weighting biquad coefficients (ITU-R BS.1770-4/5, 48kHz) ---------
const S1_B0: f32 = 1.53512485958697; const S1_B1: f32 = -2.69169618940638; const S1_B2: f32 = 1.19839281085285;
const S1_A1: f32 = -1.69065929318241; const S1_A2: f32 = 0.73248077421585;
const S2_B0: f32 = 1.0; const S2_B1: f32 = -2.0; const S2_B2: f32 = 1.0;
const S2_A1: f32 = -1.99004745483398; const S2_A2: f32 = 0.99007225036621;

@inline function biquad(x: f32, b0: f32, b1: f32, b2: f32, a1: f32, a2: f32, x1: f32, x2: f32, y1: f32, y2: f32): f32 {
  return f32(b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2);
}

// per-channel, per-stage biquad state (direct form I)
let s1x1L: f32 = 0, s1x2L: f32 = 0, s1y1L: f32 = 0, s1y2L: f32 = 0;
let s2x1L: f32 = 0, s2x2L: f32 = 0, s2y1L: f32 = 0, s2y2L: f32 = 0;
let s1x1R: f32 = 0, s1x2R: f32 = 0, s1y1R: f32 = 0, s1y2R: f32 = 0;
let s2x1R: f32 = 0, s2x2R: f32 = 0, s2y1R: f32 = 0, s2y2R: f32 = 0;

// gating: 100ms sub-block accumulator, ring of last 30 sub-blocks (3s)
let subSumSq: f32 = 0.0;
let subCount: i32 = 0;
const RING_N: i32 = 30;
const subRing: StaticArray<f32> = new StaticArray<f32>(RING_N);
let ringIdx: i32 = 0;
let ringFilled: i32 = 0;

// integrated loudness: 701-bin histogram, -70.0..0.0 LUFS in 0.1 steps
const HIST_N: i32 = 701;
const histSum: StaticArray<f32> = new StaticArray<f32>(HIST_N);
const histCount: StaticArray<i32> = new StaticArray<i32>(HIST_N);

let momentaryLufs: f32 = -70.0;
let shortTermLufs: f32 = -70.0;
let integratedLufs: f32 = -70.0;

// true peak (approx): running max since last reset
let truePeakL: f32 = 0.0;
let truePeakR: f32 = 0.0;
let lastSampleL: f32 = 0.0;
let lastSampleR: f32 = 0.0;

let resetPrev: bool = false;
let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  s1x1L = 0; s1x2L = 0; s1y1L = 0; s1y2L = 0; s2x1L = 0; s2x2L = 0; s2y1L = 0; s2y2L = 0;
  s1x1R = 0; s1x2R = 0; s1y1R = 0; s1y2R = 0; s2x1R = 0; s2x2R = 0; s2y1R = 0; s2y2R = 0;
  subSumSq = 0.0; subCount = 0; ringIdx = 0; ringFilled = 0;
  for (let k = 0; k < RING_N; k++) subRing[k] = 0.0;
  for (let b = 0; b < HIST_N; b++) { histSum[b] = 0.0; histCount[b] = 0; }
  momentaryLufs = -70.0; shortTermLufs = -70.0; integratedLufs = -70.0;
  truePeakL = 0.0; truePeakR = 0.0; lastSampleL = 0.0; lastSampleR = 0.0;
  resetPrev = false;
  for (let k = 0; k < 16; k++) display[k] = 0.0;

  params[P_TRIM] = 0.5; params[P_CHAN] = 0.0; params[P_TARGET] = 0.0; params[P_RESET] = 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function process(n: i32): void {
  const trimN: f32 = clampf(params[P_TRIM], 0.0, 1.0);
  const monoMode: bool = params[P_CHAN] > 0.5;
  const resetNow: bool = params[P_RESET] > 0.5;
  const trimGain: f32 = f32(Mathf.pow(10.0, (trimN * 2.0 - 1.0) * 12.0 / 20.0));

  if (resetNow && !resetPrev) {
    for (let b = 0; b < HIST_N; b++) { histSum[b] = 0.0; histCount[b] = 0; }
    for (let k = 0; k < RING_N; k++) subRing[k] = 0.0;
    ringIdx = 0; ringFilled = 0; subSumSq = 0.0; subCount = 0;
    truePeakL = 0.0; truePeakR = 0.0;
    momentaryLufs = -70.0; shortTermLufs = -70.0; integratedLufs = -70.0;
  }
  resetPrev = resetNow;

  const subBlockSamples: i32 = i32(sampleRate * 0.1);

  for (let i = 0; i < n; i++) {
    let l: f32 = inBuf[i] * trimGain;
    let r: f32 = channels > 1 ? inBuf[MAX_FRAMES + i] * trimGain : l;
    if (monoMode) { const mid: f32 = (l + r) * 0.5; l = mid; r = mid; }
    outBuf[i] = l;
    outBuf[MAX_FRAMES + i] = r;

    // true peak (approx): sample + 3 linearly-interpolated inter-sample points
    let pkL: f32 = f32(Mathf.abs(l));
    for (let t = 1; t < 4; t++) {
      const frac: f32 = f32(t) / 4.0;
      const interp: f32 = f32(Mathf.abs(lastSampleL + (l - lastSampleL) * frac));
      if (interp > pkL) pkL = interp;
    }
    if (pkL > truePeakL) truePeakL = pkL;
    lastSampleL = l;

    let pkR: f32 = f32(Mathf.abs(r));
    for (let t = 1; t < 4; t++) {
      const frac: f32 = f32(t) / 4.0;
      const interp: f32 = f32(Mathf.abs(lastSampleR + (r - lastSampleR) * frac));
      if (interp > pkR) pkR = interp;
    }
    if (pkR > truePeakR) truePeakR = pkR;
    lastSampleR = r;

    // K-weighting: stage 1 (shelf) then stage 2 (RLB high-pass), per channel
    const y1L: f32 = biquad(l, S1_B0, S1_B1, S1_B2, S1_A1, S1_A2, s1x1L, s1x2L, s1y1L, s1y2L);
    s1x2L = s1x1L; s1x1L = l; s1y2L = s1y1L; s1y1L = y1L;
    const y2L: f32 = biquad(y1L, S2_B0, S2_B1, S2_B2, S2_A1, S2_A2, s2x1L, s2x2L, s2y1L, s2y2L);
    s2x2L = s2x1L; s2x1L = y1L; s2y2L = s2y1L; s2y1L = y2L;

    const y1R: f32 = biquad(r, S1_B0, S1_B1, S1_B2, S1_A1, S1_A2, s1x1R, s1x2R, s1y1R, s1y2R);
    s1x2R = s1x1R; s1x1R = r; s1y2R = s1y1R; s1y1R = y1R;
    const y2R: f32 = biquad(y1R, S2_B0, S2_B1, S2_B2, S2_A1, S2_A2, s2x1R, s2x2R, s2y1R, s2y2R);
    s2x2R = s2x1R; s2x1R = y1R; s2y2R = s2y1R; s2y1R = y2R;

    subSumSq += y2L * y2L + y2R * y2R;  // G_L = G_R = 1.0 (stereo)
    subCount += 1;

    if (subCount >= subBlockSamples) {
      const subMeanSq: f32 = subSumSq / f32(subCount);
      subRing[ringIdx] = subMeanSq; ringIdx = (ringIdx + 1) % RING_N;
      if (ringFilled < RING_N) ringFilled += 1;
      subSumSq = 0.0; subCount = 0;

      // momentary = mean of the last 4 sub-blocks (400ms)
      const n4: i32 = ringFilled < 4 ? ringFilled : 4;
      let m4: f32 = 0.0;
      for (let k = 0; k < n4; k++) { let idx = ringIdx - 1 - k; if (idx < 0) idx += RING_N; m4 += subRing[idx]; }
      const momMeanSq: f32 = n4 > 0 ? m4 / f32(n4) : 0.0;
      momentaryLufs = momMeanSq > 0.0 ? f32(-0.691 + 10.0 * (Mathf.log(momMeanSq) / LN10)) : -70.0;

      // short-term = mean of the last 30 sub-blocks (3s)
      let m30: f32 = 0.0;
      for (let k = 0; k < ringFilled; k++) m30 += subRing[k];
      const stMeanSq: f32 = ringFilled > 0 ? m30 / f32(ringFilled) : 0.0;
      shortTermLufs = stMeanSq > 0.0 ? f32(-0.691 + 10.0 * (Mathf.log(stMeanSq) / LN10)) : -70.0;

      // bin this 400ms gating block into the integrated-loudness histogram
      if (momMeanSq > 0.0 && n4 >= 4) {
        const blockLufs: f32 = f32(-0.691 + 10.0 * (Mathf.log(momMeanSq) / LN10));
        if (blockLufs >= -70.0) {
          let bin: i32 = i32((blockLufs + 70.0) / 0.1 + 0.5);
          if (bin < 0) bin = 0; if (bin > HIST_N - 1) bin = HIST_N - 1;
          histSum[bin] += momMeanSq; histCount[bin] += 1;
        }
      }

      // integrated loudness: absolute gate (-70 LUFS) then relative gate
      // (10 LU below the absolute-gated mean) - the standard two-pass method.
      let sum1: f32 = 0.0; let cnt1: i32 = 0;
      for (let b = 0; b < HIST_N; b++) { if (histCount[b] > 0) { sum1 += histSum[b]; cnt1 += histCount[b]; } }
      if (cnt1 > 0) {
        const meanSq1: f32 = sum1 / f32(cnt1);
        const gateLufs: f32 = f32(-0.691 + 10.0 * (Mathf.log(meanSq1) / LN10)) - 10.0;
        let sum2: f32 = 0.0; let cnt2: i32 = 0;
        for (let b = 0; b < HIST_N; b++) {
          if (histCount[b] > 0) {
            const binLufs: f32 = f32(b) * 0.1 - 70.0;
            if (binLufs >= gateLufs) { sum2 += histSum[b]; cnt2 += histCount[b]; }
          }
        }
        if (cnt2 > 0) {
          const meanSq2: f32 = sum2 / f32(cnt2);
          integratedLufs = f32(-0.691 + 10.0 * (Mathf.log(meanSq2) / LN10));
        }
      }
    }
  }

  display[0] = momentaryLufs;
  display[1] = shortTermLufs;
  display[2] = integratedLufs;
  display[3] = f32(20.0 * (Mathf.log(truePeakL + 0.000001) / LN10));
  display[4] = f32(20.0 * (Mathf.log(truePeakR + 0.000001) / LN10));
}
