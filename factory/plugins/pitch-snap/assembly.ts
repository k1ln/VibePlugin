// =====================================================================
//  PITCH SNAP — a real-time pitch corrector (Antares Auto-Tune lineage).
//  Detects the input's pitch by autocorrelation, snaps it to the nearest
//  note of the chosen scale, and shifts the audio to that pitch with a
//  crossfaded two-grain delay-line shifter. Fast retune = the robotic
//  "T-Pain" snap; slow = natural correction. Controls: Speed (retune
//  time), Amount (correction strength), Key (scale), Mix, Output.
//  No host imports, no allocation in process().
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const HIST: i32 = 8192; const HMASK: i32 = HIST - 1;
const GLEN: f32 = 1024.0;       // grain length (samples)
const WIN: i32 = 1024;          // autocorrelation window
const HOP: i32 = 512;
const MINLAG: i32 = 48;         // ~1 kHz @48k
const MAXLAG: i32 = 760;        // ~63 Hz @48k

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const hist: StaticArray<f32> = new StaticArray<f32>(HIST);
let wp: i32 = 0;
let hopCount: i32 = 0;
let detFreq: f32 = 220.0;
let ratio: f32 = 1.0;
let smRatio: f32 = 1.0;
let g0: f32 = 0.0; let g1: f32 = 0.5;
let sampleRate: f32 = 48000.0;

const P_SPEED: i32 = 0; const P_AMOUNT: i32 = 1; const P_KEY: i32 = 2; const P_MIX: i32 = 3; const P_OUTPUT: i32 = 4;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  wp = 0; hopCount = 0; detFreq = 220.0; ratio = 1.0; smRatio = 1.0; g0 = 0.0; g1 = 0.5;
  for (let i = 0; i < HIST; i++) hist[i] = 0.0;
  params[P_SPEED] = 0.6; params[P_AMOUNT] = 0.8; params[P_KEY] = 0.0; params[P_MIX] = 1.0; params[P_OUTPUT] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// snap a frequency to the nearest scale note (key: 0 chromatic, 1 major, 2 minor, 3 fifths)
function snapFreq(f: f32, key: i32): f32 {
  if (f < 20.0) return f;
  const midi: f32 = 69.0 + 12.0 * f32(Mathf.log2(f / 440.0));
  let m: i32 = i32(midi + 0.5);
  // quantise to scale within the octave
  const pc: i32 = ((m % 12) + 12) % 12;
  if (key == 1) { // major
    const maj: bool = pc==0||pc==2||pc==4||pc==5||pc==7||pc==9||pc==11;
    if (!maj) m += 1;
  } else if (key == 2) { // minor
    const mn: bool = pc==0||pc==2||pc==3||pc==5||pc==7||pc==8||pc==10;
    if (!mn) m += 1;
  } else if (key == 3) { // fifths (root + fifth)
    if (!(pc==0||pc==7)) { m = pc < 4 ? m - pc : (pc < 10 ? m + (7 - pc) : m + (12 - pc)); }
  }
  return f32(440.0 * Mathf.pow(2.0, (f32(m) - 69.0) / 12.0));
}

function detect(): void {
  // autocorrelation over the last WIN samples ending at wp
  let bestLag: i32 = 0; let best: f32 = 0.0; let e0: f32 = 0.0001;
  for (let i = 0; i < WIN; i++) { const v = hist[(wp - 1 - i) & HMASK]; e0 += v * v; }
  for (let lag = MINLAG; lag <= MAXLAG; lag++) {
    let ac: f32 = 0.0;
    for (let i = 0; i < WIN; i += 2) {
      ac += hist[(wp - 1 - i) & HMASK] * hist[(wp - 1 - i - lag) & HMASK];
    }
    if (ac > best) { best = ac; bestLag = lag; }
  }
  const norm: f32 = best / (e0 * 0.5);
  if (bestLag > 0 && norm > 0.25) {
    detFreq = sampleRate / f32(bestLag);
  }
}

export function process(n: i32): void {
  const speedN: f32 = clampf(params[P_SPEED], 0.0, 1.0);
  const amountN: f32 = clampf(params[P_AMOUNT], 0.0, 1.0);
  let key: i32 = i32(clampf(params[P_KEY], 0.0, 1.0) * 3.999); if (key < 0) key = 0; if (key > 3) key = 3;
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const outLevel: f32 = 0.5 + clampf(params[P_OUTPUT], 0.0, 1.0) * 1.0;

  // retune smoothing: fast (robotic) .. slow (natural)
  const speedCoef: f32 = f32(Mathf.exp(-1.0 / ((0.002 + (1.0 - speedN) * 0.18) * sampleRate)));
  const dry: f32 = 1.0 - mix;
  const gInc: f32 = 1.0 / GLEN;

  for (let i = 0; i < n; i++) {
    const xl: f32 = inBuf[i];
    const xr: f32 = inBuf[MAX_FRAMES + i];
    const x: f32 = (xl + xr) * 0.5;
    hist[wp] = x;

    if (hopCount <= 0) { detect(); hopCount = HOP; }
    hopCount -= 1;

    // target ratio toward the snapped note, scaled by Amount
    const tgt: f32 = snapFreq(detFreq, key);
    let r: f32 = detFreq > 1.0 ? tgt / detFreq : 1.0;
    r = clampf(r, 0.5, 2.0);
    ratio = 1.0 + (r - 1.0) * amountN;
    smRatio += (ratio - smRatio) * (1.0 - speedCoef);

    // two-grain crossfaded pitch shift
    g0 += (smRatio - 1.0) * gInc; g0 -= f32(Mathf.floor(g0));
    g1 += (smRatio - 1.0) * gInc; g1 -= f32(Mathf.floor(g1));
    const d0: f32 = g0 * GLEN; const d1: f32 = g1 * GLEN;
    const rp0: f32 = f32(wp) - d0; const rp1: f32 = f32(wp) - d1;
    let i0: i32 = i32(rp0); const f0: f32 = rp0 - f32(i0);
    let i1: i32 = i32(rp1); const f1: f32 = rp1 - f32(i1);
    const s0: f32 = hist[i0 & HMASK] + (hist[(i0 + 1) & HMASK] - hist[i0 & HMASK]) * f0;
    const s1: f32 = hist[i1 & HMASK] + (hist[(i1 + 1) & HMASK] - hist[i1 & HMASK]) * f1;
    // hann-ish crossfade windows (zero at wrap point)
    const w0: f32 = 0.5 - 0.5 * f32(Mathf.cos(g0 * 6.2831853));
    const w1: f32 = 0.5 - 0.5 * f32(Mathf.cos(g1 * 6.2831853));
    let wet: f32 = (s0 * w0 + s1 * w1);

    wp = (wp + 1) & HMASK;

    let o: f32 = (x * dry + wet * mix) * outLevel;
    if (o > 1.5) o = 1.5; else if (o < -1.5) o = -1.5;
    outBuf[i] = o;
    outBuf[MAX_FRAMES + i] = o;
  }
}
