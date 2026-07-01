// =====================================================================
//  TOWER SPRING — long, bright HI-FI studio spring reverb
//  (an original model in the tall studio-spring-tank lineage)
//
//  Where a tight surf/amp spring is short and lo-fi, the tall studio
//  tank gives a LONGER, smoother, brighter decay — up to several
//  seconds — that still carries the characteristic dispersive "boing /
//  chirp" but cleaner. The engine:
//
//    * a long cascade of dispersive all-pass stages (the spring's
//      frequency-dependent travel time => the chirp / "boing"),
//    * wrapped in a long modulated feedback delay (the tank length),
//    * with a stereo pair of decorrelated loops for width,
//    * a gentle tilt/damping tone control (dark -> bright, hi-fi),
//    * a decay-time control that scales the loop feedback toward
//      several-second tails.
//
//  Params: Mix, Decay, Tone, Boing, Width. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const PI: f32 = 3.14159265;
const TWO_PI: f32 = 6.2831855;

// ---- dispersive all-pass chain (the "spring") ----------------------
// A long cascade of short all-pass delays per channel. The cumulative
// frequency-dependent group delay smears a transient into the chirpy
// "boing"; more stages + higher coefficient = more pronounced glide.
const NAP: i32 = 12;          // stages of dispersion (long, smooth spring)
const AP_CAP: i32 = 512;      // max samples per stage
const apBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NAP * AP_CAP);
const apPos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NAP);
const apLen: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NAP);
const apBase: StaticArray<i32> = new StaticArray<i32>(NAP); // base lengths @48k

// ---- main spring feedback delay (the tall tank length) -------------
// Long enough for a several-second tail. Two decorrelated lengths so
// L and R ring differently (studio width).
const SPRING_CAP: i32 = 32768;
const springBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * SPRING_CAP);
const springPos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const springLenC: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const springBaseC: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS); // base length @48k

// chorus modulation of the tank length (subtle shimmer, BX20-ish)
const modPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// per-channel filter state
const dampState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tail HF damping LP
const lowState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tilt low shelf LP
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker
const dcPrev:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const preEmph:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // input HP for excitation

const P_MIX:   i32 = 0;  // dry/wet
const P_DECAY: i32 = 1;  // short -> several seconds
const P_TONE:  i32 = 2;  // dark -> bright
const P_BOING: i32 = 3;  // dispersion / chirp amount
const P_WIDTH: i32 = 4;  // mono -> wide stereo

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  // Mutually-prime-ish short all-pass lengths -> dense, chirpy dispersion
  // with no fixed pitched ring.
  apBase[0]  = 67;  apBase[1]  = 83;  apBase[2]  = 103; apBase[3]  = 127;
  apBase[4]  = 149; apBase[5]  = 167; apBase[6]  = 193; apBase[7]  = 227;
  apBase[8]  = 257; apBase[9]  = 281; apBase[10] = 317; apBase[11] = 349;
  for (let i = 0; i < NAP; i++) apLen[i] = apBase[i];

  // Two decorrelated tank lengths (~ different spring tensions) for width.
  springBaseC[0] = 4801;
  springBaseC[1] = 5519;

  for (let i = 0; i < MAX_CHANNELS * NAP; i++) apPos[i] = 0;
  for (let i = 0; i < MAX_CHANNELS * NAP; i++) apLen[i] = apBase[i % NAP];
  for (let c = 0; c < MAX_CHANNELS; c++) {
    springPos[c] = 0; springLenC[c] = springBaseC[c]; modPhase[c] = f32(c) * 1.7;
    dampState[c] = 0.0; lowState[c] = 0.0; dcState[c] = 0.0;
    dcPrev[c] = 0.0; preEmph[c] = 0.0;
  }
  for (let i = 0; i < MAX_CHANNELS * NAP * AP_CAP; i++) apBuf[i] = 0.0;
  for (let i = 0; i < MAX_CHANNELS * SPRING_CAP; i++) springBuf[i] = 0.0;

  params[P_MIX] = 0.35; params[P_DECAY] = 0.6; params[P_TONE] = 0.62;
  params[P_BOING] = 0.5; params[P_WIDTH] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// One dispersive all-pass stage for channel c, stage i, coefficient g.
@inline function apStage(c: i32, i: i32, x: f32, g: f32): f32 {
  const slot: i32 = c * NAP + i;
  const base: i32 = slot * AP_CAP;
  let p: i32 = apPos[slot];
  const buffered: f32 = apBuf[base + p];
  const y: f32 = -g * x + buffered;
  apBuf[base + p] = x + g * y;
  p++; if (p >= apLen[slot]) p = 0;
  apPos[slot] = p;
  return y;
}

