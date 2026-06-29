// =====================================================================
//  TILT EQ — a mastering-grade spectral balance shelf
//  One Tilt control rotates the whole spectrum around a pivot frequency:
//  turning it up lifts the treble while pulling down the bass (and the
//  reverse), like tipping a see-saw. A complementary low/high shelf pair
//  (gentle Baxandall-style bass + treble trims) adds independent fine
//  tone shaping, followed by an output trim. Pure algorithm, no samples.
//
//  DSP recipe per channel:
//    - Split the signal into a low band and a high band with a one-pole
//      low-pass at the Pivot frequency (lo = LP, hi = x - lo).
//    - Tilt applies complementary gains: lo *= (1 - tilt*k), hi *= (1 + tilt*k).
//    - A separate low shelf (Bass) and high shelf (Treble) re-use the same
//      band split for smooth, phase-coherent, broad shelving trims.
//    - Output trim, soft safety clip to keep peaks bounded < ~1.0.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// per-channel one-pole low-pass state for the tilt band split,
// plus an independent split for the shelf pair (kept separate so the
// two stages stay clean even at very different corner frequencies).
const tiltLP:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const bassLP:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const trebLP:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_TILT:   i32 = 0;  // 0..1  -> -1..+1  (down = bassier, up = brighter)
const P_PIVOT:  i32 = 1;  // 0..1  -> pivot frequency 200..2000 Hz (log)
const P_BASS:   i32 = 2;  // 0..1  -> low-shelf  gain -12..+12 dB
const P_TREBLE: i32 = 3;  // 0..1  -> high-shelf gain -12..+12 dB
const P_OUTPUT: i32 = 4;  // 0..1  -> output trim -inf..+6 dB (here 0..2x)

const PI: f32 = 3.14159265358979;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) { tiltLP[c] = 0.0; bassLP[c] = 0.0; trebLP[c] = 0.0; }
  params[P_TILT]   = 0.5;  // centred = flat
  params[P_PIVOT]  = 0.5;  // ~630 Hz
  params[P_BASS]   = 0.5;  // 0 dB
  params[P_TREBLE] = 0.5;  // 0 dB
  params[P_OUTPUT] = 0.5;  // unity-ish
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

// dB -> linear amplitude (f32-safe)
@inline function dbToLin(db: f32): f32 { return f32(Mathf.exp(db * 0.11512925)); } // 10^(db/20) = e^(db*ln10/20)

// one-pole LP coefficient for a given corner (Hz)
@inline function lpCoeff(hz: f32, sr: f32): f32 {
  let c: f32 = f32(1.0 - Mathf.exp(-2.0 * PI * hz / sr));
  return clampf(c, 0.00001, 1.0);
}

// smooth saturating safety clip, transparent below ~0.9
@inline function safeClip(x: f32): f32 {
  if (x > 1.0)  x = 1.0;
  if (x < -1.0) x = -1.0;
  return f32(1.5 * x - 0.5 * x * x * x);
}

export function process(n: i32): void {
  // --- map params ---
  const tilt: f32 = clampf(params[P_TILT], 0.0, 1.0) * 2.0 - 1.0;   // -1..+1
  const pivotN: f32 = clampf(params[P_PIVOT], 0.0, 1.0);
  // log-spaced pivot 200..2000 Hz
  const pivotHz: f32 = f32(200.0 * Mathf.exp(pivotN * 2.302585));   // 200 * 10^pivotN
  const bassDb: f32 = (clampf(params[P_BASS], 0.0, 1.0) * 2.0 - 1.0) * 12.0;
  const trebDb: f32 = (clampf(params[P_TREBLE], 0.0, 1.0) * 2.0 - 1.0) * 12.0;
  const outGain: f32 = clampf(params[P_OUTPUT], 0.0, 1.0) * 2.0;    // 0..2x

  // tilt complementary gains: up to ±~9 dB of rebalance at the extremes
  const tiltAmt: f32 = tilt * 0.7;                 // bounded slope strength
  const loTilt: f32 = clampf(1.0 - tiltAmt, 0.0, 2.0);
  const hiTilt: f32 = clampf(1.0 + tiltAmt, 0.0, 2.0);

  // shelf linear gains
  const bassG: f32 = dbToLin(bassDb);
  const trebG: f32 = dbToLin(trebDb);

  // band-split corners
  const cTilt: f32 = lpCoeff(pivotHz, sampleRate);
  const cBass: f32 = lpCoeff(220.0, sampleRate);   // low-shelf corner
  const cTreb: f32 = lpCoeff(3500.0, sampleRate);  // high-shelf corner

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let zT: f32 = tiltLP[c];
    let zB: f32 = bassLP[c];
    let zH: f32 = trebLP[c];
    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // --- 1) tilt: split at pivot, weight the two halves complementarily ---
      zT = zT + cTilt * (x - zT);
      const lo: f32 = zT;
      const hi: f32 = x - zT;
      let y: f32 = lo * loTilt + hi * hiTilt;

      // --- 2) bass low-shelf: boost/cut the band below cBass ---
      zB = zB + cBass * (y - zB);
      const bLow: f32 = zB;
      const bHigh: f32 = y - zB;
      y = bLow * bassG + bHigh;

      // --- 3) treble high-shelf: boost/cut the band above cTreb ---
      zH = zH + cTreb * (y - zH);
      const tLow: f32 = zH;
      const tHigh: f32 = y - zH;
      y = tLow + tHigh * trebG;

      // --- 4) output trim + safety clip ---
      outBuf[base + f] = safeClip(y * outGain);
    }
    tiltLP[c] = zT;
    bassLP[c] = zB;
    trebLP[c] = zH;
  }
}
