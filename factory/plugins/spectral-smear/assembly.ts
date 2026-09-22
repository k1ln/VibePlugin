// =====================================================================
//  SPECTRAL SMEAR — an FFT spectral processor.
//  A stereo short-time Fourier transform (Hann analysis + synthesis,
//  75 % overlap, 1024 / 2048 / 4096 points) with per-bin magnitude and
//  phase processing:
//   FREEZE   holds the spectrum; in Keep-phase mode each bin keeps its
//            measured frequency so tones sustain coherently (a true
//            phase-vocoder freeze)
//   SUSTAIN  spectral hold with adjustable decay (an infinite "reverb")
//   BLUR     smears magnitudes across time and across neighbouring bins
//   GATE     drops the quietest bins (spectral denoise / whisper)
//   PITCH / SHIFT   remap bins by ratio and by an absolute Hz offset
//   TILT, LOW/HIGH CUT   spectral EQ
//   PHASE    keep, random ("whisper") or zero ("robot")
//   WIDTH    decorrelates the right channel's phases
//  Stereo is done with one complex FFT (L = real, R = imaginary). The dry
//  path is delayed to match the analysis latency so Mix stays coherent.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 15;
const MAXN: i32 = 4096;
const RING: i32 = 16384;
const TWO_PI: f32 = 6.28318530717959;
const PI: f32 = 3.14159265358979;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_FREEZE: i32 = 0; const P_SUS: i32 = 1;   const P_BLURT: i32 = 2; const P_BLURF: i32 = 3; const P_PHASE: i32 = 4;
const P_PITCH: i32 = 5;  const P_SHIFT: i32 = 6; const P_GATE: i32 = 7;  const P_TILT: i32 = 8;  const P_LOCUT: i32 = 9;
const P_HICUT: i32 = 10; const P_WIDTH: i32 = 11; const P_SIZE: i32 = 12; const P_MIX: i32 = 13; const P_OUT: i32 = 14;

let sampleRate: f32 = 48000.0;
const cosT: StaticArray<f32> = new StaticArray<f32>(MAXN / 2);
const sinT: StaticArray<f32> = new StaticArray<f32>(MAXN / 2);
const re: StaticArray<f32> = new StaticArray<f32>(MAXN);
const im: StaticArray<f32> = new StaticArray<f32>(MAXN);
const inL: StaticArray<f32> = new StaticArray<f32>(RING);
const inR: StaticArray<f32> = new StaticArray<f32>(RING);
const accL: StaticArray<f32> = new StaticArray<f32>(MAXN * 2);
const accR: StaticArray<f32> = new StaticArray<f32>(MAXN * 2);
const NB: i32 = MAXN / 2 + 1;
// per-channel spectral state, index c * NB + k
const mag:   StaticArray<f32> = new StaticArray<f32>(2 * NB);
const ph:    StaticArray<f32> = new StaticArray<f32>(2 * NB);
const prevPh: StaticArray<f32> = new StaticArray<f32>(2 * NB);
const adv:   StaticArray<f32> = new StaticArray<f32>(2 * NB);
const phAcc: StaticArray<f32> = new StaticArray<f32>(2 * NB);
const advFz: StaticArray<f32> = new StaticArray<f32>(2 * NB);    // per-bin phase advance captured at freeze time
const magSm: StaticArray<f32> = new StaticArray<f32>(2 * NB);     // blur / sustain memory
const magFz: StaticArray<f32> = new StaticArray<f32>(2 * NB);     // frozen magnitudes
const mag2:  StaticArray<f32> = new StaticArray<f32>(2 * NB);
const ph2:   StaticArray<f32> = new StaticArray<f32>(2 * NB);
const tmpM:  StaticArray<f32> = new StaticArray<f32>(NB);
const rndPh: StaticArray<f32> = new StaticArray<f32>(NB);
let wPos: i32 = 0; let oPos: i32 = 0; let hopCnt: i32 = 0; let curN: i32 = 2048; let frozen: bool = false; let frameNo: i32 = 0;
let seed: u32 = 987654321; let lvl: f32 = 0.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function rnd(): f32 { seed = seed * 1664525 + 1013904223; return f32(seed >> 8) * (1.0 / 16777216.0); }

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < MAXN / 2; i++) { const a: f32 = TWO_PI * f32(i) / f32(MAXN); cosT[i] = f32(Mathf.cos(a)); sinT[i] = f32(Mathf.sin(a)); }
  for (let i = 0; i < RING; i++) { inL[i] = 0.0; inR[i] = 0.0; }
  for (let i = 0; i < MAXN * 2; i++) { accL[i] = 0.0; accR[i] = 0.0; }
  for (let i = 0; i < 2 * NB; i++) { mag[i] = 0.0; ph[i] = 0.0; prevPh[i] = 0.0; adv[i] = 0.0; advFz[i] = 0.0; phAcc[i] = 0.0; magSm[i] = 0.0; magFz[i] = 0.0; mag2[i] = 0.0; ph2[i] = 0.0; }
  seed = 987654321;
  for (let k = 0; k < NB; k++) rndPh[k] = rnd();
  wPos = 0; oPos = 0; hopCnt = 0; curN = 2048; frozen = false; frameNo = 0; lvl = 0.0;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [0.0, 0.0, 0.25, 0.15, 0.0, 0.5, 0.5, 0.0, 0.5, 0.0, 1.0, 0.5, 1.0, 1.0, 0.7];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

