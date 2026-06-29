// =====================================================================
//  LATTICE VERB — classic Schroeder/Moorer algorithmic reverb
//
//  The textbook topology (NOT an FDN hall):
//    - 4 PARALLEL feedback COMB filters with prime delay lengths, summed.
//      Each comb has a one-pole low-pass in its feedback path for
//      per-comb high-frequency DAMPING (Moorer's lossy combs).
//    - The comb sum is then fed through 2 SERIES ALLPASS diffusers to
//      smear the echoes into a smooth metallic-to-smooth tail.
//    - A pre-delay line offsets the wet signal before the comb bank.
//
//  Params: Mix, Size (scales comb delay lengths), Decay (comb feedback /
//  RT60), Damping (HF loss per pass), Pre-Delay. Mix=0 -> dry. Feedback is
//  clamped < 1 so the tail always decays. All state is StaticArray at module
//  scope; process() allocates nothing.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// ---- delay-line buffer sizes (samples @ up to ~48k, with Size headroom) ----
// Base comb delays (Schroeder primes, in samples at 44.1k). Size scales these
// up to ~1.7x, and we add a small per-channel offset for stereo de-correlation,
// so allocate generously.
const NUM_COMBS: i32 = 4;
const NUM_ALLPASS: i32 = 2;

// max delay any comb line will ever need (longest base * size * sr-scale + spread)
const COMB_MAX: i32 = 4096;   // > 1687 * 1.7 * (48000/44100) + spread
const AP_MAX: i32 = 1024;     // allpass lines are short
const PRE_MAX: i32 = 9600;    // up to 200 ms pre-delay @ 48k

// comb buffers: [channel][comb][COMB_MAX]
const combBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NUM_COMBS * COMB_MAX);
const combPos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_COMBS);
const combLen: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_COMBS);
const combDamp: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NUM_COMBS); // LP state

// allpass buffers: [channel][ap][AP_MAX]
const apBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NUM_ALLPASS * AP_MAX);
const apPos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_ALLPASS);
const apLen: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_ALLPASS);

// pre-delay line: [channel][PRE_MAX]
const preBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * PRE_MAX);
const prePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);

// base comb / allpass delay lengths in samples at 44.1k reference
const baseComb: StaticArray<f32> = new StaticArray<f32>(NUM_COMBS);
const baseAp:   StaticArray<f32> = new StaticArray<f32>(NUM_ALLPASS);
// per-channel small spread (samples) so L/R aren't identical
const chanSpread: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_MIX:    i32 = 0; // 0..1 dry/wet
const P_SIZE:   i32 = 1; // 0..1 -> comb length scale
const P_DECAY:  i32 = 2; // 0..1 -> feedback gain / RT60
const P_DAMP:   i32 = 3; // 0..1 -> HF loss per pass
const P_PRE:    i32 = 4; // 0..1 -> 0..200 ms pre-delay

let sizeScale: f32 = 1.0;     // resolved each block

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

@inline function clampi(x: i32, lo: i32, hi: i32): i32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;

  // Classic Schroeder comb primes (samples @ 44.1k)
  baseComb[0] = 1557.0;
  baseComb[1] = 1617.0;
  baseComb[2] = 1491.0;
  baseComb[3] = 1422.0;
  // Series allpass diffuser delays (samples @ 44.1k)
  baseAp[0] = 225.0;
  baseAp[1] = 556.0;

  chanSpread[0] = 0.0;
  chanSpread[1] = 23.0; // few-sample offset on the right for stereo width

  // clear all delay state
  for (let i = 0; i < MAX_CHANNELS * NUM_COMBS * COMB_MAX; i++) combBuf[i] = 0.0;
  for (let i = 0; i < MAX_CHANNELS * NUM_ALLPASS * AP_MAX; i++) apBuf[i] = 0.0;
  for (let i = 0; i < MAX_CHANNELS * PRE_MAX; i++) preBuf[i] = 0.0;
  for (let i = 0; i < MAX_CHANNELS * NUM_COMBS; i++) { combPos[i] = 0; combDamp[i] = 0.0; }
  for (let i = 0; i < MAX_CHANNELS * NUM_ALLPASS; i++) apPos[i] = 0;
  for (let c = 0; c < MAX_CHANNELS; c++) prePos[c] = 0;

  params[P_MIX] = 0.35;
  params[P_SIZE] = 0.5;
  params[P_DECAY] = 0.6;
  params[P_DAMP] = 0.4;
  params[P_PRE] = 0.0;

  resolveLengths();
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// Compute integer delay lengths from Size and the engine sample rate.
function resolveLengths(): void {
  const srScale: f32 = sampleRate / 44100.0;
  const size: f32 = clampf(params[P_SIZE], 0.0, 1.0);
  // Size scales comb length from 0.55x .. 1.6x of the reference primes
  sizeScale = 0.55 + size * 1.05;

  for (let c = 0; c < channels; c++) {
    for (let k = 0; k < NUM_COMBS; k++) {
      let len: f32 = baseComb[k] * sizeScale * srScale + chanSpread[c];
      let li: i32 = clampi(i32(len), 16, COMB_MAX - 1);
      combLen[c * NUM_COMBS + k] = li;
    }
    for (let k = 0; k < NUM_ALLPASS; k++) {
      let len: f32 = baseAp[k] * srScale + chanSpread[c] * 0.3;
      let li: i32 = clampi(i32(len), 8, AP_MAX - 1);
      apLen[c * NUM_ALLPASS + k] = li;
    }
  }
}

