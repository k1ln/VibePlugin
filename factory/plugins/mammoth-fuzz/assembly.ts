// =====================================================================
//  MAMMOTH FUZZ — thick, sustaining fuzz
//  Two cascaded soft-clipping gain stages with an inter-stage high-pass
//  filter (the classic four-transistor sustaining-fuzz topology). The
//  Sustain control drives both stages hard for long, singing sustain and
//  rich harmonics; a mid-scooped Tone control tilts the voice between a
//  bassy/dark and a bright/cutting setting. Output level and dry/wet Mix
//  finish the chain. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel filter state
const inHpState:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // input HP (LP for subtraction)
const mid1State:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // inter-stage HP after stage 1
const mid2State:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // inter-stage HP after stage 2
const dcState:      StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post DC-block (LP)
const toneLowState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tone low-pass branch
const toneHiState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tone high-pass branch (LP for subtraction)

const P_SUSTAIN: i32 = 0; // 0..1 -> input gain into the two stages
const P_TONE: i32 = 1;    // 0..1 -> scooped: 0 = bassy/dark, 1 = bright/trebly
const P_VOLUME: i32 = 2;  // 0..1 -> 0..1.2 output level
const P_MIX: i32 = 3;     // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    inHpState[c] = 0.0; mid1State[c] = 0.0; mid2State[c] = 0.0;
    dcState[c] = 0.0; toneLowState[c] = 0.0; toneHiState[c] = 0.0;
  }
  params[P_SUSTAIN] = 0.7; params[P_TONE] = 0.5; params[P_VOLUME] = 0.6; params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// one-pole low-pass coefficient for a given corner (Hz)
@inline function lpCoef(hz: f32, sr: f32): f32 {
  return f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * hz / sr));
}

// asymmetric soft clip — like a clamped diode pair, saturates smoothly to ~±1.
// A touch of asymmetry adds even harmonics for a thicker, more vocal fuzz.
@inline function fuzzClip(x: f32): f32 {
  const c: f32 = clampf(x, -1.3, 1.3);
  // tanh-style via rational approx, stays in f32 and is cheap
  const y: f32 = f32(c / (1.0 + 0.28 * c * c));
  // small even-harmonic bias
  return f32(y + 0.06 * y * y);
}

export function process(n: i32): void {
  const sus: f32 = clampf(params[P_SUSTAIN], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const volume: f32 = clampf(params[P_VOLUME], 0.0, 1.0) * 1.2;
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Input gain into stage 1: musical 2..120x. High end gives sustain & buzz.
  const drive1: f32 = 2.0 + sus * sus * 118.0;
  // Stage 2 adds further squashing; scales gently with sustain.
  const drive2: f32 = 3.0 + sus * 9.0;

  // Filters
  const cIn: f32 = lpCoef(80.0, sampleRate);    // input HP corner ~80 Hz (tighten before clip)
  const cMid1: f32 = lpCoef(180.0, sampleRate); // inter-stage HP ~180 Hz
  const cMid2: f32 = lpCoef(150.0, sampleRate); // second inter-stage HP ~150 Hz
  const cDc: f32 = lpCoef(20.0, sampleRate);    // DC block

  // Tone: scooped tilt. Low branch = LP at ~700 Hz, high branch = HP at ~1.5 kHz.
  // toneN tilts the blend; the centre is scooped (both branches reduced).
  const cToneLow: f32 = lpCoef(700.0, sampleRate);
  const cToneHi: f32 = lpCoef(1500.0, sampleRate);
  const lowGain: f32 = f32(1.0 - toneN) * 1.0;      // more low when toneN small
  const hiGain: f32 = toneN * 1.0;                   // more high when toneN large
  // scoop: subtract a little of the mid so the centre dips
  const midScoop: f32 = 0.65;

  // gain compensation so Sustain doesn't just get louder
  const comp: f32 = f32(1.0 / Mathf.sqrt(drive1 * 0.5 + 1.0));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let inLp: f32 = inHpState[c];
    let m1: f32 = mid1State[c];
    let m2: f32 = mid2State[c];
    let dc: f32 = dcState[c];
    let tl: f32 = toneLowState[c];
    let th: f32 = toneHiState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // input high-pass (tighten lows before first stage)
      inLp = inLp + cIn * (x - inLp);
      const hpIn: f32 = x - inLp;

      // STAGE 1: drive + soft clip
      const s1: f32 = fuzzClip(hpIn * drive1);

      // inter-stage high-pass 1
      m1 = m1 + cMid1 * (s1 - m1);
      const hp1: f32 = s1 - m1;

      // STAGE 2: drive + soft clip
      const s2: f32 = fuzzClip(hp1 * drive2);

      // inter-stage high-pass 2
      m2 = m2 + cMid2 * (s2 - m2);
      const hp2: f32 = s2 - m2;

      // DC block
      dc = dc + cDc * (hp2 - dc);
      const clean: f32 = (hp2 - dc) * comp;

      // TONE: scooped tilt between low and high branches
      tl = tl + cToneLow * (clean - tl);     // low-passed (bassy) content
      th = th + cToneHi * (clean - th);
      const highContent: f32 = clean - th;   // high-passed (trebly) content
      const lowContent: f32 = tl;
      const midContent: f32 = th - tl;       // band between corners (the "mid")
      const toned: f32 = lowContent * lowGain + highContent * hiGain - midContent * midScoop;

      const wet: f32 = toned * volume * 5.5;
      const outv: f32 = x * (1.0 - mix) + wet * mix;
      outBuf[base + f] = clampf(outv, -1.2, 1.2);
    }

    inHpState[c] = inLp;
    mid1State[c] = m1;
    mid2State[c] = m2;
    dcState[c] = dc;
    toneLowState[c] = tl;
    toneHiState[c] = th;
  }
}
