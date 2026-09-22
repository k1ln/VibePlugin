// =====================================================================
//  STUTTER GRID — a tempo-synced stutter / glitch processor.
//  The input is captured continuously. On every grid step (1/4 .. 1/32
//  note, locked to the host transport when playing, else the internal
//  tempo) a seeded random draw picks what happens to that step:
//    PASS         the input goes straight through (no latency)
//    STUTTER      the last slice (1 .. 1/8 of a step) loops with a
//                 seamless loop crossfade, a per-repeat pitch ramp, a
//                 per-repeat decay and a falling low-pass
//    REVERSE      the last step plays backwards
//    MUTE         silence
//    TAPE STOP    the playback rate falls to zero across the step
//    DOUBLE TIME  the last step is replayed at twice the speed
//  The draw is seeded by (Seed, step index mod Pattern Length), so the
//  same glitch pattern repeats every 1 / 2 / 4 / 8 bars until the seed is
//  changed. Force Stutter holds the stutter on demand.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const NUM_PARAMS: i32 = 16;
const RB: i32 = 524288;              // capture ring (power of two)
const RBM: i32 = RB - 1;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_GRID: i32 = 0;  const P_STUT: i32 = 1;  const P_REV: i32 = 2;   const P_MUTE: i32 = 3;  const P_STOP: i32 = 4;
const P_DBL: i32 = 5;   const P_SLICE: i32 = 6; const P_PITCH: i32 = 7; const P_DECAY: i32 = 8; const P_FILT: i32 = 9;
const P_SEED: i32 = 10; const P_BARS: i32 = 11; const P_FORCE: i32 = 12; const P_TEMPO: i32 = 13; const P_MIX: i32 = 14; const P_OUT: i32 = 15;

