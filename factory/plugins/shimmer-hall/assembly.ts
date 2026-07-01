// =====================================================================
//  SHIMMER HALL — bright, modulated digital hall reverb
//  Same FDN backbone as a classic hall, but the delay-line read taps are
//  modulated by per-line LFOs (fractional, interpolated) to break up
//  metallic ringing and give the lush "chorused" tail of bright 1980s
//  high-end studio halls. A Tone control trades darkness for air.
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

const NLINES: i32 = 8;
const LINE_CAP: i32 = 16384;
const lines: StaticArray<f32> = new StaticArray<f32>(NLINES * LINE_CAP);
const linePos: StaticArray<i32> = new StaticArray<i32>(NLINES);
const lineLen: StaticArray<i32> = new StaticArray<i32>(NLINES);
const lineGain: StaticArray<f32> = new StaticArray<f32>(NLINES);
const damp: StaticArray<f32> = new StaticArray<f32>(NLINES);
const lfoPh: StaticArray<f32> = new StaticArray<f32>(NLINES);
const lfoInc: StaticArray<f32> = new StaticArray<f32>(NLINES);
const baseLen: StaticArray<i32> = new StaticArray<i32>(NLINES);
const outs: StaticArray<f32> = new StaticArray<f32>(NLINES);

const NAP: i32 = 4;
const AP_CAP: i32 = 2048;
const ap: StaticArray<f32> = new StaticArray<f32>(NAP * AP_CAP);
const apPos: StaticArray<i32> = new StaticArray<i32>(NAP);
const apLen: StaticArray<i32> = new StaticArray<i32>(NAP);
const apBase: StaticArray<i32> = new StaticArray<i32>(NAP);

const PRE_CAP: i32 = 32768;
const preBuf: StaticArray<f32> = new StaticArray<f32>(PRE_CAP);
let prePos: i32 = 0;

const TWO_PI: f32 = 6.2831855;

const P_MIX: i32 = 0;
const P_SIZE: i32 = 1;
const P_DECAY: i32 = 2;
const P_TONE: i32 = 3;    // 0 dark .. 1 bright
const P_MOD: i32 = 4;     // 0..1 tail modulation depth
const P_PRE: i32 = 5;     // 0..0.12 s

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  baseLen[0] = 887;  baseLen[1] = 1153; baseLen[2] = 1373; baseLen[3] = 1789;
  baseLen[4] = 1993; baseLen[5] = 2143; baseLen[6] = 2477; baseLen[7] = 2917;
  apBase[0] = 167; apBase[1] = 353; apBase[2] = 113; apBase[3] = 293;

  for (let i = 0; i < NLINES; i++) {
    linePos[i] = 0; damp[i] = 0.0; lineLen[i] = baseLen[i]; lineGain[i] = 0.0;
    lfoPh[i] = f32(i) * 0.37;
    lfoInc[i] = (0.4 + f32(i) * 0.13) * TWO_PI / sampleRate;  // 0.4..1.3 Hz
  }
  for (let i = 0; i < NAP; i++) { apPos[i] = 0; apLen[i] = apBase[i]; }
  for (let i = 0; i < NLINES * LINE_CAP; i++) lines[i] = 0.0;
  for (let i = 0; i < NAP * AP_CAP; i++) ap[i] = 0.0;
  for (let i = 0; i < PRE_CAP; i++) preBuf[i] = 0.0;
  prePos = 0;

  params[P_MIX] = 0.30; params[P_SIZE] = 0.80; params[P_DECAY] = 0.65;
  params[P_TONE] = 0.70; params[P_MOD] = 0.40; params[P_PRE] = 0.015;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

@inline function allpass(i: i32, x: f32): f32 {
  const base: i32 = i * AP_CAP;
  let p: i32 = apPos[i];
  const buffered: f32 = ap[base + p];
  const y: f32 = buffered - x;
  ap[base + p] = x + buffered * 0.5;
  p++; if (p >= apLen[i]) p = 0;
  apPos[i] = p;
  return y;
}

