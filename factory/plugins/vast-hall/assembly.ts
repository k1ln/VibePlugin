// =====================================================================
//  VAST HALL — large digital hall reverb
//  Modelled on the architecture of classic late-1970s digital hall units:
//  an input diffusion chain feeding an 8-line feedback delay network (FDN)
//  with a lossless Householder feedback matrix and per-line HF damping.
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// --- FDN configuration ----------------------------------------------
const NLINES: i32 = 8;
const LINE_CAP: i32 = 16384;                 // per-line ring capacity (samples)
const lines: StaticArray<f32> = new StaticArray<f32>(NLINES * LINE_CAP);
const linePos: StaticArray<i32> = new StaticArray<i32>(NLINES);
const lineLen: StaticArray<i32> = new StaticArray<i32>(NLINES);
const lineGain: StaticArray<f32> = new StaticArray<f32>(NLINES);
const damp: StaticArray<f32> = new StaticArray<f32>(NLINES);   // one-pole LP state per line

// base delay lengths in samples @48k (prime-ish, spread for density)
const baseLen: StaticArray<i32> = new StaticArray<i32>(NLINES);
const outs: StaticArray<f32> = new StaticArray<f32>(NLINES);   // per-sample line outputs (no alloc in process)

// --- input diffusion (4 Schroeder allpasses) ------------------------
const NAP: i32 = 4;
const AP_CAP: i32 = 2048;
const ap: StaticArray<f32> = new StaticArray<f32>(NAP * AP_CAP);
const apPos: StaticArray<i32> = new StaticArray<i32>(NAP);
const apLen: StaticArray<i32> = new StaticArray<i32>(NAP);
const apBase: StaticArray<i32> = new StaticArray<i32>(NAP);

// --- pre-delay (mono send) ------------------------------------------
const PRE_CAP: i32 = 32768;
const preBuf: StaticArray<f32> = new StaticArray<f32>(PRE_CAP);
let prePos: i32 = 0;

// parameter indices
const P_MIX: i32 = 0;      // 0..1 dry/wet
const P_SIZE: i32 = 1;     // 0.3..1.0 scales delay lengths
const P_DECAY: i32 = 2;    // 0..1 -> RT60
const P_DAMP: i32 = 3;     // 0..1 HF damping
const P_PRE: i32 = 4;      // 0..0.12 s pre-delay
const P_WIDTH: i32 = 5;    // 0..1 stereo width

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  baseLen[0] = 911;  baseLen[1] = 1129; baseLen[2] = 1399; baseLen[3] = 1747;
  baseLen[4] = 1951; baseLen[5] = 2099; baseLen[6] = 2503; baseLen[7] = 2843;
  apBase[0] = 142; apBase[1] = 379; apBase[2] = 107; apBase[3] = 277;

  for (let i = 0; i < NLINES; i++) { linePos[i] = 0; damp[i] = 0.0; lineLen[i] = baseLen[i]; lineGain[i] = 0.0; }
  for (let i = 0; i < NAP; i++)   { apPos[i] = 0; apLen[i] = apBase[i]; }
  for (let i = 0; i < NLINES * LINE_CAP; i++) lines[i] = 0.0;
  for (let i = 0; i < NAP * AP_CAP; i++) ap[i] = 0.0;
  for (let i = 0; i < PRE_CAP; i++) preBuf[i] = 0.0;
  prePos = 0;

  params[P_MIX] = 0.30; params[P_SIZE] = 0.75; params[P_DECAY] = 0.60;
  params[P_DAMP] = 0.45; params[P_PRE] = 0.02; params[P_WIDTH] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Freeverb-style allpass diffuser
@inline function allpass(i: i32, x: f32): f32 {
  const base: i32 = i * AP_CAP;
  let p: i32 = apPos[i];
  const buffered: f32 = ap[base + p];
  const y: f32 = buffered - x;            // allpass output
  ap[base + p] = x + buffered * 0.5;      // g = 0.5
  p++; if (p >= apLen[i]) p = 0;
  apPos[i] = p;
  return y;
}