// in-place radix-2 complex FFT on re/im, size n (<= MAXN); inverse scales by 1/n
function fft(n: i32, inv: bool): void {
  let j: i32 = 0;
  for (let i = 1; i < n; i++) {
    let bit: i32 = n >> 1;
    while ((j & bit) != 0) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) { const tr: f32 = re[i]; re[i] = re[j]; re[j] = tr; const ti: f32 = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  const sg: f32 = inv ? 1.0 : -1.0;
  for (let len = 2; len <= n; len <<= 1) {
    const half: i32 = len >> 1; const step: i32 = MAXN / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr: f32 = cosT[k * step]; const wi: f32 = sg * sinT[k * step];
        const a: i32 = i + k; const b: i32 = a + half;
        const xr: f32 = re[b] * wr - im[b] * wi; const xi: f32 = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inv) { const s: f32 = 1.0 / f32(n); for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; } }
}

@inline function wrapPi(x: f32): f32 { let y: f32 = x; while (y > PI) y -= TWO_PI; while (y < -PI) y += TWO_PI; return y; }

function doFrame(): void {
  const N: i32 = curN; const half: i32 = N >> 1; const hop: i32 = N >> 2; const sr: f32 = sampleRate;
  const binHz: f32 = sr / f32(N);
  // ---- analysis: window the last N samples of both channels into one complex FFT (L real, R imag) ----
  for (let i = 0; i < N; i++) {
    const w: f32 = 0.5 - 0.5 * f32(Mathf.cos(TWO_PI * f32(i) / f32(N)));
    let p: i32 = wPos - N + i; if (p < 0) p += RING;
    re[i] = inL[p] * w; im[i] = inR[p] * w;
  }
  fft(N, false);
  // split into the two real spectra
  for (let k = 0; k <= half; k++) {
    const kn: i32 = k == 0 ? 0 : N - k;
    const ar: f32 = 0.5 * (re[k] + re[kn]); const ai: f32 = 0.5 * (im[k] - im[kn]);      // L
    const br: f32 = 0.5 * (im[k] + im[kn]); const bi: f32 = -0.5 * (re[k] - re[kn]);     // R
    mag[k] = f32(Mathf.sqrt(ar * ar + ai * ai)); ph[k] = f32(Math.atan2(ai, ar));
    mag[NB + k] = f32(Mathf.sqrt(br * br + bi * bi)); ph[NB + k] = f32(Math.atan2(bi, br));
  }
  // ---- controls ---------------------------------------------------------------------------------------------
  const freezeNow: bool = params[P_FREEZE] > 0.5;
  const phaseMode: i32 = i32(params[P_PHASE] + 0.5);
  const hopSec: f32 = f32(hop) / sr;
  const susP: f32 = params[P_SUS];
  const susDecay: f32 = susP < 0.02 ? 0.0 : f32(Mathf.exp(-hopSec / (0.1 * f32(Mathf.pow(600.0, susP)))));
  const blurT: f32 = params[P_BLURT];
  const blurA: f32 = blurT < 0.01 ? 1.0 : 1.0 - f32(Mathf.exp(-hopSec / (0.005 * f32(Mathf.pow(400.0, blurT)))));
  const blurW: i32 = i32(params[P_BLURF] * 20.0 + 0.5);
  const ratio: f32 = f32(Mathf.pow(2.0, (params[P_PITCH] - 0.5) * 24.0 / 12.0));
  const shiftBins: f32 = (params[P_SHIFT] - 0.5) * 2.0 * 1000.0 / binHz;
  const gate: f32 = params[P_GATE];
  const tilt: f32 = (params[P_TILT] - 0.5) * 2.0 * 9.0;
  const loHz: f32 = 20.0 * f32(Mathf.pow(300.0, params[P_LOCUT])); const hiHz: f32 = 20.0 * f32(Mathf.pow(1000.0, params[P_HICUT]));
  const width: f32 = params[P_WIDTH];
  frameNo++;
  if (frameNo % 40 == 0) for (let k = 0; k < NB; k++) rndPh[k] = rnd();
  // ---- per channel processing ---------------------------------------------------------------------------------
  let peak: f32 = 0.0;
  for (let c = 0; c < 2; c++) {
    const o: i32 = c * NB;
    // measured per-bin phase advance (for coherent freezing), before we overwrite anything
    for (let k = 0; k <= half; k++) {
      const om: f32 = TWO_PI * f32(k) * f32(hop) / f32(N);
      adv[o + k] = om + wrapPi(ph[o + k] - prevPh[o + k] - om);
      prevPh[o + k] = ph[o + k];
    }
    // sustain (spectral hold) and temporal blur
    for (let k = 0; k <= half; k++) {
      let m: f32 = mag[o + k];
      if (susDecay > 0.0) { const held: f32 = magSm[o + k] * susDecay; if (held > m) m = held; }
      if (blurA < 1.0) { magSm[o + k] += blurA * (m - magSm[o + k]); m = magSm[o + k]; }
      else magSm[o + k] = m;
      tmpM[k] = m;
    }
    // frequency blur (box smoothing over neighbouring bins)
    if (blurW > 0) {
      for (let k = 0; k <= half; k++) {
        let s: f32 = 0.0; let cnt: f32 = 0.0;
        for (let d = -blurW; d <= blurW; d++) { const kk: i32 = k + d; if (kk >= 0 && kk <= half) { s += tmpM[kk]; cnt += 1.0; } }
        mag2[o + k] = s / cnt;
      }
    } else for (let k = 0; k <= half; k++) mag2[o + k] = tmpM[k];
    // freeze capture / hold
    if (freezeNow && !frozen) { for (let k = 0; k <= half; k++) { magFz[o + k] = mag2[o + k]; phAcc[o + k] = ph[o + k]; advFz[o + k] = adv[o + k]; } }
    if (freezeNow) for (let k = 0; k <= half; k++) { mag2[o + k] = magFz[o + k]; phAcc[o + k] = wrapPi(phAcc[o + k] + advFz[o + k]); }
    // phase source per bin
    for (let k = 0; k <= half; k++) {
      let p: f32 = freezeNow ? phAcc[o + k] : ph[o + k];
      if (phaseMode == 1) p = rnd() * TWO_PI;
      else if (phaseMode == 2) p = 0.0;
      ph2[o + k] = p;
    }
  }
  frozen = freezeNow;
  // ---- spectral remap (pitch / shift), tilt, gate, cuts, width -----------------------------------------------------
  for (let c = 0; c < 2; c++) {
    const o: i32 = c * NB;
    // work in tmpM as the remapped magnitude, then rebuild
    let maxM: f32 = 0.0;
    for (let k = 0; k <= half; k++) {
      let src: f32 = (f32(k) - shiftBins) / ratio;
      let m: f32 = 0.0;
      if (src >= 0.0 && src < f32(half)) {
        const i0: i32 = i32(src); const fr: f32 = src - f32(i0);
        m = mag2[o + i0] * (1.0 - fr) + mag2[o + i0 + 1] * fr;
      }
      const hz: f32 = f32(k) * binHz;
      if (hz < loHz || hz > hiHz) m = 0.0;
      if (tilt != 0.0 && hz > 20.0) m *= f32(Mathf.pow(10.0, tilt * f32(Mathf.log(hz / 1000.0) / Mathf.log(2.0)) / 20.0));
      tmpM[k] = m; if (m > maxM) maxM = m;
    }
    const thr: f32 = gate * gate * maxM * 0.3;
    for (let k = 0; k <= half; k++) {
      let m: f32 = tmpM[k];
      if (thr > 0.0 && m < thr) m *= m / thr * 0.25;
      // phase from the (rounded) source bin
      let src: f32 = (f32(k) - shiftBins) / ratio; let sb: i32 = i32(src + 0.5); if (sb < 0) sb = 0; if (sb > half) sb = half;
      let p: f32 = ph2[o + sb];
      if (c == 1 && width > 0.0) p += (rndPh[k] * 2.0 - 1.0) * PI * width;
      mag[o + k] = m; ph[o + k] = p; if (c == 0 && m > peak) peak = m;
    }
  }
  // rebuild complex spectrum Z = Yl + i*Yr with Hermitian halves
  for (let i = 0; i < N; i++) { re[i] = 0.0; im[i] = 0.0; }
  for (let k = 0; k <= half; k++) {
    const lr: f32 = mag[k] * f32(Mathf.cos(ph[k])); const li: f32 = mag[k] * f32(Mathf.sin(ph[k]));
    const rr: f32 = mag[NB + k] * f32(Mathf.cos(ph[NB + k])); const ri: f32 = mag[NB + k] * f32(Mathf.sin(ph[NB + k]));
    // Z[k] = Yl[k] + i*Yr[k]
    re[k] = lr - ri; im[k] = li + rr;
    if (k > 0 && k < half) { const kn: i32 = N - k; re[kn] = lr + ri; im[kn] = -li + rr; }
  }
  fft(N, true);
  // synthesis window + overlap-add (Hann^2 at 75 % overlap sums to 1.5)
  const g: f32 = 1.0 / 1.5;
  for (let i = 0; i < N; i++) {
    const w: f32 = 0.5 - 0.5 * f32(Mathf.cos(TWO_PI * f32(i) / f32(N)));
    const q: i32 = (oPos + i) % (MAXN * 2);
    accL[q] += re[i] * w * g; accR[q] += im[i] * w * g;
  }
  lvl = clampf(peak * 0.05, 0.0, 1.0);
  for (let k = 0; k < 16; k++) { const kk: i32 = i32(f32(k) * f32(half) / 16.0 * 0.55) + 1; let m: f32 = 0.0; for (let d = 0; d < 6; d++) { const b: i32 = kk + d; if (b <= half && mag[b] > m) m = mag[b]; } display[k] = clampf(f32(Mathf.sqrt(m)) * 0.25, 0.0, 1.0); }
}

