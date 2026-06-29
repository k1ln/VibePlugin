// =====================================================================
//  AIR EXCITER — psychoacoustic high-frequency harmonic exciter
//
//  An "aural exciter": it isolates the upper band of the signal with a
//  high-pass, runs it through an asymmetric soft-saturator to synthesise
//  NEW high-order harmonics that were not present in the dry signal, then
//  brightens that harmonic stream ("Air") and blends a controlled amount
//  back on top of the untouched dry path. The result adds sparkle, sheen
//  and presence without simply boosting existing treble.
//
//  Signal flow per channel:
//    dry ──────────────────────────────────────────┐
//    in ─► [HP @ Tune] ─► [drive + soft-clip] ─► [HP again] ─► [Air shelf]
//                                                       └─► * Amount ─► (+) ─► Mix ─► out
//
//  Params:  Tune (HF corner)  Amount (harmonic level)  Air (top-end tilt)  Mix
//  Pure algorithm, allocation-free, f32 throughout, output bounded < 1.0.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// one-pole low-pass states used to derive the high-pass bands (x - lp)
const hpA: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // pre-saturation band split
const hpB: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // post-saturation harmonic split
const airS: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // air high-shelf state
const dcS:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // DC blocker on harmonics

const P_TUNE:   i32 = 0; // 0..1 -> HF corner 1.2k..9k Hz
const P_AMOUNT: i32 = 1; // 0..1 -> harmonic blend level
const P_AIR:    i32 = 2; // 0..1 -> extra top-end tilt on the harmonics
const P_MIX:    i32 = 3; // 0..1 -> dry/wet of the whole effect

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    hpA[c] = 0.0; hpB[c] = 0.0; airS[c] = 0.0; dcS[c] = 0.0;
  }
  params[P_TUNE] = 0.45;
  params[P_AMOUNT] = 0.5;
  params[P_AIR] = 0.5;
  params[P_MIX] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 4; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// one-pole low-pass coefficient for a given corner frequency
@inline function lpCoeff(hz: f32): f32 {
  let c: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * hz / sampleRate));
  return clampf(c, 0.0001, 0.999);
}

// asymmetric soft saturator — the asymmetry generates BOTH even and odd
// harmonics (purely odd shaping would only thicken, not "excite"); tanh-like
// curve keeps it smooth and bounded.
@inline function exciteShape(x: f32): f32 {
  // bias adds 2nd-order content; tanh approximation via rational function
  const b: f32 = x + 0.18;
  const t: f32 = b / f32(1.0 + Mathf.abs(b) * 0.85);
  // remove the DC the bias introduced (steady-state of the shaper at x=0)
  const t0: f32 = 0.18 / f32(1.0 + 0.18 * 0.85);
  return t - t0;
}

export function process(n: i32): void {
  const tune: f32 = clampf(params[P_TUNE], 0.0, 1.0);
  const amount: f32 = clampf(params[P_AMOUNT], 0.0, 1.0);
  const air: f32 = clampf(params[P_AIR], 0.0, 1.0);
  const mix: f32 = clampf(params[P_MIX], 0.0, 1.0);

  // HF corner: 1.2 kHz .. 9 kHz (clamped under Nyquist for low sample rates)
  let corner: f32 = 1200.0 + tune * tune * 7800.0;
  const nyq: f32 = sampleRate * 0.45;
  if (corner > nyq) corner = nyq;
  const cA: f32 = lpCoeff(corner);
  // second split a little higher so we keep the freshly-made harmonics, not the fundamental band
  const cB: f32 = lpCoeff(clampf(corner * 1.4, 0.0, nyq));

  // Air = a bright high-shelf tilt on the harmonic stream. Higher air -> let
  // more of the very top through (smaller LP -> more high content retained).
  const airHz: f32 = clampf(corner * (1.5 + air * 4.0), 0.0, nyq);
  const cAir: f32 = lpCoeff(airHz);
  const airMix: f32 = 0.35 + air * 0.65; // how much high-passed sparkle vs body

  // drive into the shaper scales with Amount so the knob also changes timbre,
  // not just level — more amount = richer/denser harmonics.
  const drive: f32 = 2.0 + amount * 10.0;
  // harmonic make-up level, gain-compensated so it stays subtle and bounded
  const hLevel: f32 = amount * 0.9;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let lpa: f32 = hpA[c];
    let lpb: f32 = hpB[c];
    let lpAir: f32 = airS[c];
    let dcZ: f32 = dcS[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // 1) isolate the upper band
      lpa = lpa + cA * (x - lpa);
      const high: f32 = x - lpa;

      // 2) generate harmonics by saturating the driven upper band
      let harm: f32 = exciteShape(high * drive);

      // 3) keep only the high-frequency harmonic content (drop low-order fundamentals)
      lpb = lpb + cB * (harm - lpb);
      harm = harm - lpb;

      // 4) DC blocker: track the slow-moving mean and subtract it so the
      //    asymmetric shaper can't drift the harmonic stream off-centre.
      dcZ = dcZ + 0.0006 * (harm - dcZ);
      const h2: f32 = harm - dcZ;

      // 5) Air tilt — emphasise the very top of the harmonic stream
      lpAir = lpAir + cAir * (h2 - lpAir);
      const sparkle: f32 = h2 - lpAir;          // the brightest layer
      const excited: f32 = (1.0 - airMix) * h2 + airMix * sparkle;

      // 6) blend the synthesised air on top of the untouched dry signal
      const wet: f32 = x + excited * hLevel;
      let y: f32 = x * (1.0 - mix) + wet * mix;

      // safety clamp — keep peaks bounded well under full-scale
      y = clampf(y, -0.999, 0.999);
      outBuf[base + f] = y;
    }

    hpA[c] = lpa;
    hpB[c] = lpb;
    airS[c] = lpAir;
    dcS[c] = dcZ;
  }
}
