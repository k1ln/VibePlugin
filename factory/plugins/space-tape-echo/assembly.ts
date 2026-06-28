// =====================================================================
//  SPACE TAPE ECHO — multi-head tape delay
//  A single circulating tape loop is read by THREE virtual playback heads
//  spaced at fixed taps along the loop (short / medium / long). A Mode
//  control selects which combination of heads is active, so each setting
//  gives a different rhythmic echo pattern. The repeats run through a
//  tape-style HF-loss filter and a gentle record/playback saturation, and
//  a slow wow + faster flutter LFO wobbles the tape speed for the unstable
//  vintage pitch wander. Feedback is clamped so dense self-oscillation
//  rings but stays bounded. A short diffuse ambient tail sits under the
//  repeats. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Tape loop: long enough for the longest head tap (3x base time) at the
// longest base time (~700 ms) plus modulation headroom, at up to 96 kHz.
// 700ms * 3 = 2.1s -> ~201600 @96k; round up generously.
const TAPE_LEN: i32 = 220000 + 8192;
const tapeL: StaticArray<f32> = new StaticArray<f32>(TAPE_LEN);
const tapeR: StaticArray<f32> = new StaticArray<f32>(TAPE_LEN);

// Short diffuse ambient tail — two short allpass/comb-ish lines per channel.
const AMB_LEN: i32 = 8192;
const ambL: StaticArray<f32> = new StaticArray<f32>(AMB_LEN);
const ambR: StaticArray<f32> = new StaticArray<f32>(AMB_LEN);
const AMB_T1: i32 = 1237;  // prime-ish delays for diffusion
const AMB_T2: i32 = 1931;

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;
let ambPos: i32 = 0;

// per-channel feedback tape-loss low-pass state
let lossLpL: f32 = 0.0;
let lossLpR: f32 = 0.0;

// ambient tail state
let ambLpL: f32 = 0.0;
let ambLpR: f32 = 0.0;

// smoothed base delay (samples) — the spacing of head 1 = the "Time" knob.
let smoothDelay: f32 = 9600.0;

// wow + flutter LFO phases (shared tape transport)
let wowPhase: f32 = 0.0;
let flutPhase: f32 = 0.0;

const P_TIME: i32 = 0;      // 0..1 -> base tape speed (head spacing), ~40..700 ms
const P_FEEDBACK: i32 = 1;  // 0..1 -> feedback amount (clamped to 0.95)
const P_MODE: i32 = 2;      // 0..1 -> selects head combination (12 modes)
const P_WOW: i32 = 3;       // 0..1 -> wow/flutter depth
const P_TONE: i32 = 4;      // 0..1 -> repeat brightness (tape HF loss cutoff)
const P_MIX: i32 = 5;       // 0..1 -> dry/wet

const TWO_PI: f32 = 6.2831853;

// Head tap multipliers relative to the base "Time" spacing. Three virtual
// playback heads positioned further down the tape from the record head.
const HEAD1: f32 = 1.0;
const HEAD2: f32 = 1.95;   // slightly off integer -> looser, more tape-like
const HEAD3: f32 = 3.0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  writePos = 0;
  ambPos = 0;
  lossLpL = 0.0; lossLpR = 0.0;
  ambLpL = 0.0; ambLpR = 0.0;
  wowPhase = 0.0; flutPhase = 0.0;
  for (let i = 0; i < TAPE_LEN; i++) { tapeL[i] = 0.0; tapeR[i] = 0.0; }
  for (let i = 0; i < AMB_LEN; i++) { ambL[i] = 0.0; ambR[i] = 0.0; }
  smoothDelay = 0.18 * sampleRate; // ~180 ms default base spacing
  params[P_TIME] = 0.30;
  params[P_FEEDBACK] = 0.45;
  params[P_MODE] = 0.40;
  params[P_WOW] = 0.30;
  params[P_TONE] = 0.55;
  params[P_MIX] = 0.45;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Linear-interpolated, wrap-safe read of a tape line, `delaySamples` behind
