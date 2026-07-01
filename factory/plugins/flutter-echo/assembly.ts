// =====================================================================
//  FLUTTER ECHO — a physically-modelled tape delay foregrounding the
//  WOW & FLUTTER of an unstable tape transport. A delay line whose read
//  head is modulated by a slow WOW LFO plus a faster FLUTTER LFO (with a
//  little drift), so every repeat is pitch-warbled. Each pass through the
//  loop adds tape saturation and high-frequency loss, so echoes degrade
//  and darken as they stack. The Warble control scales the modulation
//  from subtle vintage warmth to seasick, sea-sick wobble.
//
//  Params: Time, Feedback, Warble (wow+flutter depth), Tone (HF loss), Mix.
//  Pure algorithm, no samples. All math in f32.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

// delay line: ~1.2 s per channel at 48k gives plenty of range
const DELAY_LEN: i32 = 65536; // power of two, ~1.36 s @ 48k

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// one delay line per channel (flattened: channel c at c * DELAY_LEN)
const delay: StaticArray<f32> = new StaticArray<f32>(DELAY_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let writePos: i32 = 0;            // shared write head (advances per frame)

// per-channel feedback-loop HF-loss state (tape darkens repeats)
const loopLP: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// wow / flutter LFO phases (shared transport, slight stereo offset)
let wowPhase: f32 = 0.0;
let flutPhase: f32 = 0.0;
let driftPhase: f32 = 0.0;

// smoothed target delay (samples) so Time changes glide like a real motor
let curDelaySamp: f32 = 12000.0;

const P_TIME: i32 = 0;     // 0..1 -> 40..900 ms
const P_FEEDBACK: i32 = 1; // 0..1 -> 0..0.95
const P_WARBLE: i32 = 2;   // 0..1 -> wow+flutter depth
const P_TONE: i32 = 3;     // 0..1 -> loop HF loss (dark..bright)
const P_MIX: i32 = 4;      // 0..1 dry/wet

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < DELAY_LEN * MAX_CHANNELS; i++) delay[i] = 0.0;
  for (let c = 0; c < MAX_CHANNELS; c++) loopLP[c] = 0.0;
  writePos = 0;
  wowPhase = 0.0;
  flutPhase = 0.0;
  driftPhase = 0.0;
  curDelaySamp = 0.30 * sampleRate;
  params[P_TIME] = 0.45;
  params[P_FEEDBACK] = 0.5;
  params[P_WARBLE] = 0.4;
  params[P_TONE] = 0.55;
  params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// soft tape-style saturation (odd-symmetric, gentle compression)
@inline function tapeSat(x: f32): f32 {
  // tanh-like with cheap rational approximation, bounded to ~±1
  const c: f32 = clampf(x, -3.0, 3.0);
  return f32(c * (27.0 + c * c) / (27.0 + 9.0 * c * c));
}

// read the delay line for channel `c` at a fractional position `back`
// samples behind the write head, with linear interpolation
@inline function readDelay(c: i32, back: f32): f32 {
  let rp: f32 = f32(writePos) - back;
  // wrap into [0, DELAY_LEN)
  while (rp < 0.0) rp += f32(DELAY_LEN);
  while (rp >= f32(DELAY_LEN)) rp -= f32(DELAY_LEN);
  const i0: i32 = i32(rp);
  let i1: i32 = i0 + 1;
  if (i1 >= DELAY_LEN) i1 -= DELAY_LEN;
  const frac: f32 = rp - f32(i0);
  const base: i32 = c * DELAY_LEN;
  const a: f32 = delay[base + i0];
  const b: f32 = delay[base + i1];
  return f32(a + (b - a) * frac);
}

