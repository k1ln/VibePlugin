// =====================================================================
//  REEL SATURATOR — tape-style saturation / warmth processor
//  Drive feeds a tanh-style soft saturation (2x oversampled to tame
//  aliasing), wrapped by a low-frequency head-bump resonance and a
//  gentle high-frequency rolloff (Warmth). A very subtle wow modulates
//  a fractional delay for tape motion. Adds even/odd harmonics plus a
//  touch of program-dependent compression. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel state
const warmState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // HF rolloff one-pole LP
const dcState:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker LP
const dcPrev:     StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker prev input
const bumpLP:     StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // low band extractor
const bumpZ:      StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // resonator state z1
const bumpZ2:     StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // resonator state z2
const envState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // compression envelope
const upPrev:     StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // 2x upsample interp prev

// wow delay line (short, fractional). ~30 ms max at 96k => 2880 samples; use 4096.
const WOW_LEN: i32 = 4096;
const wowBuf:  StaticArray<f32> = new StaticArray<f32>(WOW_LEN * MAX_CHANNELS);
const wowPos:  StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
let wowPhase: f32 = 0.0;   // shared LFO phase (mono modulation keeps stereo coherent)

const P_DRIVE:  i32 = 0;  // 0..1 -> input gain into saturator
const P_WARMTH: i32 = 1;  // 0..1 -> HF rolloff amount (more = darker)
const P_BUMP:   i32 = 2;  // 0..1 -> low head-bump amount
const P_MIX:    i32 = 3;  // 0..1 dry/wet
const P_OUTPUT: i32 = 4;  // 0..1 -> output trim 0..1.5

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    warmState[c] = 0.0; dcState[c] = 0.0; dcPrev[c] = 0.0;
    bumpLP[c] = 0.0; bumpZ[c] = 0.0; bumpZ2[c] = 0.0;
    envState[c] = 0.0; upPrev[c] = 0.0; wowPos[c] = 0;
  }
  for (let i = 0; i < WOW_LEN * MAX_CHANNELS; i++) wowBuf[i] = 0.0;
  wowPhase = 0.0;
  params[P_DRIVE] = 0.45; params[P_WARMTH] = 0.4; params[P_BUMP] = 0.35;
  params[P_MIX] = 1.0; params[P_OUTPUT] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// tanh-style soft saturation, slightly asymmetric for even harmonics (tape bias)
@inline function tapeSat(x: f32): f32 {
  // mild asymmetry: bias shifts the curve so even harmonics appear
  const b: f32 = x + 0.06;
  const t: f32 = f32(Mathf.tanh(b)) - f32(Mathf.tanh(0.06)); // remove DC offset of bias
  return t;
}