// the write head.
@inline function readTape(line: StaticArray<f32>, delaySamples: f32): f32 {
  let rp: f32 = f32(writePos) - delaySamples;
  while (rp < 0.0) rp += f32(TAPE_LEN);
  while (rp >= f32(TAPE_LEN)) rp -= f32(TAPE_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1;
  if (i1 >= TAPE_LEN) i1 = 0;
  const frac: f32 = rp - f32(i0);
  const a: f32 = line[i0];
  const b: f32 = line[i1];
  return f32(a + (b - a) * frac);
}

// Read at an absolute (already wrapped logic handled here) index in the
// ambient line.
@inline function readAmb(line: StaticArray<f32>, back: i32): f32 {
  let p: i32 = ambPos - back;
  if (p < 0) p += AMB_LEN;
  return line[p];
}

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fbN: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const modeN: f32 = clampf(params[P_MODE], 0.0, 1.0);
  const wowN: f32 = clampf(params[P_WOW], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Base head spacing ("Time"): ~40..700 ms with a perceptual curve.
  const timeMs: f32 = 40.0 + timeN * timeN * 660.0;
  let targetDelay: f32 = timeMs * 0.001 * sampleRate;
  // Longest active head is HEAD3 = 3x; keep that within the tape buffer.
  const maxBase: f32 = f32(TAPE_LEN - 8) / HEAD3;
  if (targetDelay > maxBase) targetDelay = maxBase;
  if (targetDelay < 8.0) targetDelay = 8.0;

  // Feedback strictly clamped: dense multi-head feedback can build fast, so
  // cap a touch below 0.95 of the requested amount and tanh-limit the loop.
  const fbGain: f32 = clampf(fbN * 0.95, 0.0, 0.95);

  // Mode: 12 discrete head combinations (like the original's selector).
  // Decode to three head-enable gains. Each entry switches heads on/off.
  const modeIdx: i32 = i32(clampf(modeN * 11.0 + 0.5, 0.0, 11.0));
  let g1: f32 = 0.0; let g2: f32 = 0.0; let g3: f32 = 0.0;
  if (modeIdx == 0)      { g1 = 1.0; g2 = 0.0; g3 = 0.0; } // head 1
  else if (modeIdx == 1) { g1 = 0.0; g2 = 1.0; g3 = 0.0; } // head 2
  else if (modeIdx == 2) { g1 = 0.0; g2 = 0.0; g3 = 1.0; } // head 3
  else if (modeIdx == 3) { g1 = 1.0; g2 = 1.0; g3 = 0.0; } // 1+2
  else if (modeIdx == 4) { g1 = 0.0; g2 = 1.0; g3 = 1.0; } // 2+3
  else if (modeIdx == 5) { g1 = 1.0; g2 = 0.0; g3 = 1.0; } // 1+3
  else if (modeIdx == 6) { g1 = 1.0; g2 = 1.0; g3 = 1.0; } // 1+2+3
  else if (modeIdx == 7) { g1 = 0.8; g2 = 1.0; g3 = 0.6; } // 2 lead, 1+3 under
  else if (modeIdx == 8) { g1 = 1.0; g2 = 0.7; g3 = 1.0; } // 1+3 lead
  else if (modeIdx == 9) { g1 = 0.6; g2 = 1.0; g3 = 1.0; } // 2+3 lead
  else if (modeIdx == 10){ g1 = 1.0; g2 = 1.0; g3 = 0.5; } // 1+2, soft 3
  else                   { g1 = 0.7; g2 = 0.85; g3 = 1.0; }// long-weighted

  // Normalise the active heads so denser modes don't blow up the level.
  const gSum: f32 = g1 + g2 + g3;
  const gNorm: f32 = gSum > 0.0001 ? f32(1.0 / Mathf.sqrt(gSum)) : 1.0;
  g1 *= gNorm; g2 *= gNorm; g3 *= gNorm;

  // The signal fed back into the loop is the sum of the active heads; pick a
  // representative single delay for the feedback path so feedback timing is
  // coherent (use the longest active head).
  let fbHeadMul: f32 = HEAD1;
  if (g3 > 0.0) fbHeadMul = HEAD3;
  else if (g2 > 0.0) fbHeadMul = HEAD2;

  // Tape HF loss in the loop: brighter when Tone high. ~1200..7500 Hz.
  const toneHz: f32 = 1200.0 + toneN * toneN * 6300.0;
  let cLoss: f32 = f32(1.0 - Mathf.exp(-TWO_PI * toneHz / sampleRate));
  cLoss = clampf(cLoss, 0.0, 1.0);

  // Ambient tail damping low-pass (keep the tail dark and diffuse).
  const cAmb: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 3200.0 / sampleRate));

  // Wow (slow) + flutter (fast) modulation of the tape transport. Depth in
  // samples scales the read position of every head together (transport speed).
  const wowDepth: f32 = wowN * 0.004;   // fractional speed deviation (slow)
  const flutDepth: f32 = wowN * 0.0015; // fractional speed deviation (fast)
  const wowRate: f32 = 0.6;   // Hz
  const flutRate: f32 = 6.7;  // Hz
  const wowInc: f32 = TWO_PI * wowRate / sampleRate;
  const flutInc: f32 = TWO_PI * flutRate / sampleRate;

  // Smooth the base delay toward target (~8 Hz one-pole) to avoid zipper noise.
  const smoothCoeff: f32 = f32(1.0 - Mathf.exp(-TWO_PI * 8.0 / sampleRate));

  const maxRead: f32 = f32(TAPE_LEN - 4);
  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    // advance modulation
    wowPhase += wowInc; if (wowPhase >= TWO_PI) wowPhase -= TWO_PI;
    flutPhase += flutInc; if (flutPhase >= TWO_PI) flutPhase -= TWO_PI;
    const wob: f32 = Mathf.sin(wowPhase) * wowDepth + Mathf.sin(flutPhase) * flutDepth;
    // transport scaling: all head taps stretch/compress together
    const speed: f32 = 1.0 + wob;

    smoothDelay += smoothCoeff * (targetDelay - smoothDelay);
    const base: f32 = smoothDelay * speed;

    // head tap distances (modulated as a group, slight L/R offset for width)
    let d1: f32 = base * HEAD1;
    let d2: f32 = base * HEAD2;
    let d3: f32 = base * HEAD3;
    if (d1 < 2.0) d1 = 2.0; if (d1 > maxRead) d1 = maxRead;
    if (d2 < 2.0) d2 = 2.0; if (d2 > maxRead) d2 = maxRead;
    if (d3 < 2.0) d3 = 2.0; if (d3 > maxRead) d3 = maxRead;

    const xL: f32 = inBuf[f];
    const xR: f32 = stereo ? inBuf[MAX_FRAMES + f] : xL;

    // ---- read the three heads (L slightly earlier, R slightly later) -----
    const offL: f32 = 1.0;
    const offR: f32 = 1.0;
    const h1L: f32 = readTape(tapeL, d1 - offL);
    const h2L: f32 = readTape(tapeL, d2 - offL);
    const h3L: f32 = readTape(tapeL, d3 - offL);
    const h1R: f32 = readTape(tapeR, d1 + offR);
    const h2R: f32 = readTape(tapeR, d2 + offR);
    const h3R: f32 = readTape(tapeR, d3 + offR);

    const echoL: f32 = h1L * g1 + h2L * g2 + h3L * g3;
    const echoR: f32 = h1R * g1 + h2R * g2 + h3R * g3;

    // ---- feedback path: take the loop tap, apply tape HF loss + saturation
    const fbTapL: f32 = readTape(tapeL, base * fbHeadMul);
    const fbTapR: f32 = readTape(tapeR, base * fbHeadMul);
    lossLpL += cLoss * (fbTapL - lossLpL);
    lossLpR += cLoss * (fbTapR - lossLpR);

    // record/playback saturation keeps runaway feedback bounded & warm
    let recL: f32 = xL + lossLpL * fbGain;
    let recR: f32 = xR + lossLpR * fbGain;
    recL = f32(Mathf.tanh(recL));
    recR = f32(Mathf.tanh(recR));

    // write to the tape at the record head
    tapeL[writePos] = recL;
    tapeR[writePos] = recR;

    // ---- short ambient tail fed by the echo sum --------------------------
    const ambInL: f32 = echoL * 0.6;
    const ambInR: f32 = echoR * 0.6;
    const a1L: f32 = readAmb(ambL, AMB_T1);
    const a2L: f32 = readAmb(ambL, AMB_T2);
    const a1R: f32 = readAmb(ambR, AMB_T1);
    const a2R: f32 = readAmb(ambR, AMB_T2);
    let tailL: f32 = (a1L + a2L) * 0.5;
    let tailR: f32 = (a1R + a2R) * 0.5;
    ambLpL += cAmb * (tailL - ambLpL);
    ambLpR += cAmb * (tailR - ambLpR);
    tailL = ambLpL;
    tailR = ambLpR;
    // feed the diffuser (cross-couple L/R for a wider tail), bounded gain
    ambL[ambPos] = f32(ambInL + tailR * 0.45);
    ambR[ambPos] = f32(ambInR + tailL * 0.45);
    ambPos++; if (ambPos >= AMB_LEN) ambPos = 0;

    // ---- wet sum: heads + a touch of ambient tail ------------------------
    const wetL: f32 = echoL + tailL * 0.35;
    const wetR: f32 = echoR + tailR * 0.35;

    // Output gain trim keeps the wet path peak < ~1.0 even at dense modes.
    const oL: f32 = xL * (1.0 - mix) + wetL * 0.7 * mix;
    const oR: f32 = xR * (1.0 - mix) + wetR * 0.7 * mix;

    outBuf[f] = f32(oL);
    if (stereo) outBuf[MAX_FRAMES + f] = f32(oR);
    else outBuf[MAX_FRAMES + f] = outBuf[f];

    writePos++;
    if (writePos >= TAPE_LEN) writePos = 0;
  }
}
