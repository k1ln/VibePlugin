// =====================================================================
//  LUSH CHORUS — BBD-style stereo chorus
//  Short modulated delay lines read with linear interpolation, driven by
//  two LFOs in quadrature (L/R 90deg apart) for a wide stereo image. An
//  Intensity/Mode control sweeps the classic subtle -> wide voicing by
//  scaling both rate and depth. A gentle one-pole low-pass on the delayed
//  signal mimics the dark, smeared tone of a bucket-brigade line. The dry
//  path is summed for a thick, animated ensemble. Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

// Delay line: base ~1ms + up to ~7ms of sweep -> ~10ms headroom per channel.
// At 96kHz that is ~960 samples; round up generously.
const DLINE: i32 = 2048;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// per-channel modulated delay buffers
const delayL: StaticArray<f32> = new StaticArray<f32>(DLINE);
const delayR: StaticArray<f32> = new StaticArray<f32>(DLINE);
const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);

// per-channel BBD-style low-pass state on the wet read
const lpState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// LFO phases (radians), one master phase; channels read it 90deg apart
let lfoPhase: f32 = 0.0;

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const P_RATE: i32 = 0;      // 0..1 -> 0.05..6 Hz
const P_DEPTH: i32 = 1;     // 0..1 -> sweep amount
const P_INTENSITY: i32 = 2; // 0..1 -> subtle(I) .. wide(II); scales rate+depth+width
const P_MIX: i32 = 3;       // 0..1 dry/wet
const P_WIDTH: i32 = 4;     // 0..1 stereo spread of the two LFOs

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) { writePos[c] = 0; lpState[c] = 0.0; }
  for (let i = 0; i < DLINE; i++) { delayL[i] = 0.0; delayR[i] = 0.0; }
  lfoPhase = 0.0;
  params[P_RATE] = 0.35;
  params[P_DEPTH] = 0.5;
  params[P_INTENSITY] = 0.4;
  params[P_MIX] = 0.5;
  params[P_WIDTH] = 0.8;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// linearly interpolated read from a delay line, `delay` samples behind write
@inline function readDelay(buf: StaticArray<f32>, writeIdx: i32, delay: f32): f32 {
  let d: f32 = delay;
  if (d < 0.0) d = 0.0;
  const fd: f32 = f32(f32(writeIdx) - d);
  // wrap into [0, DLINE)
  let rp: f32 = fd;
  while (rp < 0.0) rp += f32(DLINE);
  const i0: i32 = i32(rp);
  const frac: f32 = f32(rp - f32(i0));
  let a: i32 = i0 % DLINE; if (a < 0) a += DLINE;
  let b: i32 = a + 1; if (b >= DLINE) b -= DLINE;
  return f32(buf[a] + (buf[b] - buf[a]) * frac);
}

export function process(n: i32): void {
  const rateN: f32 = clampf(params[P_RATE], 0.0, 1.0);
  const depthN: f32 = clampf(params[P_DEPTH], 0.0, 1.0);
  const inten: f32 = clampf(params[P_INTENSITY], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);
  const widthN: f32 = clampf(params[P_WIDTH], 0.0, 1.0);

  // Intensity sweeps the classic voicing: low = slow & shallow (mode I),
  // high = faster & deeper (mode II). It biases both rate and depth.
  const rateBase: f32 = f32(0.05 + rateN * 5.95);          // 0.05..6 Hz
  const rateHz: f32 = f32(rateBase * (0.6 + inten * 0.9)); // intensity speeds it up
  const lfoInc: f32 = f32(TWO_PI * rateHz / sampleRate);

  // delay in ms: base ~1.2ms, sweep up to ~6.5ms scaled by depth & intensity
  const baseMs: f32 = 1.2;
  const sweepMs: f32 = f32((1.0 + depthN * 5.5) * (0.5 + inten * 0.8));
  const baseSamp: f32 = f32(baseMs * 0.001 * sampleRate);
  const sweepSamp: f32 = f32(sweepMs * 0.001 * sampleRate);

  // stereo spread of the two channel LFOs (0 = mono, 1 = 90deg quadrature)
  const phaseOffset: f32 = f32(widthN * (PI * 0.5));

  // BBD low-pass coefficient (~6 kHz) — softens the wet path
  const lpHz: f32 = 6000.0;
  const lpC: f32 = f32(1.0 - Mathf.exp(f32(-TWO_PI * lpHz / sampleRate)));

  // equal-ish wet/dry gain; keep peaks well under 1.0 on broadband beds
  const dryG: f32 = f32(1.0 - mix * 0.5);
  const wetG: f32 = f32(mix * 0.9);

  let ph: f32 = lfoPhase;

  for (let f = 0; f < n; f++) {
    // advance master phase
    ph += lfoInc;
    if (ph >= TWO_PI) ph -= TWO_PI;

    // per-channel LFO values in quadrature
    const lfoL: f32 = f32(Mathf.sin(ph));
    const lfoR: f32 = f32(Mathf.sin(f32(ph + phaseOffset)));

    // ----- LEFT (channel 0) -----
    {
      const xL: f32 = inBuf[0 * MAX_FRAMES + f];
      let wp: i32 = writePos[0];
      delayL[wp] = xL;
      const delSampL: f32 = f32(baseSamp + sweepSamp * 0.5 * (1.0 + lfoL));
      let wetL: f32 = readDelay(delayL, wp, delSampL);
      // BBD low-pass smear
      let s: f32 = lpState[0];
      s = f32(s + lpC * (wetL - s));
      lpState[0] = s;
      wetL = s;
      outBuf[0 * MAX_FRAMES + f] = f32(xL * dryG + wetL * wetG);
      wp++; if (wp >= DLINE) wp -= DLINE;
      writePos[0] = wp;
    }

    // ----- RIGHT (channel 1) -----
    if (channels > 1) {
      const xR: f32 = inBuf[1 * MAX_FRAMES + f];
      let wp: i32 = writePos[1];
      delayR[wp] = xR;
      const delSampR: f32 = f32(baseSamp + sweepSamp * 0.5 * (1.0 + lfoR));
      let wetR: f32 = readDelay(delayR, wp, delSampR);
      let s: f32 = lpState[1];
      s = f32(s + lpC * (wetR - s));
      lpState[1] = s;
      wetR = s;
      outBuf[1 * MAX_FRAMES + f] = f32(xR * dryG + wetR * wetG);
      wp++; if (wp >= DLINE) wp -= DLINE;
      writePos[1] = wp;
    }
  }

  lfoPhase = ph;
}