// fractional, interpolated read from a line's ring buffer, `d` samples behind write
@inline function readFrac(line: i32, d: f32): f32 {
  const base: i32 = line * LINE_CAP;
  const wp: i32 = linePos[line];
  let di: i32 = i32(d);
  const fr: f32 = d - f32(di);
  let a: i32 = wp - di; while (a < 0) a += LINE_CAP; if (a >= LINE_CAP) a -= LINE_CAP;
  let b: i32 = a - 1; if (b < 0) b += LINE_CAP;
  return lines[base + a] * (1.0 - fr) + lines[base + b] * fr;
}

export function process(n: i32): void {
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const size: f32 = clampf(params[P_SIZE], 0.3, 1.0);
  const decay: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const tone: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const modAmt: f32 = clampf(params[P_MOD], 0.0, 1.0);
  const preSec: f32 = clampf(params[P_PRE], 0.0, 0.12);

  const srRatio: f32 = sampleRate / 48000.0;
  const rt60: f32 = 0.3 + decay * decay * 13.7;
  const ln1000: f32 = 6.9077553;

  for (let i = 0; i < NLINES; i++) {
    let L: i32 = i32(f32(baseLen[i]) * size * srRatio);
    if (L < 8) L = 8; if (L >= LINE_CAP - 4) L = LINE_CAP - 4;
    lineLen[i] = L;
    const tSec: f32 = f32(L) / sampleRate;
    lineGain[i] = f32(Mathf.exp(-ln1000 * tSec / rt60));
  }
  for (let i = 0; i < NAP; i++) {
    let L: i32 = i32(f32(apBase[i]) * srRatio);
    if (L < 1) L = 1; if (L >= AP_CAP) L = AP_CAP - 1;
    apLen[i] = L;
  }

  let preLen: i32 = i32(preSec * sampleRate);
  if (preLen < 1) preLen = 1; if (preLen >= PRE_CAP) preLen = PRE_CAP - 1;

  // brighter Tone -> less damping; modulation depth in samples
  const dcoef: f32 = clampf(0.05 + (1.0 - tone) * 0.9, 0.0, 0.98);
  const modDepth: f32 = modAmt * 22.0 * srRatio;
  const outScale: f32 = 0.25;

  for (let f = 0; f < n; f++) {
    const l: f32 = inBuf[f];
    const r: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : l;
    let send: f32 = (l + r) * 0.5;

    const rp: i32 = (prePos - preLen + PRE_CAP) % PRE_CAP;
    preBuf[prePos] = send;
    send = preBuf[rp];
    prePos++; if (prePos >= PRE_CAP) prePos = 0;

    send = allpass(0, send);
    send = allpass(1, send);
    send = allpass(2, send);
    send = allpass(3, send);

    for (let i = 0; i < NLINES; i++) {
      let ph: f32 = lfoPh[i] + lfoInc[i];
      if (ph >= TWO_PI) ph -= TWO_PI;
      lfoPh[i] = ph;
      const d: f32 = f32(lineLen[i]) + modDepth * Mathf.sin(ph);
      let v: f32 = readFrac(i, d);
      const dd: f32 = damp[i] + dcoef * (v - damp[i]);
      damp[i] = dd;
      outs[i] = dd;
    }

    let sum: f32 = 0.0;
    for (let i = 0; i < NLINES; i++) sum += outs[i];
    const corr: f32 = (2.0 / f32(NLINES)) * sum;

    for (let i = 0; i < NLINES; i++) {
      const base: i32 = i * LINE_CAP;
      const inj: f32 = ((i & 1) == 0 ? send : -send) * 0.30;
      const fb: f32 = (outs[i] - corr) * lineGain[i];
      lines[base + linePos[i]] = inj + fb;
      linePos[i]++; if (linePos[i] >= LINE_CAP) linePos[i] = 0;
    }

    const wetL: f32 = (outs[0] - outs[2] + outs[4] - outs[6]) * outScale;
    const wetR: f32 = (outs[1] - outs[3] + outs[5] - outs[7]) * outScale;

    let oL: f32 = l * (1.0 - mix) + wetL * mix;
    let oR: f32 = r * (1.0 - mix) + wetR * mix;
    if (oL > 1.0) oL = 1.0; else if (oL < -1.0) oL = -1.0;
    if (oR > 1.0) oR = 1.0; else if (oR < -1.0) oR = -1.0;
    outBuf[f] = oL; outBuf[MAX_FRAMES + f] = oR;
  }
}