let sampleRate: f32 = 48000.0;
const ringL: StaticArray<f32> = new StaticArray<f32>(RB);
const ringR: StaticArray<f32> = new StaticArray<f32>(RB);
let wpos: i32 = 0;
let hostPlaying: bool = false; let hostSeen: bool = false; let hostBpm: f32 = 120.0;
let beatPos: f64 = 0.0; let lastStep: i64 = -1;
let mode: i32 = 0; let fade: i32 = 0; let prevL: f32 = 0.0; let prevR: f32 = 0.0;
let s0: f32 = 0.0; let sliceLen: f32 = 1000.0; let q: f32 = 0.0; let repeatIdx: i32 = 0; let gainR: f32 = 1.0;
let rp: f32 = 0.0; let rate: f32 = 1.0; let stepSamples: f32 = 12000.0; let stepPos: f32 = 0.0;
let lpL: f32 = 0.0; let lpR: f32 = 0.0; let freeSteps: i32 = 0; let lastForce: bool = false;
let seedAcc: u32 = 1;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }
@inline function hash01(seed: u32, step: u32): f32 {
  let h: u32 = seed * 2654435761 + step * 40503 + 12345;
  h ^= h >> 15; h *= 2246822519; h ^= h >> 13; h *= 3266489917; h ^= h >> 16;
  return f32(h & 0xffffff) / 16777216.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
export function transport(playing: i32, ppq: f64, bpm: f32): void {
  hostPlaying = playing != 0; hostSeen = true; if (bpm > 20.0) hostBpm = bpm;
  if (hostPlaying) beatPos = ppq;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  for (let i = 0; i < RB; i++) { ringL[i] = 0.0; ringR[i] = 0.0; }
  wpos = 0; hostPlaying = false; hostSeen = false; hostBpm = 120.0; beatPos = 0.0; lastStep = -1;
  mode = 0; fade = 0; prevL = 0.0; prevR = 0.0; s0 = 0.0; sliceLen = 1000.0; q = 0.0; repeatIdx = 0; gainR = 1.0;
  rp = 0.0; rate = 1.0; stepSamples = 12000.0; stepPos = 0.0; lpL = 0.0; lpR = 0.0; freeSteps = 0; lastForce = false; seedAcc = 1;
  for (let i = 0; i < 16; i++) display[i] = 0.0;
  const d: f32[] = [2.0, 0.4, 0.15, 0.1, 0.1, 0.1, 1.0, 0.0, 0.7, 0.3, 0.25, 1.0, 0.0, 0.3, 1.0, 0.7];
  for (let i = 0; i < NUM_PARAMS; i++) params[i] = d[i];
}

@inline function readRing(buf: StaticArray<f32>, pos: f32): f32 {
  const fl: f32 = f32(Math.floor(pos));
  const i0: i32 = i32(fl) & RBM; const i1: i32 = (i0 + 1) & RBM; const fr: f32 = pos - fl;
  return buf[i0] * (1.0 - fr) + buf[i1] * fr;
}

export function process(n: i32): void {
  const sr: f32 = sampleRate;
  const grid: i32 = i32(params[P_GRID] + 0.5);
  const stepBeats: f32 = grid == 0 ? 1.0 : (grid == 1 ? 0.5 : (grid == 2 ? 0.25 : 0.125));
  const bpm: f32 = (hostSeen && hostPlaying) ? hostBpm : (60.0 + params[P_TEMPO] * 140.0);
  const beatsPerSample: f64 = f64(bpm) / (60.0 * f64(sr));
  stepSamples = stepBeats * 60.0 / bpm * sr;
  const sl: i32 = i32(params[P_SLICE] + 0.5);
  const sliceMul: f32 = sl == 0 ? 1.0 : (sl == 1 ? 0.5 : (sl == 2 ? 0.25 : 0.125));
  const pitchStep: f32 = (params[P_PITCH] - 0.5) * 4.0;             // semitones per repeat
  const decayPer: f32 = 0.55 + params[P_DECAY] * 0.45;
  const filt: f32 = params[P_FILT];
  const seed: u32 = u32(params[P_SEED] * 255.0 + 0.5);
  const bars: i32 = 1 << i32(params[P_BARS] + 0.5);
  const patSteps: i32 = i32(f32(bars) * 4.0 / stepBeats + 0.5);
  const cStut: f32 = params[P_STUT]; const cRev: f32 = params[P_REV]; const cMute: f32 = params[P_MUTE]; const cStop: f32 = params[P_STOP]; const cDbl: f32 = params[P_DBL];
  const total: f32 = cStut + cRev + cMute + cStop + cDbl;
  const norm: f32 = total > 1.0 ? 1.0 / total : 1.0;                // probabilities are absolute unless they exceed 1
  const force: bool = params[P_FORCE] > 0.5;
  const mix: f32 = params[P_MIX]; const outG: f32 = params[P_OUT] * params[P_OUT] * 2.0;
  const fadeLen: i32 = 96;
  let modeShown: f32 = 0.0;

  for (let f = 0; f < n; f++) {
    const xl: f32 = inBuf[f]; const xr: f32 = inBuf[MAX_FRAMES + f];
    ringL[wpos] = xl; ringR[wpos] = xr;
    // ---- step clock ---------------------------------------------------------------------------------------------
    beatPos += beatsPerSample;
    const stepNow: i64 = i64(Math.floor(beatPos / f64(stepBeats)));
    if (stepNow != lastStep || (force && !lastForce)) {
      const isNew: bool = stepNow != lastStep;
      lastStep = stepNow;
      const idx: u32 = u32(stepNow < 0 ? 0 : (i32(stepNow % i64(patSteps))));
      const r: f32 = hash01(seed, idx) ;
      let newMode: i32 = 0;
      let acc: f32 = 0.0;
      if (r < (acc += cStut * norm)) newMode = 1;
      else if (r < (acc += cRev * norm)) newMode = 2;
      else if (r < (acc += cMute * norm)) newMode = 3;
      else if (r < (acc += cStop * norm)) newMode = 4;
      else if (r < (acc += cDbl * norm)) newMode = 5;
      if (force) newMode = 1;
      prevL = 0.0; prevR = 0.0;
      fade = fadeLen; mode = newMode; stepPos = 0.0; repeatIdx = 0; gainR = 1.0; q = 0.0; rate = 1.0;
      sliceLen = clampf(stepSamples * sliceMul, 64.0, f32(RB / 4));
      if (mode == 1) { s0 = f32(wpos) - sliceLen; }
      else if (mode == 2) { rp = f32(wpos) - 1.0; }
      else if (mode == 4) { rp = f32(wpos); }
      else if (mode == 5) { rp = f32(wpos) - stepSamples; }
      lpL = 0.0; lpR = 0.0;
    }
    lastForce = force;
    stepPos += 1.0;
    const prog: f32 = clampf(stepPos / stepSamples, 0.0, 1.0);
    // ---- wet signal for the current mode ---------------------------------------------------------------------------------
    let wl: f32 = xl; let wr: f32 = xr;
    if (mode == 1) {
      const qq: f32 = q;
      let yl: f32 = readRing(ringL, s0 + qq); let yr: f32 = readRing(ringR, s0 + qq);
      const X: f32 = 64.0;
      if (qq > sliceLen - X) { const t: f32 = (qq - (sliceLen - X)) / X; yl = yl * (1.0 - t) + readRing(ringL, s0 + qq - sliceLen) * t; yr = yr * (1.0 - t) + readRing(ringR, s0 + qq - sliceLen) * t; }
      wl = yl * gainR; wr = yr * gainR;
      q += f32(Mathf.pow(2.0, pitchStep * f32(repeatIdx) / 12.0));
      if (q >= sliceLen) { q -= sliceLen; repeatIdx++; gainR *= decayPer; }
    } else if (mode == 2) {
      wl = readRing(ringL, rp); wr = readRing(ringR, rp); rp -= 1.0;
    } else if (mode == 3) {
      wl = 0.0; wr = 0.0;
    } else if (mode == 4) {
      rate = 1.0 - prog; wl = readRing(ringL, rp); wr = readRing(ringR, rp); rp += rate;
      const lim: f32 = f32(wpos) - 1.0; if (rp > lim) rp = lim;
      const g: f32 = 1.0 - prog * prog; wl *= g; wr *= g;
    } else if (mode == 5) {
      wl = readRing(ringL, rp); wr = readRing(ringR, rp); rp += 2.0;
      const lim: f32 = f32(wpos) - 1.0; if (rp > lim) rp = lim;
    }
    if (mode == 1 && filt > 0.001) {
      const fc: f32 = 12000.0 * f32(Mathf.pow(1.0 - filt * 0.96, 1.0 + f32(repeatIdx) * 0.5 + prog));
      const k: f32 = 1.0 - f32(Mathf.exp(-TWO_PI * clampf(fc, 200.0, sr * 0.45) / sr));
      lpL += k * (wl - lpL); lpR += k * (wr - lpR); wl = lpL; wr = lpR;
    }
    // short crossfade from the previous step's held value
    if (fade > 0) { const t: f32 = 1.0 - f32(fade) / f32(fadeLen); wl = prevL * (1.0 - t) + wl * t; wr = prevR * (1.0 - t) + wr * t; fade--; }
    else { prevL = wl; prevR = wr; }
    if (mode == 0) { wl = xl; wr = xr; }
    modeShown = f32(mode);
    outBuf[f] = f32(Mathf.tanh((xl * (1.0 - mix) + wl * mix) * outG));
    outBuf[MAX_FRAMES + f] = f32(Mathf.tanh((xr * (1.0 - mix) + wr * mix) * outG));
    wpos = (wpos + 1) & RBM;
  }
  display[0] = modeShown / 5.0;
  display[1] = clampf(f32(Mathf.abs(outBuf[n > 0 ? n - 1 : 0])) * 2.0, 0.0, 1.0);
}
