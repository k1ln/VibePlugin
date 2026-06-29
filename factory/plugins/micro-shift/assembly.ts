// =====================================================================
//  MICRO SHIFT — micro-pitch detune doubler / fattener
//  Two pitch-shifted voices, detuned a few cents UP and DOWN below a
//  semitone, each with its own short delay tap, panned hard L/R and
//  blended with the dry signal — turning a mono source into a wide,
//  thick, shimmering double. Pitch shifting is done with a fractional
//  delay line read at a drifting rate, using two overlapping read taps
//  crossfaded by a triangular window to avoid the wrap discontinuity
//  (classic "rotating delay" pitch shifter — no FFT, no zipper noise).
//  Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

// Pitch-shift delay buffers, one per voice (mono input is summed in).
// 4096 frames @48k ~= 85 ms — plenty for the grain window + Delay tap.
const DLEN: i32 = 4096;
const DMASK: i32 = 4095;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// Two voice delay lines (voice 0 = pitched DOWN, voice 1 = pitched UP).
const ring0: StaticArray<f32> = new StaticArray<f32>(DLEN);
const ring1: StaticArray<f32> = new StaticArray<f32>(DLEN);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let wpos: i32 = 0;            // shared write head for both rings
let phase0: f32 = 0.0;        // grain phase for voice 0 (0..1)
let phase1: f32 = 0.5;        // grain phase for voice 1 (offset half a window)
let fb0: f32 = 0.0;           // feedback memory voice 0
let fb1: f32 = 0.0;           // feedback memory voice 1

// smoothed control values (per-sample slew kills zipper noise)
let sDetune: f32 = 0.12;
let sDelay: f32 = 0.3;
let sWidth: f32 = 0.7;
let sFb: f32 = 0.0;
let sMix: f32 = 0.5;

const P_DETUNE: i32 = 0;   // 0..1 -> cents spread 0..30 (each voice ±half)
const P_DELAY: i32 = 1;    // 0..1 -> tap delay 1..40 ms
const P_WIDTH: i32 = 2;    // 0..1 -> stereo spread (0 mono, 1 hard L/R)
const P_FEEDBACK: i32 = 3; // 0..1 -> subtle regen 0..0.85
const P_MIX: i32 = 4;      // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < DLEN; i++) { ring0[i] = 0.0; ring1[i] = 0.0; }
  wpos = 0;
  phase0 = 0.0; phase1 = 0.5;
  fb0 = 0.0; fb1 = 0.0;
  params[P_DETUNE] = 0.4;
  params[P_DELAY] = 0.3;
  params[P_WIDTH] = 0.8;
  params[P_FEEDBACK] = 0.15;
  params[P_MIX] = 0.5;
  sDetune = 0.4; sDelay = 0.3; sWidth = 0.8; sFb = 0.15; sMix = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// linear-interpolated read from a ring buffer at a fractional sample offset