const dryL: StaticArray<f32> = new StaticArray<f32>(RING);
const dryR: StaticArray<f32> = new StaticArray<f32>(RING);

export function process(n: i32): void {
  // FFT size may change between blocks; reset the pipeline when it does
  const sz: i32 = i32(params[P_SIZE] + 0.5);
  const want: i32 = 1024 << (sz < 0 ? 0 : (sz > 2 ? 2 : sz));
  if (want != curN) {
    curN = want; hopCnt = 0;
    for (let i = 0; i < MAXN * 2; i++) { accL[i] = 0.0; accR[i] = 0.0; }
    for (let i = 0; i < 2 * NB; i++) { magSm[i] = 0.0; prevPh[i] = 0.0; }
    frozen = false;
  }
  const hop: i32 = curN >> 2;
  const mix: f32 = params[P_MIX]; const dryAmt: f32 = 1.0 - mix; const outG: f32 = params[P_OUT] * params[P_OUT] * 2.0;
  for (let f = 0; f < n; f++) {
    const xl: f32 = inBuf[f]; const xr: f32 = inBuf[MAX_FRAMES + f];
    inL[wPos] = xl; inR[wPos] = xr; dryL[wPos] = xl; dryR[wPos] = xr;
    wPos = wPos + 1 >= RING ? 0 : wPos + 1;
    hopCnt++;
    if (hopCnt >= hop) { hopCnt = 0; doFrame(); }
    // wet: read the accumulator (latency = curN); dry delayed to match
    const q: i32 = oPos % (MAXN * 2);
    const wl: f32 = accL[q]; const wr: f32 = accR[q]; accL[q] = 0.0; accR[q] = 0.0;
    oPos = oPos + 1 >= MAXN * 2 ? 0 : oPos + 1;
    let dp: i32 = wPos - curN; if (dp < 0) dp += RING;
    const dl: f32 = dryL[dp]; const dr: f32 = dryR[dp];
    outBuf[f] = f32(Mathf.tanh((dl * dryAmt + wl * mix) * outG));
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh((dr * dryAmt + wr * mix) * outG));
  }
  display[15] = clampf(lvl, 0.0, 1.0);
}