export function process(n: i32): void {
  const mix:   f32 = clampf(params[P_MIX], 0.0, 1.0);
  const decay: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const tone:  f32 = clampf(params[P_TONE], 0.0, 1.0);
  const boing: f32 = clampf(params[P_BOING], 0.0, 1.0);
  const width: f32 = clampf(params[P_WIDTH], 0.0, 1.0);

  const srRatio: f32 = sampleRate / 48000.0;

  // Boing scales the dispersive all-pass coefficient (more chirp/glide) and
  // gently lengthens the spring stages (slower, more pronounced boing).
  const apG: f32 = 0.62 + boing * 0.33;             // 0.62..0.95
  const apScale: f32 = 1.0 + boing * 0.35;          // 1.0..1.35

  // Tank length scales with sr; keep both channels' lengths in range.
  for (let c = 0; c < MAX_CHANNELS; c++) {
    let L: i32 = i32(f32(springBaseC[c]) * srRatio);
    if (L < 64) L = 64;
    if (L >= SPRING_CAP - 8) L = SPRING_CAP - 8;
    springLenC[c] = L;
  }
  for (let i = 0; i < NAP; i++) {
    let L: i32 = i32(f32(apBase[i]) * apScale * srRatio);
    if (L < 2) L = 2; if (L >= AP_CAP) L = AP_CAP - 1;
    // both channels share the per-stage length but keep independent state
    apLen[0 * NAP + i] = L;
    apLen[1 * NAP + i] = L;
  }

  // Decay -> feedback gain of the long tank loop. A high cap gives the
  // several-second studio tail while staying < 1 for stability (the round
  // trip is all-pass chain (unity) * fb, so fb is the hard loop-gain cap).
  const fb: f32 = clampf(0.55 + decay * 0.435, 0.0, 0.985);  // 0.55..0.985

  // Tone: a bright/dark tilt. High tone -> less HF damping in the tail and
  // less low-shelf, so the verb stays hi-fi and bright. Damping cutoff also
  // rises with tone.
  const dampHz: f32 = 1800.0 + tone * tone * 9000.0;          // 1.8k..10.8k
  const cDamp: f32 = clampf(f32(1.0 - Mathf.exp(-TWO_PI * dampHz / sampleRate)), 0.02, 0.999);
  // low shelf (one-pole LP we subtract a portion of): more low cut when bright
  const cLow: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 180.0 / sampleRate));
  const lowCut: f32 = 0.15 + tone * 0.35;                     // 0.15..0.5

  // Boing also drives the excitation harder (sharper transient -> more chirp).
  const driveAmt: f32 = 0.7 + boing * 1.1;          // 0.7..1.8
  const emphAmt: f32 = 0.3 + boing * 0.8;

  // subtle tank modulation depth (in samples) for studio shimmer
  const modDepth: f32 = 1.5 + tone * 2.5;           // brighter -> a touch more
  const modInc: f32 = 0.6 / sampleRate;             // ~0.6 Hz wobble

  // Width: stereo decorrelation amount applied via mid/side on the wet sum.
  const sideAmt: f32 = width;

  const outScale: f32 = 0.5;

  // We process both channels frame-interleaved so we can mid/side the wet.
  let sp0: i32 = springPos[0];
  let sp1: i32 = springPos[1];
  let dmp0: f32 = dampState[0]; let dmp1: f32 = dampState[1];
  let low0: f32 = lowState[0];  let low1: f32 = lowState[1];
  let dcs0: f32 = dcState[0];   let dcs1: f32 = dcState[1];
  let dcp0: f32 = dcPrev[0];    let dcp1: f32 = dcPrev[1];
  let emp0: f32 = preEmph[0];   let emp1: f32 = preEmph[1];
  let mph0: f32 = modPhase[0];  let mph1: f32 = modPhase[1];

  const sBase0: i32 = 0 * SPRING_CAP;
  const sBase1: i32 = 1 * SPRING_CAP;
  const inBase0: i32 = 0 * MAX_FRAMES;
  const inBase1: i32 = 1 * MAX_FRAMES;
  const len0: i32 = springLenC[0];
  const len1: i32 = springLenC[1];

  for (let f = 0; f < n; f++) {
    const xL: f32 = inBuf[inBase0 + f];
    const xR: f32 = channels > 1 ? inBuf[inBase1 + f] : xL;

    // ---- excitation: transient-emphasized input feeds each loop ------
    const hpL: f32 = xL - emp0; emp0 = emp0 + 0.6 * hpL;
    const hpR: f32 = xR - emp1; emp1 = emp1 + 0.6 * hpR;
    const excL: f32 = (xL + emphAmt * hpL) * driveAmt;
    const excR: f32 = (xR + emphAmt * hpR) * driveAmt;

    // ---- modulated read of each tank --------------------------------
    mph0 += modInc; if (mph0 >= 1.0) mph0 -= 1.0;
    mph1 += modInc; if (mph1 >= 1.0) mph1 -= 1.0;
    const m0: f32 = modDepth * Mathf.sin(TWO_PI * mph0);
    const m1: f32 = modDepth * Mathf.sin(TWO_PI * mph1);

    const rp0f: f32 = f32(sp0) - (f32(len0) + m0);
    const rp1f: f32 = f32(sp1) - (f32(len1) + m1);
    const tap0: f32 = readTank(sBase0, rp0f);
    const tap1: f32 = readTank(sBase1, rp1f);

    // ---- HF damping (one-pole LP) in the recirculating tail ----------
    dmp0 = dmp0 + cDamp * (tap0 - dmp0);
    dmp1 = dmp1 + cDamp * (tap1 - dmp1);

    // ---- excite dispersive chains with input + damped feedback -------
    let v0: f32 = excL + dmp0 * fb;
    let v1: f32 = excR + dmp1 * fb;

    v0 = apStage(0, 0, v0, apG); v1 = apStage(1, 0, v1, apG);
    v0 = apStage(0, 1, v0, apG); v1 = apStage(1, 1, v1, apG);
    v0 = apStage(0, 2, v0, apG); v1 = apStage(1, 2, v1, apG);
    v0 = apStage(0, 3, v0, apG); v1 = apStage(1, 3, v1, apG);
    v0 = apStage(0, 4, v0, apG); v1 = apStage(1, 4, v1, apG);
    v0 = apStage(0, 5, v0, apG); v1 = apStage(1, 5, v1, apG);
    v0 = apStage(0, 6, v0, apG); v1 = apStage(1, 6, v1, apG);
    v0 = apStage(0, 7, v0, apG); v1 = apStage(1, 7, v1, apG);
    v0 = apStage(0, 8, v0, apG); v1 = apStage(1, 8, v1, apG);
    v0 = apStage(0, 9, v0, apG); v1 = apStage(1, 9, v1, apG);
    v0 = apStage(0, 10, v0, apG); v1 = apStage(1, 10, v1, apG);
    v0 = apStage(0, 11, v0, apG); v1 = apStage(1, 11, v1, apG);

    // ---- tilt: subtract a portion of the lows (keeps it bright/hi-fi)-
    low0 = low0 + cLow * (v0 - low0);
    low1 = low1 + cLow * (v1 - low1);
    v0 = v0 - lowCut * low0;
    v1 = v1 - lowCut * low1;

    // ---- soft saturation keeps the long loop bounded -----------------
    if (v0 > 1.4) v0 = 1.4; else if (v0 < -1.4) v0 = -1.4;
    if (v1 > 1.4) v1 = 1.4; else if (v1 < -1.4) v1 = -1.4;
    v0 = v0 - 0.16 * v0 * v0 * v0;
    v1 = v1 - 0.16 * v1 * v1 * v1;

    // ---- DC blocker before re-injecting ------------------------------
    const o0: f32 = v0 - dcp0 + 0.9995 * dcs0; dcp0 = v0; dcs0 = o0;
    const o1: f32 = v1 - dcp1 + 0.9995 * dcs1; dcp1 = v1; dcs1 = o1;

    // ---- write back into each tank -----------------------------------
    springBuf[sBase0 + sp0] = o0; sp0++; if (sp0 >= SPRING_CAP) sp0 = 0;
    springBuf[sBase1 + sp1] = o1; sp1++; if (sp1 >= SPRING_CAP) sp1 = 0;

    // ---- stereo width via mid/side on the wet ------------------------
    let wL: f32 = o0 * outScale;
    let wR: f32 = o1 * outScale;
    const mid: f32 = 0.5 * (wL + wR);
    const side: f32 = 0.5 * (wL - wR) * (0.25 + sideAmt * 1.75);
    wL = mid + side;
    wR = mid - side;

    outBuf[inBase0 + f] = xL * (1.0 - mix) + wL * mix;
    outBuf[inBase1 + f] = xR * (1.0 - mix) + wR * mix;
  }

  springPos[0] = sp0; springPos[1] = sp1;
  dampState[0] = dmp0; dampState[1] = dmp1;
  lowState[0] = low0;  lowState[1] = low1;
  dcState[0] = dcs0;   dcState[1] = dcs1;
  dcPrev[0] = dcp0;    dcPrev[1] = dcp1;
  preEmph[0] = emp0;   preEmph[1] = emp1;
  modPhase[0] = mph0;  modPhase[1] = mph1;
}

// linear-interpolated read of a tank at fractional position (samples behind)
@inline function readTank(sBase: i32, posf: f32): f32 {
  let p: f32 = posf;
  while (p < 0.0) p += f32(SPRING_CAP);
  const i0: i32 = i32(p);
  const frac: f32 = p - f32(i0);
  let i1: i32 = i0 + 1; if (i1 >= SPRING_CAP) i1 -= SPRING_CAP;
  const a: f32 = springBuf[sBase + i0];
  const b: f32 = springBuf[sBase + i1];
  return f32(a + (b - a) * frac);
}
