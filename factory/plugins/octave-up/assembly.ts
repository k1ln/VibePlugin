// =====================================================================
//  OCTAVE UP — octave-up fuzz
//  A silicon-style fuzz feeding a full-wave rectifier: the rectified signal
//  folds the fundamental's negative half up, doubling the pitch, which then
//  rings as a strong upper octave on top of the fuzz. The octave is strongest
//  on clean single notes (it tracks the loudest partial), and a high-pass
//  before the rectifier emphasises the doubling. Post tone low-pass and an
//  output level finish the voice. Pure algorithm, no samples.
//
//  Signal path per sample:
//    input -> pre HP (tighten) -> fuzz gain -> hard/soft fuzz clip = FUZZ
//    FUZZ -> full-wave rectify (|x|) -> DC-block -> normalise = OCTAVE
//    out = blend(FUZZ, OCTAVE by P_OCTAVE) -> tone LP -> volume
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
const hpState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-fuzz HP
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post-rectify DC block
const toneState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post tone LP

const P_FUZZ:   i32 = 0;  // 0..1 -> input gain 1..120
const P_OCTAVE: i32 = 1;  // 0..1 -> amount of rectified octave blended in
const P_TONE:   i32 = 2;  // 0..1 -> post LP 600..7000 Hz
const P_VOLUME: i32 = 3;  // 0..1 -> 0..1.2 output

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    hpState[c] = 0.0;
    dcState[c] = 0.0;
    toneState[c] = 0.0;
  }
  params[P_FUZZ] = 0.7;
  params[P_OCTAVE] = 0.6;
  params[P_TONE] = 0.55;
  params[P_VOLUME] = 0.7;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// Asymmetric fuzz clip: hard-ish saturation with a soft knee, slightly
// asymmetric so the fuzz keeps even-harmonic bite even before the octave.
@inline function fuzzClip(x: f32): f32 {
  const c: f32 = clampf(x, -3.0, 3.0);
  // tanh-like via rational approx, then a touch of asymmetry
  const t: f32 = c / f32(1.0 + Mathf.abs(c));
  return f32(t + 0.08 * (t * t - 0.5));
}

export function process(n: i32): void {
  const fuzzN: f32 = clampf(params[P_FUZZ], 0.0, 1.0);
  const octN: f32  = clampf(params[P_OCTAVE], 0.0, 1.0);
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const vol: f32   = clampf(params[P_VOLUME], 0.0, 1.0) * 1.2;

  // fuzz drive 1..120 (exponential feel)
  const drive: f32 = 1.0 + fuzzN * fuzzN * 119.0;

  // pre-fuzz high-pass ~150 Hz: tightens lows and helps the octave track the
  // upper partial cleanly instead of the rectifier smearing bass.
  const cHP: f32 = clampf(f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 150.0 / sampleRate)), 0.0, 1.0);
  // DC blocker on the rectified path (~20 Hz) so |x| doesn't add a DC step.
  const cDC: f32 = clampf(f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 20.0 / sampleRate)), 0.0, 1.0);
  // post tone low-pass 600..7000 Hz
  const toneHz: f32 = 600.0 + toneN * toneN * 6400.0;
  const cTone: f32 = clampf(f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * toneHz / sampleRate)), 0.0, 1.0);

  // gain compensation so fuzz isn't just "louder"; rectified path is gained
  // to roughly match the fuzz level.
  const comp: f32 = 1.4 / f32(Mathf.sqrt(drive));
  // The octave blend: equal-power-ish so it's audible at low settings too.
  const fuzzMix: f32 = f32(Mathf.sqrt(clampf(1.0 - octN * 0.85, 0.0, 1.0)));
  const octMix: f32  = f32(Mathf.sqrt(octN)) * 1.6;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let hp: f32 = hpState[c];
    let dc: f32 = dcState[c];
    let tn: f32 = toneState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // pre-fuzz high-pass
      hp = hp + cHP * (x - hp);
      const tight: f32 = x - hp;

      // FUZZ stage
      const fuzz: f32 = fuzzClip(tight * drive) * comp;

      // OCTAVE stage: full-wave rectify the fuzz, DC-block, re-centre.
      const rect: f32 = Mathf.abs(fuzz);
      dc = dc + cDC * (rect - dc);
      const oct: f32 = (rect - dc) * 2.0; // re-centre + lift level

      // blend fuzz + octave
      let y: f32 = fuzz * fuzzMix + oct * octMix;

      // post tone low-pass
      tn = tn + cTone * (y - tn);

      // safety clip then volume
      const shaped: f32 = clampf(tn, -1.0, 1.0);
      outBuf[base + f] = f32(shaped * vol);
    }

    hpState[c] = hp;
    dcState[c] = dc;
    toneState[c] = tn;
  }
}