export function process(n: i32): void {
  const driveN:  f32 = clampf(params[P_DRIVE],  0.0, 1.0);
  const warmthN: f32 = clampf(params[P_WARMTH], 0.0, 1.0);
  const bumpN:   f32 = clampf(params[P_BUMP],   0.0, 1.0);
  const mix:     f32 = clampf(params[P_MIX],    0.0, 1.0);
  const outTrim: f32 = clampf(params[P_OUTPUT], 0.0, 1.0) * 1.25;

  // Drive: 1x .. ~12x into the saturator
  const drive: f32 = 1.0 + driveN * 11.0;
  // makeup so harder drive doesn't merely get louder; tanh limits to ~1
  const comp: f32 = 1.0 / (1.0 + driveN * 1.1);

  // Warmth: HF rolloff corner sweeps 18kHz (open) down to ~2.2kHz (dark)
  const nyq: f32 = sampleRate * 0.5;
  let warmHz: f32 = 18000.0 - warmthN * 15800.0;
  if (warmHz > nyq * 0.9) warmHz = nyq * 0.9;
  if (warmHz < 500.0) warmHz = 500.0;
  const warmCoef: f32 = f32(1.0 - Mathf.exp(-TWO_PI * warmHz / sampleRate));

  // Bump: a gentle resonant low boost around ~90 Hz (tape head bump)
  const bumpHz: f32 = 90.0;
  const w0: f32 = TWO_PI * bumpHz / sampleRate;
  const cosw: f32 = f32(Mathf.cos(w0));
  const sinw: f32 = f32(Mathf.sin(w0));
  // low-band extractor (one-pole LP) to feed the resonator
  const lowHz: f32 = 220.0;
  const lowCoef: f32 = f32(1.0 - Mathf.exp(-TWO_PI * lowHz / sampleRate));
  const bumpAmt: f32 = bumpN * 1.6; // gain of the added low band

  // simple resonant bandpass (biquad) coeffs for the bump, modest Q
  const Q: f32 = 0.8;
  const alpha: f32 = sinw / (2.0 * Q);
  const b0: f32 = alpha;
  const b2: f32 = -alpha;
  const a0: f32 = 1.0 + alpha;
  const a1: f32 = -2.0 * cosw;
  const a2: f32 = 1.0 - alpha;
  const inv_a0: f32 = a0 != 0.0 ? 1.0 / a0 : 1.0;
  const rb0: f32 = b0 * inv_a0;
  const rb2: f32 = b2 * inv_a0;
  const ra1: f32 = a1 * inv_a0;
  const ra2: f32 = a2 * inv_a0;

  // DC blocker coef
  const dcR: f32 = 0.9985;

  // Wow modulation: ~0.7 Hz, small depth in samples; base delay keeps headroom
  const wowRate: f32 = 0.7;
  const wowInc: f32 = TWO_PI * wowRate / sampleRate;
  const baseDelay: f32 = 0.004 * sampleRate;   // ~4 ms nominal
  const wowDepth: f32 = 0.0018 * sampleRate;   // ~1.8 ms swing -> subtle wow

  // compression: gentle program-dependent gain reduction after saturation
  const envAtk: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.005 * sampleRate)));
  const envRel: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.120 * sampleRate)));

  // oversample-up coefficient (half-band-ish one-pole smoother on upsampled stream)
  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    const wbase: i32 = c * WOW_LEN;

    let warm: f32 = warmState[c];
    let dcL: f32 = dcState[c];
    let dcP: f32 = dcPrev[c];
    let lpL: f32 = bumpLP[c];
    let z1: f32 = bumpZ[c];
    let z2: f32 = bumpZ2[c];
    let env: f32 = envState[c];
    let up: f32 = upPrev[c];
    let wp: i32 = wowPos[c];
    let phase: f32 = wowPhase; // local copy; channel 0 commits, others read same start

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // ---- input gain into saturator ----
      const driven: f32 = x * drive;

      // ---- 2x oversampled tape saturation ----
      // sample A: midpoint between previous and current input (linear interp)
      const mid: f32 = 0.5 * (up + driven);
      const sA: f32 = tapeSat(mid);
      const sB: f32 = tapeSat(driven);
      up = driven;
      // decimate: average the two half-rate samples (acts as a cheap LP)
      let sat: f32 = 0.5 * (sA + sB) * comp;

      // ---- DC blocker (tape bias asymmetry leaves a small DC term) ----
      const dcOut: f32 = sat - dcP + dcR * dcL;
      dcP = sat;
      dcL = dcOut;
      sat = dcOut;

      // ---- high-frequency rolloff (warmth) ----
      warm = warm + warmCoef * (sat - warm);
      let shaped: f32 = warm;

      // ---- low head-bump ----
      // extract a low band, run through resonant BP, add back
      lpL = lpL + lowCoef * (shaped - lpL);
      // resonant bandpass on the low band, transposed direct form II
      // coeffs: rb0, rb1(=0), rb2, ra1, ra2  (a0 normalised)
      const bpOut: f32 = rb0 * lpL + z1;
      z1 = -ra1 * bpOut + z2;        // rb1 == 0
      z2 = rb2 * lpL - ra2 * bpOut;
      shaped = shaped + bumpAmt * bpOut;

      // ---- gentle compression (after harmonics) ----
      const rect: f32 = shaped < 0.0 ? -shaped : shaped;
      const coef: f32 = rect > env ? envAtk : envRel;
      env = env + coef * (rect - env);
      // soft-knee gain reduction above ~0.5
      let gr: f32 = 1.0;
      if (env > 0.5) {
        const over: f32 = env - 0.5;
        gr = 1.0 / (1.0 + over * 0.6); // mild ratio
      }
      shaped = shaped * gr;

      // ---- wow: write to delay, read fractional modulated tap ----
      wowBuf[wbase + wp] = shaped;
      const lfo: f32 = f32(Mathf.sin(phase));
      let dly: f32 = baseDelay + lfo * wowDepth;
      if (dly < 1.0) dly = 1.0;
      if (dly > f32(WOW_LEN - 2)) dly = f32(WOW_LEN - 2);
      let rPos: f32 = f32(wp) - dly;
      while (rPos < 0.0) rPos += f32(WOW_LEN);
      const i0: i32 = i32(rPos);
      const frac: f32 = rPos - f32(i0);
      let i1: i32 = i0 + 1;
      if (i1 >= WOW_LEN) i1 -= WOW_LEN;
      const wowOut: f32 = wowBuf[wbase + i0] * (1.0 - frac) + wowBuf[wbase + i1] * frac;

      wp++;
      if (wp >= WOW_LEN) wp = 0;
      phase += wowInc;
      if (phase >= TWO_PI) phase -= TWO_PI;

      // final safety soft-limiter keeps peaks bounded even fully cranked
      const lim: f32 = f32(Mathf.tanh(wowOut * 0.85)) * 1.12;
      const wet: f32 = lim * outTrim;
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }

    warmState[c] = warm;
    dcState[c] = dcL;
    dcPrev[c] = dcP;
    bumpLP[c] = lpL;
    bumpZ[c] = z1;
    bumpZ2[c] = z2;
    envState[c] = env;
    upPrev[c] = up;
    wowPos[c] = wp;
    // advance shared phase from channel 0's run so both channels stay coherent
    if (c == 0) wowPhase = phase;
  }
}