export function process(n: i32): void {
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const decay: f32 = clampf(params[P_DECAY], 0.0, 1.0);
  const damp: f32 = clampf(params[P_DAMP], 0.0, 1.0);
  const preN: f32 = clampf(params[P_PRE], 0.0, 1.0);

  resolveLengths();

  // Feedback gain from decay, hard-clamped < 1 so the tail always decays.
  // 0 -> short room (~0.7), 1 -> long tail (~0.96).
  const feedback: f32 = clampf(0.70 + decay * 0.262, 0.0, 0.965);

  // Damping low-pass coefficient: more damp -> lower cutoff -> faster HF loss.
  // dampCoef is the LP "keep" amount of the previous sample.
  const dampCoef: f32 = clampf(0.05 + damp * 0.85, 0.0, 0.95);
  const inputGain: f32 = 1.0 - dampCoef; // normalise the one-pole

  // pre-delay in samples (0..200 ms)
  const preSamplesF: f32 = preN * 0.200 * sampleRate;
  const preSamples: i32 = clampi(i32(preSamplesF), 0, PRE_MAX - 1);

  // output normalisation: combs sum in parallel -> divide by count, gentle trim
  const combNorm: f32 = 0.30; // keeps wet peak well under 1.0

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const preBase: i32 = c * PRE_MAX;
    let pp: i32 = prePos[c];

    for (let f = 0; f < n; f++) {
      const dry: f32 = inBuf[base + f];

      // ---- pre-delay ----
      preBuf[preBase + pp] = dry;
      let rp: i32 = pp - preSamples;
      if (rp < 0) rp += PRE_MAX;
      const preOut: f32 = preBuf[preBase + rp];
      pp++; if (pp >= PRE_MAX) pp = 0;

      // ---- parallel comb bank with per-comb HF damping in feedback ----
      let combSum: f32 = 0.0;
      for (let k = 0; k < NUM_COMBS; k++) {
        const ci: i32 = c * NUM_COMBS + k;
        const cbBase: i32 = ci * COMB_MAX;
        const len: i32 = combLen[ci];
        let pos: i32 = combPos[ci];

        const y: f32 = combBuf[cbBase + pos]; // delayed output
        combSum += y;

        // one-pole low-pass on the feedback (damping)
        let lp: f32 = combDamp[ci];
        lp = f32(y * inputGain + lp * dampCoef);
        combDamp[ci] = lp;

        // write new sample = input + damped feedback
        combBuf[cbBase + pos] = f32(preOut + lp * feedback);

        pos++; if (pos >= len) pos = 0;
        combPos[ci] = pos;
      }
      combSum *= combNorm;

      // ---- series allpass diffusers ----
      let sig: f32 = combSum;
      for (let k = 0; k < NUM_ALLPASS; k++) {
        const ai: i32 = c * NUM_ALLPASS + k;
        const apb: i32 = ai * AP_MAX;
        const len: i32 = apLen[ai];
        let pos: i32 = apPos[ai];

        const g: f32 = 0.5; // classic allpass coefficient
        const bufOut: f32 = apBuf[apb + pos];
        const inp: f32 = sig;
        const newBuf: f32 = f32(inp + bufOut * g);
        const out: f32 = f32(bufOut - newBuf * g);
        apBuf[apb + pos] = newBuf;
        sig = out;

        pos++; if (pos >= len) pos = 0;
        apPos[ai] = pos;
      }

      const wet: f32 = sig;
      outBuf[base + f] = f32(dry * (1.0 - mix) + wet * mix);
    }

    prePos[c] = pp;
  }

  // if host is mono, mirror to keep stereo sane (only when channels<2 nothing else writes)
}
