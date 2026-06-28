// =====================================================================
//  MYTHIC DRIVE — transparent, low-end-preserving overdrive
//  A parallel-path design: a CLEAN boosted signal is summed with a
//  treble-voiced SOFT-CLIPPED gain path. The dirt path is high-passed
//  before clipping so the bass stays clean and full, while a pre-clip
//  treble shelf and an active Treble/Tone control let the overdrive sit
//  bright and present without smearing. Adds gentle asymmetric
//  harmonics on top of a clean core for a glassy, see-through drive.
//  Pure algorithm, no samples.
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
const hpState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-clip HP (keep bass clean)
const trebState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-clip treble shelf LP split
const toneState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post active tone LP
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker LP (removes asym offset)

const P_GAIN:   i32 = 0;  // 0..1 -> drive into the soft-clip path
const P_TREBLE: i32 = 1;  // 0..1 -> active treble / tone, dark..bright
const P_OUTPUT: i32 = 2;  // 0..1 -> 0..1.2 master output
const P_MIX:    i32 = 3;  // 0..1 -> clean..driven blend

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    hpState[c] = 0.0; trebState[c] = 0.0; toneState[c] = 0.0; dcState[c] = 0.0;
  }
  params[P_GAIN] = 0.5; params[P_TREBLE] = 0.5; params[P_OUTPUT] = 0.7; params[P_MIX] = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// one-pole coefficient for a given corner frequency, guarded
@inline function onePole(hz: f32, sr: f32): f32 {
  const safeSr: f32 = sr > 1.0 ? sr : 48000.0;
  const c: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * hz / safeSr));
  return clampf(c, 0.0, 1.0);
}

// Smooth, mildly asymmetric soft clipper. tanh core keeps it transparent
// (gentle odd harmonics); a small squared term adds a touch of even
// harmonics for warmth. Output bounded well under ±1.
@inline function softClip(x: f32): f32 {
  const t: f32 = f32(Mathf.tanh(x));
  const even: f32 = 0.06 * (t * t - 0.5); // small asymmetric flavour, DC removed downstream
  return t + even;
}

export function process(n: i32): void {
  const gainN: f32 = clampf(params[P_GAIN], 0.0, 1.0);
  const trebN: f32 = clampf(params[P_TREBLE], 0.0, 1.0);
  const out:   f32 = clampf(params[P_OUTPUT], 0.0, 1.0) * 1.2;
  const mix:   f32 = clampf(params[P_MIX], 0.0, 1.0);

  // drive into the clip path: 1..~22x. Transparent at low settings.
  const drive: f32 = 1.0 + gainN * 21.0;
  // gain compensation so cranking Gain doesn't simply get louder
  const comp: f32 = 1.0 / f32(Mathf.sqrt(drive));

  // pre-clip high-pass ~90 Hz: the dirt path drops sub-bass so the low
  // end stays clean and tight (the clean path keeps the real low end).
  const cHP: f32 = onePole(90.0, sampleRate);

  // treble split point: signal above ~700 Hz gets emphasised before
  // clipping, giving the bright, "present" voicing.
  const cSplit: f32 = onePole(700.0, sampleRate);
  // how much extra treble drive (active treble), 0.4..2.2
  const trebBoost: f32 = 0.4 + trebN * 1.8;

  // post active tone LP: dark (1.5kHz) .. bright/open (~12kHz)
  const toneHz: f32 = 1500.0 + trebN * trebN * 10500.0;
  const cTone: f32 = onePole(toneHz, sampleRate);

  // DC blocker corner ~12 Hz (one-pole HP) to strip the asymmetric offset
  const cDC: f32 = onePole(12.0, sampleRate);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let hp: f32 = hpState[c];
    let tb: f32 = trebState[c];
    let tn: f32 = toneState[c];
    let dc: f32 = dcState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- dirt path: keep bass clean, voice the treble, soft-clip ---
      hp = hp + cHP * (x - hp);
      const hpSig: f32 = x - hp;            // high-passed (clipped path input)

      // split into low/high band; boost the high band (active treble)
      tb = tb + cSplit * (hpSig - tb);
      const lowBand: f32 = tb;
      const highBand: f32 = hpSig - tb;
      const voiced: f32 = lowBand + highBand * trebBoost;

      // soft-clip the voiced, driven signal, compensate the makeup
      let driven: f32 = softClip(voiced * drive) * comp;

      // remove DC / asymmetry offset (one-pole HP)
      dc = dc + cDC * (driven - dc);
      driven = driven - dc;

      // post active tone shaping
      tn = tn + cTone * (driven - tn);
      const dirt: f32 = tn;

      // --- clean path: full-range, preserves the true low end ---
      // sum clean + dirt; Mix blends transparent..driven
      const wet: f32 = x + dirt;            // parallel sum (clean core + harmonics)
      const blended: f32 = x * (1.0 - mix) + wet * mix;

      outBuf[base + f] = clampf(blended * out, -1.5, 1.5);
    }

    hpState[c] = hp;
    trebState[c] = tb;
    toneState[c] = tn;
    dcState[c] = dc;
  }
}
