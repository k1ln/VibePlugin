// =====================================================================
//  CLIP STAGE — transparent analog-style soft-clip saturator / drive
//  A gentle, MUSICAL clipping stage for warmth, glue and level control —
//  NOT a fuzz. A makeup-compensated drive feeds a selectable transfer
//  curve: DIODE (symmetric soft knee, odd harmonics) or TUBE (asymmetric
//  bias, adds even harmonics). A subtle post Tone tilt, an output Trim and
//  a parallel Mix round it out. Pure algorithm, no samples.
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
const dcState:   StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker (removes tube bias offset)
const dcPrev:    StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const toneState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post tone one-pole

const P_DRIVE: i32 = 0; // 0..1  -> input gain 1..12 (gentle, makeup-compensated)
const P_CURVE: i32 = 1; // 0..1  -> stepped 0=diode (soft) , 1=tube (asymmetric)
const P_TONE:  i32 = 2; // 0..1  -> spectral tilt: dark <-> open (one-pole LP morph)
const P_TRIM:  i32 = 3; // 0..1  -> output trim 0..1.5
const P_MIX:   i32 = 4; // 0..1  -> dry/wet (parallel saturation)

const PI: f32 = 3.14159265;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) { dcState[c] = 0.0; dcPrev[c] = 0.0; toneState[c] = 0.0; }
  params[P_DRIVE] = 0.4;
  params[P_CURVE] = 0.0;
  params[P_TONE]  = 0.6;
  params[P_TRIM]  = 0.65;
  params[P_MIX]   = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// DIODE: smooth symmetric soft-clip via tanh — transparent, odd harmonics,
// bounded to ±1. Gentle knee keeps it musical rather than grindy.
@inline function diodeClip(x: f32): f32 {
  return f32(Mathf.tanh(x));
}

// TUBE: asymmetric soft-clip. A small positive bias is added before a
// tanh-like saturator so the curve compresses one side harder than the
// other — this introduces 2nd-order (even) harmonics for the warm tube
// character. The DC blocker downstream removes the resulting offset.
@inline function tubeClip(x: f32): f32 {
  const bias: f32 = 0.18;
  const xb: f32 = x + bias;
  // saturate
  const s: f32 = f32(Mathf.tanh(xb));
  // re-reference around the biased operating point so silence stays ~silent
  const sb: f32 = f32(Mathf.tanh(bias));
  return s - sb;
}

export function process(n: i32): void {
  const driveN: f32 = clampf(params[P_DRIVE], 0.0, 1.0);
  // stepped selector: 0 -> diode, 1 -> tube
  const curve: i32 = params[P_CURVE] >= 0.5 ? 1 : 0;
  const toneN: f32 = clampf(params[P_TONE], 0.0, 1.0);
  const trim:  f32 = clampf(params[P_TRIM], 0.0, 1.0) * 1.5;
  const mix:   f32 = clampf(params[P_MIX], 0.0, 1.0);

  // gentle drive: 1..12x input gain (transparent range, never fuzz)
  const drive: f32 = 1.0 + driveN * 11.0;
  // makeup compensation: as drive rises the clipper compresses, so we
  // scale back to keep perceived level roughly constant (level control,
  // not a volume knob). sqrt keeps it musical.
  const comp: f32 = 1.0 / f32(Mathf.sqrt(drive));

  // post tone: one-pole low-pass morphing 1.2 kHz (dark) .. 18 kHz (open)
  const toneHz: f32 = 1200.0 + toneN * toneN * 16800.0;
  const cTone: f32 = clampf(f32(1.0 - Mathf.exp(-2.0 * PI * toneHz / sampleRate)), 0.0, 1.0);

  // DC blocker coefficient (~10 Hz)
  const r: f32 = f32(Mathf.exp(-2.0 * PI * 10.0 / sampleRate));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let dPrev: f32 = dcPrev[c];
    let dState: f32 = dcState[c];
    let tn: f32 = toneState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];
      const pre: f32 = x * drive;

      let shaped: f32 = curve == 1 ? tubeClip(pre) : diodeClip(pre);
      shaped = shaped * comp;

      // DC blocker (high-pass at ~10 Hz) — removes tube bias offset
      const dOut: f32 = shaped - dPrev + r * dState;
      dPrev = shaped;
      dState = dOut;

      // post tone shaping
      tn = tn + cTone * (dOut - tn);

      const wet: f32 = tn * trim;
      outBuf[base + f] = x * (1.0 - mix) + wet * mix;
    }

    dcPrev[c] = dPrev;
    dcState[c] = dState;
    toneState[c] = tn;
  }
}