export function process(n: i32): void {
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const size: f32 = clampf(params[P_SIZE], 0.3, 1.0);
  const decay: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const damping: f32 = clampf(params[P_DAMP], 0.0, 1.0);
  const preSec: f32 = clampf(params[P_PRE], 0.0, 0.12);
  const width: f32 = clampf(params[P_WIDTH], 0.0, 1.0);

  const srRatio: f32 = sampleRate / 48000.0;

  // recompute per-line delay lengths and feedback gains for this block
  const rt60: f32 = 0.3 + decay * decay * 11.7;       // 0.3 .. 12 s
  const ln1000: f32 = 6.9077553;
  for (let i = 0; i < NLINES; i++) {
    let L: i32 = i32(f32(baseLen[i]) * size * srRatio);
    if (L < 4) L = 4; if (L >= LINE_CAP) L = LINE_CAP - 1;
    lineLen[i] = L;
    const tSec: f32 = f32(L) / sampleRate;
    lineGain[i] = f32(Mathf.exp(-ln1000 * tSec / rt60));
  }
  for (let i = 0; i < NAP; i++) {
    let L: i32 = i32(f32(apBase[i]) * srRatio);
    if (L < 1) L = 1; if (L >= AP_CAP) L = AP_CAP - 1;
    apLen[i] = L;
  }

  // pre-delay length in samples
  let preLen: i32 = i32(preSec * sampleRate);
  if (preLen < 1) preLen = 1; if (preLen >= PRE_CAP) preLen = PRE_CAP - 1;

  // damping coefficient (one-pole LP in feedback); higher damping = darker tail
  const dcoef: f32 = clampf(0.05 + damping * 0.9, 0.0, 0.98);

  const outScale: f32 = 0.21;

  for (let f = 0; f < n; f++) {
    const l: f32 = inBuf[f];
    const r: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : l;
    const dryL: f32 = l;
    const dryR: f32 = r;
    let send: f32 = (l + r) * 0.5;

    // pre-delay
    const rp: i32 = (prePos - preLen + PRE_CAP) % PRE_CAP;
    preBuf[prePos] = send;
    send = preBuf[rp];
    prePos++; if (prePos >= PRE_CAP) prePos = 0;

    // input diffusion
    send = allpass(0, send);
    send = allpass(1, send);
    send = allpass(2, send);
    send = allpass(3, send);

    // read the 8 delay-line outputs (with HF damping), build feedback
    for (let i = 0; i < NLINES; i++) {
      const base: i32 = i * LINE_CAP;
      const rpos: i32 = (linePos[i] - lineLen[i] + LINE_CAP) % LINE_CAP;
      let v: f32 = lines[base + rpos];
      // damp the line output
      const d: f32 = damp[i] + dcoef * (v - damp[i]);
      damp[i] = d;
      outs[i] = d;
    }

    // Householder feedback matrix: y = x - (2/N) * sum(x)
    let sum: f32 = 0.0;
    for (let i = 0; i < NLINES; i++) sum += outs[i];
    const corr: f32 = (2.0 / f32(NLINES)) * sum;

    // write back: scaled, sign-alternated input injection + matrixed feedback * gain
    for (let i = 0; i < NLINES; i++) {
      const base: i32 = i * LINE_CAP;
      const inj: f32 = ((i & 1) == 0 ? send : -send) * 0.30;
      const fb: f32 = (outs[i] - corr) * lineGain[i];
      lines[base + linePos[i]] = inj + fb;
      linePos[i]++; if (linePos[i] >= LINE_CAP) linePos[i] = 0;
    }

    // stereo output: decorrelated taps
    const wetL: f32 = (outs[0] - outs[1] + outs[4] - outs[5]) * outScale;
    const wetR: f32 = (outs[2] - outs[3] + outs[6] - outs[7]) * outScale;
    const mid: f32 = (wetL + wetR) * 0.5;
    const sideL: f32 = (wetL - mid) * width + mid;
    const sideR: f32 = (wetR - mid) * width + mid;

    let oL: f32 = dryL * (1.0 - mix) + sideL * mix;
    let oR: f32 = dryR * (1.0 - mix) + sideR * mix;
    if (oL > 1.0) oL = 1.0; else if (oL < -1.0) oL = -1.0;
    if (oR > 1.0) oR = 1.0; else if (oR < -1.0) oR = -1.0;
    outBuf[f] = oL; outBuf[MAX_FRAMES + f] = oR;
  }
}