// `back` (in samples) behind the write head.
@inline function readRing(ring: StaticArray<f32>, back: f32): f32 {
  let rp: f32 = f32(wpos) - back;
  while (rp < 0.0) rp += f32(DLEN);
  const i0: i32 = i32(rp) & DMASK;
  const i1: i32 = (i0 + 1) & DMASK;
  const frac: f32 = rp - Mathf.floor(rp);
  const a: f32 = ring[i0];
  const b: f32 = ring[i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const detuneT: f32 = clampf(params[P_DETUNE], 0.0, 1.0);
  const delayT: f32 = clampf(params[P_DELAY], 0.0, 1.0);
  const widthT: f32 = clampf(params[P_WIDTH], 0.0, 1.0);
  const fbT: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const mixT: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // base delay tap, 1..40 ms, in samples
  const baseDelay: f32 = (1.0 + delayT * 39.0) * sampleRate * 0.001;
  // grain window length in samples (fixed-ish, scaled to avoid reading past buffer)
  const winLen: f32 = sampleRate * 0.040; // 40 ms window
  // cents spread: 0..30 cents total; each voice gets half, opposite signs
  const cents: f32 = detuneT * 30.0;
  const ratioUp: f32 = f32(Mathf.pow(2.0, (cents * 0.5) / 1200.0));
  const ratioDn: f32 = f32(Mathf.pow(2.0, (-cents * 0.5) / 1200.0));
  // for a delay-line pitch shifter the read pointer must move at
  // (1 - ratio) relative to the write head; phase increment per sample:
  const inc0: f32 = (ratioDn - 1.0) / winLen; // voice 0 (down): ratio<1 -> negative
  const inc1: f32 = (ratioUp - 1.0) / winLen; // voice 1 (up):   ratio>1 -> positive

  // mono-fold input for the doubler (it widens a mono source)
  const smoothA: f32 = 0.002; // control slew per sample

  for (let f = 0; f < n; f++) {
    // smooth controls
    sDetune += smoothStep(sDetune, detuneT, smoothA);
    sDelay  += smoothStep(sDelay,  delayT,  smoothA);
    sWidth  += smoothStep(sWidth,  widthT,  smoothA);
    sFb     += smoothStep(sFb,     fbT,     smoothA);
    sMix    += smoothStep(sMix,    mixT,    smoothA);

    const inL: f32 = inBuf[f];
    const inR: f32 = channels > 1 ? inBuf[MAX_FRAMES + f] : inL;
    const mono: f32 = (inL + inR) * 0.5;

    const fbAmt: f32 = sFb * 0.85;

    // write input (+ feedback) into both rings at the shared write head
    ring0[wpos] = mono + fb0 * fbAmt;
    ring1[wpos] = mono + fb1 * fbAmt;

    // advance grain phases (wrap 0..1)
    phase0 += inc0; if (phase0 >= 1.0) phase0 -= 1.0; if (phase0 < 0.0) phase0 += 1.0;
    phase1 += inc1; if (phase1 >= 1.0) phase1 -= 1.0; if (phase1 < 0.0) phase1 += 1.0;

    // two overlapping read taps half a window apart, triangular crossfade
    const v0: f32 = grainRead(ring0, phase0, baseDelay, winLen);
    const v1: f32 = grainRead(ring1, phase1, baseDelay, winLen);

    fb0 = v0;
    fb1 = v1;

    // pan voices: width spreads them L/R. voice0 -> left, voice1 -> right
    const w: f32 = sWidth;
    // voice0 mostly left, voice1 mostly right; at width 0 both centred
    const v0L: f32 = v0 * (0.5 + 0.5 * w);
    const v0R: f32 = v0 * (0.5 - 0.5 * w);
    const v1L: f32 = v1 * (0.5 - 0.5 * w);
    const v1R: f32 = v1 * (0.5 + 0.5 * w);

    const wetL: f32 = (v0L + v1L);
    const wetR: f32 = (v0R + v1R);

    // equal-ish blend; wet scaled a touch so doubling doesn't blow level
    const dry: f32 = 1.0 - sMix;
    const wet: f32 = sMix;
    let oL: f32 = inL * dry + wetL * wet * 0.9;
    let oR: f32 = inR * dry + wetR * wet * 0.9;

    outBuf[f] = clampf(oL, -1.2, 1.2);
    if (channels > 1) outBuf[MAX_FRAMES + f] = clampf(oR, -1.2, 1.2);

    wpos = (wpos + 1) & DMASK;
  }
}

// one-pole-ish slew: returns the delta to add toward target
@inline function smoothStep(cur: f32, target: f32, a: f32): f32 {
  return (target - cur) * a;
}

// Read a pitch-shifted grain: two taps half a window apart, crossfaded by a
// triangular window so the pointer wrap never clicks. `phase` 0..1 drives the
// window position; `base` is the centre delay, `win` the window length.
@inline function grainRead(ring: StaticArray<f32>, phase: f32, base: f32, win: f32): f32 {
  // tap A at phase, tap B half a window out of phase
  const phB: f32 = phase >= 0.5 ? phase - 0.5 : phase + 0.5;
  const backA: f32 = base + phase * win;
  const backB: f32 = base + phB * win;
  // triangular gains: full at window centre, zero at the wrap edges
  const gA: f32 = 1.0 - Mathf.abs(2.0 * phase - 1.0);
  const gB: f32 = 1.0 - Mathf.abs(2.0 * phB - 1.0);
  const a: f32 = readRing(ring, backA);
  const b: f32 = readRing(ring, backB);
  return f32(a * gA + b * gB);
}
