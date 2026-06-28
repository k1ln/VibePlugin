// =====================================================================
//  OPEN ROOM — bright, efficient algorithmic room/hall reverb
//  Eight parallel damped comb filters per channel feed four series
//  all-pass diffusers; a small stereo offset between the L/R comb
//  tunings opens up the image. Room Size sets the comb feedback (tail
//  length), Damping rolls off the highs inside the combs, Width blends
//  the stereo spread, Pre-Delay offsets the wet onset. Pure algorithm,
//  no samples. Mix=0 is bit-exact dry.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const P_MIX:     i32 = 0; // 0..1 dry/wet
const P_SIZE:    i32 = 1; // 0..1 -> comb feedback (room size / decay)
const P_DAMP:    i32 = 2; // 0..1 -> HF damping inside combs
const P_WIDTH:   i32 = 3; // 0..1 -> stereo width
const P_PREDLY:  i32 = 4; // 0..1 -> pre-delay 0..120 ms

// ---- Freeverb-style topology constants -------------------------------
const NUM_COMBS:   i32 = 8;
const NUM_ALLPASS: i32 = 4;
// Stereo offset (samples) added to the right channel comb tunings.
const STEREO_SPREAD: i32 = 23;

// Base comb delay lengths (samples @ 44.1 kHz) — classic tunings.
const combTune: StaticArray<i32> = new StaticArray<i32>(NUM_COMBS);
// Base all-pass delay lengths.
const apTune: StaticArray<i32> = new StaticArray<i32>(NUM_ALLPASS);

// Max delay buffer sizes (scaled for up to 96 kHz: *2.2 headroom).
const COMB_MAX:  i32 = 4096;  // covers longest comb (~1617 @44.1k) * SR scale
const AP_MAX:    i32 = 1024;  // covers longest allpass (~556) * SR scale
const PRE_MAX:   i32 = 16384; // 120 ms @ up to ~96 kHz fits

// Comb state: delay lines + per-channel low-pass damping memory.
const combBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NUM_COMBS * COMB_MAX);
const combIdx: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_COMBS);
const combLen: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_COMBS);
const combLP:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NUM_COMBS);

// All-pass state.
const apBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * NUM_ALLPASS * AP_MAX);
const apIdx: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_ALLPASS);
const apLen: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS * NUM_ALLPASS);

// Pre-delay line (per channel).
const preBuf: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS * PRE_MAX);
const preIdx: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

