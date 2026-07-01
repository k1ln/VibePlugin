// =====================================================================
//  RACK ECHO — clean 80s studio rack digital delay with a DOUBLER mode
//  (SDE-3000 lineage, original algorithm).
//
//  A pristine, hi-fi delay line: no tape grit, no companding, no hold —
//  just crisp digital repeats. A gentle stereo LFO modulates the read
//  position so a single repeat can be fattened into a wide chorused
//  DOUBLE / slapback (the Modulation control). The feedback path runs
//  through a one-pole low-pass (Tone) so successive repeats roll off
//  their high end, like the classic rack converters. Mix at 0 is dry.
//
//  Signal flow:
//    in ─► [delay line]
//             read at (delayTime + modL/R)  ──► wet tap (interp)
//             feedback = LP(tone) of read   ──► write back into line
//    out = dry*(1-mix) + wet*mix
//
//  Pure algorithm, no samples, no imports. All f32.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

// Delay line capacity per channel: ~1.2 s at 48k is plenty for a rack delay.
const DELAY_LEN: i32 = 65536; // power of two, ~1.36 s @ 48k

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// one delay line per channel (planar, stride DELAY_LEN)
const line: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const fbState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // feedback LP memory
const lfoPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // per-channel LFO phase
let smoothTime: f32 = 0.25; // smoothed delay time in seconds (avoids zipper/pitch jumps)

const PI2: f32 = 6.2831853;

const P_TIME: i32 = 0; // 0..1 -> 20ms .. 1000ms
const P_FB:   i32 = 1; // 0..1 -> 0 .. 0.92 feedback
const P_MOD:  i32 = 2; // 0..1 -> doubler/chorus depth on the repeats
const P_TONE: i32 = 3; // 0..1 -> repeat HF (feedback LP) 1.2k .. 16k
const P_MIX:  i32 = 4; // 0..1 -> dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    writePos[c] = 0;
    fbState[c] = 0.0;
    lfoPhase[c] = c == 0 ? 0.0 : 0.25; // quarter-cycle offset → stereo width
  }
  for (let i = 0; i < DELAY_LEN * MAX_CHANNELS; i++) line[i] = 0.0;
  smoothTime = 0.25;
  params[P_TIME] = 0.35;
  params[P_FB]   = 0.35;
  params[P_MOD]  = 0.30;
  params[P_TONE] = 0.65;
  params[P_MIX]  = 0.40;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// linear-interpolated read from a channel's delay line at a fractional
// delay (in samples) behind the write head.
@inline function readLine(base: i32, wp: i32, delaySamp: f32): f32 {
  let d: f32 = delaySamp;
  if (d < 1.0) d = 1.0;
  const maxD: f32 = f32(DELAY_LEN - 2);
  if (d > maxD) d = maxD;
  const id: i32 = i32(d);
  const frac: f32 = d - f32(id);
  let r0: i32 = wp - id;
  while (r0 < 0) r0 += DELAY_LEN;
  let r1: i32 = r0 - 1;
  if (r1 < 0) r1 += DELAY_LEN;
  const a: f32 = line[base + r0];
  const b: f32 = line[base + r1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fb:    f32 = clampf(params[P_FB],   0.0, 1.0) * 0.92;
  const modN:  f32 = clampf(params[P_MOD],  0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix:   f32 = clampf(params[P_MIX],  0.0, 1.0);

  // delay time 20ms..1000ms, perceptually scaled
  const targetTime: f32 = 0.020 + timeN * timeN * 0.980;

  // feedback-path low-pass corner: 1.2k (dark) .. 16k (pristine)
  const toneHz: f32 = 1200.0 + toneN * toneN * 14800.0;
  const cTone: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * toneHz / sampleRate)), 0.0, 1.0);

  // LFO: ~0.45 Hz chorus/doubler wobble; depth up to ~7ms = lush double
  const lfoInc: f32 = f32(0.45 / sampleRate);
  const modDepthSamp: f32 = modN * modN * 0.007 * sampleRate; // seconds → samples
  // a fixed short doubler offset so Modulation widens a single repeat into
  // a slapback-thick double even at low feedback
  const doubleOffSamp: f32 = modN * 0.004 * sampleRate;

  // per-block delay-time smoothing coefficient
  const tSmooth: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * 6.0 / sampleRate)), 0.0, 1.0);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * DELAY_LEN;
    let wp: i32 = writePos[c];
    let fbz: f32 = fbState[c];
    let ph: f32 = lfoPhase[c];
    let st: f32 = smoothTime;

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[c * MAX_FRAMES + f];

      // smooth the base delay time toward target
      st += tSmooth * (targetTime - st);

      // LFO value (sine), per-channel phase for stereo doubler width
      ph += lfoInc;
      if (ph >= 1.0) ph -= 1.0;
      const lfo: f32 = Mathf.sin(ph * PI2);

      // primary read position (samples) with modulation + doubler offset
      const baseSamp: f32 = st * sampleRate;
      const modSamp: f32 = lfo * modDepthSamp + doubleOffSamp;
      const readSamp: f32 = baseSamp + modSamp;

      const wet: f32 = readLine(base, wp, readSamp);

      // feedback through tone low-pass (darkens successive repeats)
      fbz += cTone * (wet - fbz);
      let into: f32 = x + fbz * fb;
      // safety clamp so the feedback loop can never blow up
      into = clampf(into, -1.2, 1.2);

      line[base + wp] = into;
      wp++;
      if (wp >= DELAY_LEN) wp -= DELAY_LEN;

      const y: f32 = x * (1.0 - mix) + wet * mix;
      outBuf[c * MAX_FRAMES + f] = clampf(y, -1.0, 1.0);
    }

    writePos[c] = wp;
    fbState[c] = fbz;
    lfoPhase[c] = ph;
    if (c == channels - 1) smoothTime = st; // commit smoothed time once per block
  }
}
