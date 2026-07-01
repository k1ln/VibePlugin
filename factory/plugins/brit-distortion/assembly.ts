// =====================================================================
//  BRIT DISTORTION — amp-in-a-box British distortion + 3-band tone stack
//  (Marshall Guv'nor lineage, modelled, not copied)
//
//  Signal flow:
//    in -> input HP (~70 Hz, tighten lows)
//       -> x Gain  (crunch .. roar)
//       -> hard-ish clipper (soft knee feeding a hard rail) — diode/op-amp
//          pair behaviour of an amp-in-a-box gain stage
//       -> passive British tone stack (interactive Bass / Mid / Treble):
//            * Treble: high shelf  (bright tilt)
//            * Mid:    peaking bell ~650 Hz (scoop <-> mid-forward)
//            * Bass:   low shelf
//          implemented as three one-pole-derived shaping stages whose
//          gains INTERACT through a shared makeup so turning Bass up
//          fattens and slightly veils the top, like a real FMV stack.
//       -> Level (master volume)
//
//  All math is f32 (Mathf.*), no allocation in process(), planar stride 8192.
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
const hpState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // input high-pass
const lowState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // low band split
const midState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // mid bell low side
const midState2:StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // mid bell high side
const hiState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS); // treble split

const P_GAIN: i32   = 0; // 0..1 -> input drive 1..60
const P_BASS: i32   = 1; // 0..1 -> low shelf  -/+
const P_MID: i32    = 2; // 0..1 -> mid bell  scoop/boost
const P_TREBLE: i32 = 3; // 0..1 -> high shelf -/+
const P_LEVEL: i32  = 4; // 0..1 -> 0..1.2 master

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    hpState[c] = 0.0; lowState[c] = 0.0; midState[c] = 0.0; midState2[c] = 0.0; hiState[c] = 0.0;
  }
  params[P_GAIN] = 0.55;
  params[P_BASS] = 0.5;
  params[P_MID] = 0.5;
  params[P_TREBLE] = 0.55;
  params[P_LEVEL] = 0.6;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// one-pole low-pass coefficient for a given corner (Hz)
@inline function lpCoeff(hz: f32, sr: f32): f32 {
  return f32(1.0 - Mathf.exp(-2.0 * PI * hz / sr));
}

// amp-in-a-box clipper: soft cubic knee that runs into a hard tanh rail.
// Harder than a pure overdrive — crunch into roar — but bounded < 1.0.
@inline function ampClip(x: f32): f32 {
  // soft cubic region for low level, then tanh rail to hold the ceiling
  const a: f32 = clampf(x, -3.0, 3.0);
  const soft: f32 = a - (a * a * a) * f32(1.0 / 9.0); // gentle asymmetric-free knee
  return f32(Mathf.tanh(soft * 0.7)) * 0.92;          // hard ceiling ~0.92
}

export function process(n: i32): void {
  const gain: f32  = 1.0 + clampf(params[P_GAIN], 0.0, 1.0) * 59.0; // 1..60
  const bassN: f32 = clampf(params[P_BASS], 0.0, 1.0);
  const midN: f32  = clampf(params[P_MID], 0.0, 1.0);
  const trebN: f32 = clampf(params[P_TREBLE], 0.0, 1.0);
  const level: f32 = clampf(params[P_LEVEL], 0.0, 1.0) * 1.2;

  // ---- tone-stack band gains (interactive) -------------------------
  // Bass low-shelf gain: 0.35x .. 2.2x around 180 Hz
  const bassG: f32 = 0.35 + bassN * 1.85;
  // Treble high-shelf gain: 0.30x .. 2.4x above 2.5 kHz
  const trebG: f32 = 0.30 + trebN * 2.10;
  // Mid bell ~650 Hz: deep scoop (0.18x) .. mid-forward (2.6x)
  const midG: f32  = 0.18 + midN * 2.42;

  // British-stack interaction: lots of bass slightly veils the treble,
  // and a mid scoop opens the extremes — couple them so the controls
  // visibly reshape each other like a passive FMV network.
  const trebTilt: f32 = trebG * (1.0 - 0.18 * bassN);          // bass loads the highs
  const bassTilt: f32 = bassG * (1.0 + 0.12 * (1.0 - midN));   // mid scoop fattens lows
  // makeup so the overall stack stays near unity loudness across settings
  const stackMakeup: f32 = 1.0 / (0.45 + 0.30 * (bassTilt + midG + trebTilt) * f32(1.0 / 3.0));

  // ---- crossover corners -------------------------------------------
  const cHP:  f32 = lpCoeff(70.0,   sampleRate); // input tightening high-pass
  const cLow: f32 = lpCoeff(180.0,  sampleRate); // low band
  const cMidL:f32 = lpCoeff(420.0,  sampleRate); // mid bell lower edge
  const cMidH:f32 = lpCoeff(950.0,  sampleRate); // mid bell upper edge
  const cHi:  f32 = lpCoeff(2500.0, sampleRate); // treble band

  // gain compensation so cranking Gain doesn't simply get louder
  const comp: f32 = 2.2 / f32(Mathf.sqrt(gain));

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let hp: f32  = hpState[c];
    let lo: f32  = lowState[c];
    let mL: f32  = midState[c];
    let mH: f32  = midState2[c];
    let hi: f32  = hiState[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // input high-pass (remove sub-mud before the gain stage)
      hp = hp + cHP * (x - hp);
      const tight: f32 = x - hp;

      // gain stage + amp-in-a-box clipping
      const driven: f32 = ampClip(tight * gain) * comp;

      // ---- 3-band passive-style tone stack ----
      // low band (everything below ~180 Hz)
      lo = lo + cLow * (driven - lo);
      const lowBand: f32 = lo;

      // mid band: band-pass via difference of two low-passes (~420..950 Hz center ~650)
      mL = mL + cMidL * (driven - mL);
      mH = mH + cMidH * (driven - mH);
      const midBand: f32 = mH - mL;     // peaking region

      // treble band: everything above ~2.5 kHz
      hi = hi + cHi * (driven - hi);
      const hiBand: f32 = driven - hi;

      // remaining "neutral" middle content (keeps body when bands are cut)
      const rest: f32 = driven - lowBand - midBand - hiBand;

      const shaped: f32 =
          rest
        + lowBand * bassTilt
        + midBand * midG
        + hiBand  * trebTilt;

      const wet: f32 = shaped * stackMakeup * level;
      outBuf[base + f] = clampf(wet, -1.5, 1.5);
    }

    hpState[c]  = hp;
    lowState[c] = lo;
    midState[c] = mL;
    midState2[c]= mH;
    hiState[c]  = hi;
  }
}