function buildDelays(): void {
  // classic comb tunings (samples @ 44.1 kHz)
  combTune[0] = 1116; combTune[1] = 1188; combTune[2] = 1277; combTune[3] = 1356;
  combTune[4] = 1422; combTune[5] = 1491; combTune[6] = 1557; combTune[7] = 1617;
  // classic all-pass tunings
  apTune[0] = 556; apTune[1] = 441; apTune[2] = 341; apTune[3] = 225;

  const srScale: f32 = sampleRate / 44100.0;

  for (let c = 0; c < MAX_CHANNELS; c++) {
    const spread: i32 = (c == 1) ? STEREO_SPREAD : 0;
    for (let k = 0; k < NUM_COMBS; k++) {
      let len: i32 = i32(f32(combTune[k] + spread) * srScale);
      if (len < 1) len = 1;
      if (len > COMB_MAX) len = COMB_MAX;
      const ci: i32 = c * NUM_COMBS + k;
      combLen[ci] = len;
      combIdx[ci] = 0;
      combLP[ci] = 0.0;
      const off: i32 = ci * COMB_MAX;
      for (let s = 0; s < len; s++) combBuf[off + s] = 0.0;
    }
    for (let k = 0; k < NUM_ALLPASS; k++) {
      let len: i32 = i32(f32(apTune[k] + spread) * srScale);
      if (len < 1) len = 1;
      if (len > AP_MAX) len = AP_MAX;
      const ai: i32 = c * NUM_ALLPASS + k;
      apLen[ai] = len;
      apIdx[ai] = 0;
      const off: i32 = ai * AP_MAX;
      for (let s = 0; s < len; s++) apBuf[off + s] = 0.0;
    }
    preIdx[c] = 0;
    const poff: i32 = c * PRE_MAX;
    for (let s = 0; s < PRE_MAX; s++) preBuf[poff + s] = 0.0;
  }
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  if (channels < 1) channels = 1;
  buildDelays();
  params[P_MIX] = 0.35; params[P_SIZE] = 0.7; params[P_DAMP] = 0.4;
  params[P_WIDTH] = 1.0; params[P_PREDLY] = 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  const mix:    f32 = clampf(params[P_MIX], 0.0, 1.0);
  const sizeN:  f32 = clampf(params[P_SIZE], 0.0, 1.0);
  const dampN:  f32 = clampf(params[P_DAMP], 0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const preN:   f32 = clampf(params[P_PREDLY], 0.0, 1.0);

  // Mix=0 -> bit-exact dry passthrough.
  if (mix <= 0.0) {
    for (let c = 0; c < channels; c++) {
      const base: i32 = c * MAX_FRAMES;
      for (let f = 0; f < n; f++) outBuf[base + f] = inBuf[base + f];
    }
    return;
  }

  // comb feedback: 0.7..~0.98 (room size). guarded < 1.
  const feedback: f32 = 0.70 + sizeN * 0.28;
  // damping low-pass coefficient inside combs.
  const damp1: f32 = dampN * 0.4;       // 0..0.4
  const damp2: f32 = 1.0 - damp1;
  // input gain into the reverb network (keeps the tail bounded).
  const inGain: f32 = 0.015;
  // pre-delay length in samples (0..120 ms).
  let preSamp: i32 = i32(preN * 0.120 * sampleRate);
  if (preSamp < 0) preSamp = 0;
  if (preSamp >= PRE_MAX) preSamp = PRE_MAX - 1;

  // equal-power dry/wet
  const wetG: f32 = mix;
  const dryG: f32 = 1.0 - mix;

  // Width: blend mono(0) .. full stereo(1) of the wet signal.
  const wWet: f32 = 0.5 + 0.5 * widthN; // this channel weight
  const wCross: f32 = 0.5 - 0.5 * widthN; // other channel weight

  // process per channel; we need both wet channels before width mixing,
  // so compute wet into outBuf scratch (channel-separated), then blend.
  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const poff: i32 = c * PRE_MAX;
    let pIdx: i32 = preIdx[c];

    for (let f = 0; f < n; f++) {
      const dry: f32 = inBuf[base + f];

      // ---- pre-delay ----
      let rIdx: i32 = pIdx - preSamp;
      if (rIdx < 0) rIdx += PRE_MAX;
      const preOut: f32 = preBuf[poff + rIdx];
      preBuf[poff + pIdx] = dry;
      pIdx++;
      if (pIdx >= PRE_MAX) pIdx = 0;

      const input: f32 = preOut * inGain;

      // ---- parallel damped combs ----
      let acc: f32 = 0.0;
      for (let k = 0; k < NUM_COMBS; k++) {
        const ci: i32 = c * NUM_COMBS + k;
        const off: i32 = ci * COMB_MAX;
        const len: i32 = combLen[ci];
        let idx: i32 = combIdx[ci];
        const y: f32 = combBuf[off + idx];
        acc += y;
        // one-pole LP damping in the feedback path
        let lp: f32 = combLP[ci];
        lp = y * damp2 + lp * damp1;
        combLP[ci] = lp;
        combBuf[off + idx] = input + lp * feedback;
        idx++;
        if (idx >= len) idx = 0;
        combIdx[ci] = idx;
      }

      // ---- series all-pass diffusers ----
      let s: f32 = acc;
      for (let k = 0; k < NUM_ALLPASS; k++) {
        const ai: i32 = c * NUM_ALLPASS + k;
        const off: i32 = ai * AP_MAX;
        const len: i32 = apLen[ai];
        let idx: i32 = apIdx[ai];
        const buf: f32 = apBuf[off + idx];
        const out: f32 = buf - s;        // allpass output
        apBuf[off + idx] = s + buf * 0.5; // feedback coeff 0.5
        idx++;
        if (idx >= len) idx = 0;
        apIdx[ai] = idx;
        s = out;
      }

      // store the raw wet for this channel in outBuf scratch
      outBuf[base + f] = s;
    }
    preIdx[c] = pIdx;
  }

  // ---- width blend + dry/wet mix ----
  if (channels >= 2) {
    for (let f = 0; f < n; f++) {
      const wl: f32 = outBuf[f];
      const wr: f32 = outBuf[MAX_FRAMES + f];
      const wetL: f32 = wl * wWet + wr * wCross;
      const wetR: f32 = wr * wWet + wl * wCross;
      const dryL: f32 = inBuf[f];
      const dryR: f32 = inBuf[MAX_FRAMES + f];
      outBuf[f] = dryL * dryG + wetL * wetG;
      outBuf[MAX_FRAMES + f] = dryR * dryG + wetR * wetG;
    }
  } else {
    for (let f = 0; f < n; f++) {
      const w: f32 = outBuf[f];
      const d: f32 = inBuf[f];
      outBuf[f] = d * dryG + w * wetG;
    }
  }
}
