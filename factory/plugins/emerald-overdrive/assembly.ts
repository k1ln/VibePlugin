// =====================================================================
//  EMERALD OVERDRIVE — smooth mid-focused tube-style overdrive
//  The classic green-pedal recipe: a band-limited gain stage feeding a
//  symmetric soft-clipper (op-amp + anti-parallel diode model), then a
//  post tone low-pass and output level. Removes mud before clipping for
//  the signature mid-hump. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const lowState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-clip LP (for HP)
const toneState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post tone LP

const P_DRIVE: i32 = 0;  // 0..1 -> gain 1..40
const P_TONE: i32 = 1;   // 0..1 -> post LP 800..6000 Hz
const P_LEVEL: i32 = 2;  // 0..1 -> 0..1.2 output
const P_MIX: i32 = 3;    // 0..1 dry/wet

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) { lowState[c] = 0.0; toneState[c] = 0.0; }
  params[P_DRIVE] = 0.5; params[P_TONE] = 0.5; params[P_LEVEL] = 0.6; params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// cubic soft clip: soft knee, saturates to ±1
@inline function softClip(x: f32): f32 {
  const c: f32 = clampf(x, -1.0, 1.0);
  return 1.5 * c - 0.5 * c * c * c;
}

export function process(n: i32): void {
  const drive: f32 = 1.0 + clampf(params[P_DRIVE], 0.0, 1.0) * 39.0;
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.2;
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // pre-clip high-pass corner ~120 Hz (clean low end → tighter mid-hump)
  const cLow: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * 120.0 / sampleRate));
  // post tone low-pass 800..6000 Hz
  const toneHz: f32 = 800.0 + toneN * toneN * 5200.0;
  const cTone: f32 = f32(1.0 - Mathf.exp(-2.0 * 3.14159265 * toneHz / sampleRate));
  // gain compensation so Drive doesn't just get louder (keeps level musical)
  const comp: f32 = 2.5 / f32(Mathf.sqrt(drive));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let lo: f32 = lowState[c];
    let tn: f32 = toneState[c];
    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];
      lo = lo + cLow * (x - lo);
      const hp: f32 = x - lo;                 // high-passed input
      const driven: f32 = softClip(hp * drive) * comp;
      tn = tn + cTone * (driven - tn);        // post tone shaping
      const wet: f32 = tn * level;
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }
    lowState[c] = lo;
    toneState[c] = tn;
  }
}
