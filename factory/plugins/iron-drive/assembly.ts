// =====================================================================
//  IRON DRIVE — transformer / iron-core saturation
//  Models the warm nonlinearity of an audio output transformer: the
//  iron core saturates earliest in the LOW frequencies (so a tunable
//  low-end emphasis is summed back into the drive stage), a hysteresis-
//  flavoured soft saturator adds asymmetric even + odd harmonics, a gentle
//  high-frequency rounding tames fizz, and a post Tone tilt + dry/wet Mix
//  and Output level finish it. Pure algorithm, no samples.
//
//  Params:
//    0 Drive   0..1  -> input gain into the iron 1..18x
//    1 Low     0..1  -> low-frequency iron push (extra LF into saturator)
//    2 Tone    0..1  -> post tilt: dark<->bright HF rounding 1.2..8 kHz
//    3 Mix     0..1  -> dry/wet
//    4 Output  0..1  -> output trim 0..1.4
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
const lfState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // LF extractor for iron push
const hfState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-sat HF rounding
const toneState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post tone LP
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker (asymmetry adds DC)
const dcPrev:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker prev input
const hysState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // hysteresis memory

const P_DRIVE:  i32 = 0;
const P_LOW:    i32 = 1;
const P_TONE:   i32 = 2;
const P_MIX:    i32 = 3;
const P_OUTPUT: i32 = 4;

const PI2: f32 = 6.2831853;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    lfState[c] = 0.0; hfState[c] = 0.0; toneState[c] = 0.0;
    dcState[c] = 0.0; dcPrev[c] = 0.0; hysState[c] = 0.0;
  }
  params[P_DRIVE] = 0.45;
  params[P_LOW]   = 0.5;
  params[P_TONE]  = 0.5;
  params[P_MIX]   = 1.0;
  params[P_OUTPUT] = 0.55;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// Transformer iron saturation: asymmetric soft clip giving strong odd
// harmonics with a touch of even (the bias offset). tanh-style via a
// fast rational approximation, then a small squared even-harmonic term.
@inline function ironSat(x: f32): f32 {
  const xc: f32 = clampf(x, -3.0, 3.0);
  // odd-harmonic soft saturation (rational tanh approx, smooth, bounded ±1)
  const x2: f32 = xc * xc;
  const odd: f32 = xc * (27.0 + x2) / (27.0 + 9.0 * x2);
  // gentle even-harmonic asymmetry (iron core bias) — bounded
  const even: f32 = 0.12 * (odd * odd - 0.5);
  return f32(odd + even);
}

export function process(n: i32): void {
  const driveN: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  const lowN:   f32 = clampf(params[P_LOW],   0.0, 1.0);
  const toneN:  f32 = clampf(params[P_TONE],  0.0, 1.0);
  const mix:    f32 = clampf(params[P_MIX],   0.0, 1.0);
  const outN:   f32 = clampf(params[P_OUTPUT], 0.0, 1.0);

  // input gain into the iron
  const drive: f32 = 1.0 + driveN * 17.0;
  // extra low-frequency drive (transformers saturate first in the lows)
  const lowPush: f32 = 0.4 + lowN * 2.2;
  const outLevel: f32 = outN * 1.4;

  // LF extractor ~150 Hz (the band we push into the core)
  const cLf: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * 150.0 / sampleRate)), 0.0, 1.0);
  // pre-sat HF rounding ~7 kHz (iron rolls off the extreme top before clipping)
  const cHfPre: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * 7000.0 / sampleRate)), 0.0, 1.0);
  // post tone low-pass 1.2..8 kHz (dark <-> bright)
  const toneHz: f32 = 1200.0 + toneN * toneN * 6800.0;
  const cTone: f32 = clampf(f32(1.0 - Mathf.exp(-PI2 * toneHz / sampleRate)), 0.0, 1.0);
  // DC blocker coeff
  const rDc: f32 = clampf(f32(1.0 - PI2 * 12.0 / sampleRate), 0.9, 0.99999);
  // gain compensation so Drive doesn't simply get louder
  const comp: f32 = f32(1.6 / Mathf.sqrt(drive));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let lf: f32 = lfState[c];
    let hf: f32 = hfState[c];
    let tn: f32 = toneState[c];
    let dz: f32 = dcState[c];
    let dp: f32 = dcPrev[c];
    let hy: f32 = hysState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // pre-sat HF rounding (one-pole LP — rounds the very top before the iron)
      hf = hf + cHfPre * (x - hf);
      const rounded: f32 = hf;

      // low-frequency component, emphasised and fed back into the drive
      lf = lf + cLf * (rounded - lf);
      const pushed: f32 = rounded + lf * (lowPush - 1.0);

      // hysteresis: the core's magnetisation lags the signal slightly,
      // which spreads the transfer curve and warms transients
      hy = hy + 0.35 * (pushed - hy);
      const drivenIn: f32 = (pushed * 0.7 + hy * 0.3) * drive;

      // iron-core saturation
      let sat: f32 = ironSat(drivenIn) * comp;

      // DC blocker (asymmetry introduces DC) — high-pass at ~12 Hz
      const dcOut: f32 = sat - dp + rDc * dz;
      dp = sat;
      dz = dcOut;
      sat = dcOut;

      // post tone low-pass (HF rounding / brightness)
      tn = tn + cTone * (sat - tn);

      const wet: f32 = clampf(tn * outLevel, -1.5, 1.5);
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }

    lfState[c] = lf;
    hfState[c] = hf;
    toneState[c] = tn;
    dcState[c] = dz;
    dcPrev[c] = dp;
    hysState[c] = hy;
  }
}