export function process(n: i32): void {
  const timeN: f32 = clampf(params[P_TIME], 0.0, 1.0);
  const fbN: f32 = clampf(params[P_FEEDBACK], 0.0, 1.0);
  const warbleN: f32 = clampf(params[P_WARBLE], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // target delay 40..900 ms
  const timeMs: f32 = 40.0 + timeN * 860.0;
  const targetSamp: f32 = clampf(timeMs * 0.001 * sampleRate, 8.0, f32(DELAY_LEN - 4));

  // feedback up to 0.95 (bounded — never self-oscillate to clipping)
  const feedback: f32 = fbN * 0.95;

  // loop HF loss: Tone bright -> higher cutoff (less loss per repeat)
  const toneHz: f32 = 1200.0 + toneN * toneN * 8000.0;
  const cTone: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * toneHz / sampleRate)), 0.0, 1.0);

  // wow: slow ~0.45 Hz, large excursion. flutter: ~7 Hz, small but fast.
  // depths in SAMPLES, scaled by Warble (squared for a gentle low end).
  const w2: f32 = warbleN * warbleN;
  const wowHz: f32 = 0.45;
  const flutHz: f32 = 6.7;
  const driftHz: f32 = 0.11;
  // excursions grow with both Warble and the delay length (longer tape = more wow)
  const wowDepth: f32 = w2 * (0.012 * targetSamp + 6.0);   // up to ~1.2% of delay
  const flutDepth: f32 = w2 * (0.0016 * targetSamp + 3.0); // fast jitter
  const wowInc: f32 = PI2 * wowHz / sampleRate;
  const flutInc: f32 = PI2 * flutHz / sampleRate;
  const driftInc: f32 = PI2 * driftHz / sampleRate;

  // glide coefficient for the motor (Time moves smoothly, not instantly)
  const glide: f32 = clampf(80.0 / sampleRate, 0.0, 1.0);

  // input drive into the tape (a touch of pre-gain for saturation character)
  const inGain: f32 = 0.9;

  // We advance the LFOs and write head once per FRAME (shared across channels),
  // so process channels in an interleaved-by-frame manner.
  let wPhase: f32 = wowPhase;
  let fPhase: f32 = flutPhase;
  let dPhase: f32 = driftPhase;
  let dSamp: f32 = curDelaySamp;
  let wpos: i32 = writePos;

  const ch: i32 = channels;

  for (let f = 0; f < n; f++) {
    // glide the base delay toward target (motor inertia)
    dSamp += glide * (targetSamp - dSamp);

    // composite warble modulation (samples). Stereo handled per-channel via offset.
    const wow: f32 = Mathf.sin(wPhase);
    const drift: f32 = Mathf.sin(dPhase);
    const flut: f32 = Mathf.sin(fPhase) + 0.4 * Mathf.sin(fPhase * 2.3);
    // base modulation shared; per-channel adds a phase offset for stereo width
    const modBase: f32 = wowDepth * (wow + 0.25 * drift) + flutDepth * flut;

    for (let c = 0; c < ch; c++) {
      // slight stereo decorrelation of the warble (right lags)
      const chOff: f32 = c == 0 ? 0.0 : 0.6;
      const wowC: f32 = Mathf.sin(wPhase + chOff);
      const flutC: f32 = Mathf.sin(fPhase + chOff * 1.7);
      const mod: f32 = c == 0
        ? modBase
        : wowDepth * (wowC + 0.25 * drift) + flutDepth * flutC;

      const back: f32 = clampf(dSamp + mod, 4.0, f32(DELAY_LEN - 4));

      const x: f32 = inBuf[c * MAX_FRAMES + f] * inGain;
      let echo: f32 = readDelay(c, back);

      // tape HF loss inside the loop (darken each repeat)
      let lp: f32 = loopLP[c];
      lp = lp + cTone * (echo - lp);
      loopLP[c] = lp;
      echo = lp;

      // what we record back to tape: input + saturated feedback of the echo
      const recorded: f32 = tapeSat(x + echo * feedback);

      const base: i32 = c * DELAY_LEN;
      delay[base + wpos] = recorded;

      // wet = the (already-filtered) echo, dry = input/inGain
      const dry: f32 = inBuf[c * MAX_FRAMES + f];
      const wet: f32 = echo;
      let outv: f32 = dry * (1.0 - mix) + wet * mix;
      outBuf[c * MAX_FRAMES + f] = clampf(outv, -1.2, 1.2);
    }

    // advance shared transport state once per frame
    wpos++;
    if (wpos >= DELAY_LEN) wpos -= DELAY_LEN;
    wPhase += wowInc; if (wPhase >= PI2) wPhase -= PI2;
    fPhase += flutInc; if (fPhase >= PI2) fPhase -= PI2;
    dPhase += driftInc; if (dPhase >= PI2) dPhase -= PI2;
  }

  writePos = wpos;
  wowPhase = wPhase;
  flutPhase = fPhase;
  driftPhase = dPhase;
  curDelaySamp = dSamp;
}
