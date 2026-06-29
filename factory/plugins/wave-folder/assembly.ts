// =====================================================================
//  WAVE FOLDER — west-coast style waveshaping wavefolder
//  Drives the signal hard so peaks FOLD back on themselves instead of
//  clipping flat. A pre-gain stage pushes the level past unity, an
//  asymmetric bias (Symmetry) shifts the fold axis, then a chain of
//  reflective triangle folds plus a final sine fold generate dense,
//  metallic harmonics. A post tone tilt and output stage shape the
//  result. The folding bounds the amplitude, so more Fold means more
//  harmonic complexity, not just more level. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel filter memory
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker (after fold)
const dcPrevIn:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const toneLP:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // tone tilt low-pass

const P_FOLD: i32 = 0;     // 0..1 -> pre-gain / number of folds (1..~9x)
const P_SYMMETRY: i32 = 1; // 0..1 -> bias offset, 0.5 = symmetric
const P_TONE: i32 = 2;     // 0..1 -> dark..bright tilt
const P_OUTPUT: i32 = 3;   // 0..1 -> output level 0..1.2
const P_MIX: i32 = 4;      // 0..1 -> dry/wet

const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    dcState[c] = 0.0;
    dcPrevIn[c] = 0.0;
    toneLP[c] = 0.0;
  }
  params[P_FOLD] = 0.45;
  params[P_SYMMETRY] = 0.5;
  params[P_TONE] = 0.55;
  params[P_OUTPUT] = 0.7;
  params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// Triangle (reflective) fold: maps any real x into a triangle wave in [-1,1].
// This is the classic wavefolder shape — peaks reflect back instead of clipping.
@inline function triFold(x: f32): f32 {
  // period 4: y = |((x+1) mod 4) - 2| - 1, reflected to [-1,1]
  let p: f32 = (x + 1.0) * 0.25;       // scale so one fold per unit of 2
  p = p - f32(Mathf.floor(p));          // fractional, [0,1)
  let t: f32 = f32(Mathf.abs(p * 4.0 - 2.0)) - 1.0; // triangle in [-1,1]
  return t;
}

export function process(n: i32): void {
  const foldN: f32 = clampf(params[P_FOLD], 0.0, 1.0);
  const symN: f32 = clampf(params[P_SYMMETRY], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const outN: f32 = clampf(params[P_OUTPUT], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // Pre-gain: more fold pushes the signal further past the fold threshold,
  // adding more reflections (more harmonics). 1x .. ~9x.
  const drive: f32 = 1.0 + foldN * foldN * 8.0;
  // Bias shifts the fold axis -> even harmonics / asymmetric character.
  const bias: f32 = (symN - 0.5) * 1.6;
  // Final sine-fold depth grows with Fold for a smoother, richer top end.
  const sineDepth: f32 = 0.35 + foldN * 0.65;

  // Tone: a one-pole low-pass we tilt between (dark) and bypass (bright).
  const toneHz: f32 = 500.0 + toneN * toneN * 11000.0;
  let cTone: f32 = f32(1.0 - Mathf.exp(-TWO_PI * toneHz / sampleRate));
  cTone = clampf(cTone, 0.0, 1.0);
  // Bright blend: mix some of the un-filtered (full harmonic) signal back in.
  const bright: f32 = toneN;

  // DC blocker coefficient (~10 Hz) — folding with bias adds DC we must remove.
  const dcR: f32 = f32(1.0 - TWO_PI * 10.0 / sampleRate);

  const out: f32 = outN * 1.2;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let dc: f32 = dcState[c];
    let dcPi: f32 = dcPrevIn[c];
    let lp: f32 = toneLP[c];

    for (let f = 0; f < n; f++) {
      const dry: f32 = inBuf[base + f];

      // drive past the fold threshold + bias the axis
      let s: f32 = dry * drive + bias;

      // triangle reflective fold — the core west-coast fold
      s = triFold(s);

      // a second, sine-based fold adds the smooth metallic upper harmonics;
      // depth scales with Fold so the timbre keeps evolving as you push it.
      s = f32(Mathf.sin(s * PI * sineDepth)) * 0.9 + s * 0.1;

      // keep it well bounded
      s = clampf(s, -1.0, 1.0);

      // remove fold/bias DC offset
      const hp: f32 = s - dcPi + dcR * dc;
      dc = hp;
      dcPi = s;

      // tone: low-pass + bright blend of the full-band folded signal
      lp = lp + cTone * (hp - lp);
      const toned: f32 = lp + (hp - lp) * bright;

      const wet: f32 = toned * out;
      outBuf[base + f] = dry * (1.0 - mix) + wet * mix;
    }

    dcState[c] = dc;
    dcPrevIn[c] = dcPi;
    toneLP[c] = lp;
  }
}
