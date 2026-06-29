// =====================================================================
//  STAR FIELD — a multitap "space" reverb
//  An early-reflection multitap delay network (discrete, scattered taps
//  that "ping" outward across the stereo field) feeding a diffuse modulated
//  tail (an 8-line feedback delay network with allpass diffusion and slow
//  per-line LFOs for a spacey, shimmering blossom). The character is NOT a
//  smooth hall — it is a constellation of discrete reflections that decay
//  into deep ambient space.
//
//  Controls: Size, Taps/Spread, Decay, Modulation, Mix.
//  Pure algorithm, no samples, all f32, allocation-free process().
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const TWO_PI: f32 = 6.2831855;

// ---- multitap early-reflection delay line (mono send -> scattered taps) ----
const TAP_CAP: i32 = 65536;   // ~1.36 s @ 48k headroom for tap spread * size
const tapBuf: StaticArray<f32> = new StaticArray<f32>(TAP_CAP);
let tapPos: i32 = 0;

const NTAPS: i32 = 12;
// base tap delays in samples @48k (prime-ish, irregular so taps don't comb)
const tapBase: StaticArray<i32> = new StaticArray<i32>(NTAPS);
// per-tap stereo pan (-1 left .. +1 right) and a base gain
const tapPan:  StaticArray<f32> = new StaticArray<f32>(NTAPS);
const tapGain: StaticArray<f32> = new StaticArray<f32>(NTAPS);

// ---- diffuse FDN tail ----
const NLINES: i32 = 8;
const LINE_CAP: i32 = 16384;
const lines: StaticArray<f32> = new StaticArray<f32>(NLINES * LINE_CAP);
const linePos:  StaticArray<i32> = new StaticArray<i32>(NLINES);
const lineLen:  StaticArray<i32> = new StaticArray<i32>(NLINES);
const lineGain: StaticArray<f32> = new StaticArray<f32>(NLINES);
const damp:     StaticArray<f32> = new StaticArray<f32>(NLINES);
const lfoPh:    StaticArray<f32> = new StaticArray<f32>(NLINES);
const lfoInc:   StaticArray<f32> = new StaticArray<f32>(NLINES);
const baseLen:  StaticArray<i32> = new StaticArray<i32>(NLINES);
const outs:     StaticArray<f32> = new StaticArray<f32>(NLINES);

// ---- input diffusion allpasses (smear the send before the FDN) ----
const NAP: i32 = 4;
const AP_CAP: i32 = 2048;
const ap: StaticArray<f32> = new StaticArray<f32>(NAP * AP_CAP);
const apPos:  StaticArray<i32> = new StaticArray<i32>(NAP);
const apLen:  StaticArray<i32> = new StaticArray<i32>(NAP);
const apBase: StaticArray<i32> = new StaticArray<i32>(NAP);

const P_SIZE:  i32 = 0;  // 0..1 -> scales tap times and tail line lengths
const P_SPREAD: i32 = 1; // 0..1 -> stereo spread + how many taps active (density)
const P_DECAY: i32 = 2;  // 0..1 -> tail RT60
const P_MOD:   i32 = 3;  // 0..1 -> shimmer modulation depth of tail taps
const P_MIX:   i32 = 4;  // 0..1 -> dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  // scattered, irregular early-reflection tap times (samples @48k)
  tapBase[0]  = 563;   tapBase[1]  = 1129;  tapBase[2]  = 1801;  tapBase[3]  = 2477;
  tapBase[4]  = 3251;  tapBase[5]  = 4099;  tapBase[6]  = 5023;  tapBase[7]  = 6121;
  tapBase[8]  = 7253;  tapBase[9]  = 8669;  tapBase[10] = 10193; tapBase[11] = 12101;

  // pan each tap across the field; alternate sides and widen with index
  for (let i = 0; i < NTAPS; i++) {
    const side: f32 = ((i & 1) == 0) ? -1.0 : 1.0;
    const widen: f32 = 0.25 + f32(i) / f32(NTAPS) * 0.75;
    tapPan[i] = side * widen;
    // later taps a touch quieter (reflections lose energy with path length)
    tapGain[i] = f32(0.95 - f32(i) * 0.045);
    if (tapGain[i] < 0.25) tapGain[i] = 0.25;
  }

  baseLen[0] = 887;  baseLen[1] = 1153; baseLen[2] = 1373; baseLen[3] = 1789;
  baseLen[4] = 1993; baseLen[5] = 2143; baseLen[6] = 2477; baseLen[7] = 2917;
  apBase[0] = 167; apBase[1] = 353; apBase[2] = 113; apBase[3] = 293;

  for (let i = 0; i < NLINES; i++) {
    linePos[i] = 0; damp[i] = 0.0; lineLen[i] = baseLen[i]; lineGain[i] = 0.0;
    lfoPh[i] = f32(i) * 0.41;
    lfoInc[i] = (0.18 + f32(i) * 0.07) * TWO_PI / sampleRate; // 0.18..0.67 Hz slow drift
  }
  for (let i = 0; i < NAP; i++) { apPos[i] = 0; apLen[i] = apBase[i]; }

  for (let i = 0; i < NLINES * LINE_CAP; i++) lines[i] = 0.0;
  for (let i = 0; i < NAP * AP_CAP; i++) ap[i] = 0.0;
  for (let i = 0; i < TAP_CAP; i++) tapBuf[i] = 0.0;
  tapPos = 0;

  params[P_SIZE]   = 0.55;
  params[P_SPREAD] = 0.70;
  params[P_DECAY]  = 0.55;
  params[P_MOD]    = 0.35;
  params[P_MIX]    = 0.35;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

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

// fractional, interpolated read from a tail line's ring buffer, `d` behind write
@inline function readFrac(line: i32, d: f32): f32 {
  const base: i32 = line * LINE_CAP;
  const wp: i32 = linePos[line];
  let di: i32 = i32(d);
  const fr: f32 = d - f32(di);
  let a: i32 = wp - di; while (a < 0) a += LINE_CAP; if (a >= LINE_CAP) a -= LINE_CAP;
  let b: i32 = a - 1; if (b < 0) b += LINE_CAP;
  return lines[base + a] * (1.0 - fr) + lines[base + b] * fr;
}

// read the multitap line `d` samples behind its write head (no interpolation)
@inline function readTap(d: i32): f32 {
  let a: i32 = tapPos - d;
  while (a < 0) a += TAP_CAP;
  if (a >= TAP_CAP) a -= TAP_CAP;
  return tapBuf[a];
}

export function process(n: i32): void {
  const size: f32   = clampf(params[P_SIZE],   0.0, 1.0);
  const spread: f32 = clampf(params[P_SPREAD], 0.0, 1.0);
  const decay: f32  = clampf(params[P_DECAY],  0.0, 1.0);
  const modAmt: f32 = clampf(params[P_MOD],    0.0, 1.0);
  const mix: f32    = clampf(params[P_MIX],    0.0, 1.0);

  const srRatio: f32 = sampleRate / 48000.0;

  // Size: 0.35..1.4 scale on tap and line lengths -> small room to huge space
  const sizeScale: f32 = 0.35 + size * 1.05;

  // tail RT60 driven by Decay
  const rt60: f32 = 0.25 + decay * decay * 11.0;
  const ln1000: f32 = 6.9077553;

  for (let i = 0; i < NLINES; i++) {
    let L: i32 = i32(f32(baseLen[i]) * sizeScale * srRatio);
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

  // Spread controls both the stereo width of taps AND how many taps "open up"
  // (density). At 0 only the first few near taps fire (tight cluster); at 1 all
  // taps fan out wide across deep space.
  const activeF: f32 = 3.0 + spread * f32(NTAPS - 3);
  const widthAmt: f32 = 0.15 + spread * 0.85;

  // shimmer modulation depth (samples) of the tail read taps
  const modDepth: f32 = modAmt * 18.0 * srRatio;

  const erScale: f32 = 0.5;   // early-reflection level into the wet bus
  const tailScale: f32 = 0.28; // FDN tail output level

  for (let f = 0; f < n; f++) {
    const l: f32 = inBuf[f];
    const r: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : l;
    const monoIn: f32 = (l + r) * 0.5;

    // write the dry send into the multitap line
    tapBuf[tapPos] = monoIn;

    // ---- early reflections: discrete scattered taps, panned ----
    let erL: f32 = 0.0;
    let erR: f32 = 0.0;
    let tailFeed: f32 = 0.0;
    for (let i = 0; i < NTAPS; i++) {
      // smooth on/off of each tap based on Spread (density)
      let amt: f32 = activeF - f32(i);
      if (amt > 1.0) amt = 1.0;
      if (amt < 0.0) amt = 0.0;
      if (amt <= 0.0) continue;

      let d: i32 = i32(f32(tapBase[i]) * sizeScale * srRatio);
      if (d < 1) d = 1; if (d >= TAP_CAP) d = TAP_CAP - 1;
      const tv: f32 = readTap(d) * tapGain[i] * amt;

      // equal-power-ish pan from tapPan widened by Spread
      const pan: f32 = clampf(tapPan[i] * widthAmt, -1.0, 1.0);
      const gL: f32 = 0.5 * (1.0 - pan);
      const gR: f32 = 0.5 * (1.0 + pan);
      erL += tv * gL;
      erR += tv * gR;
      tailFeed += tv;
    }
    erL *= erScale;
    erR *= erScale;

    tapPos++; if (tapPos >= TAP_CAP) tapPos = 0;

    // ---- feed the diffuse tail from the early reflections ----
    let send: f32 = tailFeed * 0.18 + monoIn * 0.12;
    send = allpass(0, send);
    send = allpass(1, send);
    send = allpass(2, send);
    send = allpass(3, send);

    for (let i = 0; i < NLINES; i++) {
      let ph: f32 = lfoPh[i] + lfoInc[i];
      if (ph >= TWO_PI) ph -= TWO_PI;
      lfoPh[i] = ph;
      const d: f32 = f32(lineLen[i]) + modDepth * Mathf.sin(ph);
      const v: f32 = readFrac(i, d);
      // gentle fixed damping so the tail stays smooth and ambient
      const dd: f32 = damp[i] + 0.35 * (v - damp[i]);
      damp[i] = dd;
      outs[i] = dd;
    }

    let sum: f32 = 0.0;
    for (let i = 0; i < NLINES; i++) sum += outs[i];
    const corr: f32 = (2.0 / f32(NLINES)) * sum; // Householder-ish mixing

    for (let i = 0; i < NLINES; i++) {
      const base: i32 = i * LINE_CAP;
      const inj: f32 = ((i & 1) == 0 ? send : -send) * 0.30;
      const fb: f32 = (outs[i] - corr) * lineGain[i];
      lines[base + linePos[i]] = inj + fb;
      linePos[i]++; if (linePos[i] >= LINE_CAP) linePos[i] = 0;
    }

    const tailL: f32 = (outs[0] - outs[2] + outs[4] - outs[6]) * tailScale;
    const tailR: f32 = (outs[1] - outs[3] + outs[5] - outs[7]) * tailScale;

    const wetL: f32 = erL + tailL;
    const wetR: f32 = erR + tailR;

    outBuf[f] = l * (1.0 - mix) + wetL * mix;
    outBuf[MAX_FRAMES + f] = r * (1.0 - mix) + wetR * mix;
  }
}
