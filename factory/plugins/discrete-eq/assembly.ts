// =====================================================================
//  DISCRETE EQ — a punchy discrete-electronics console equaliser
//  Three forward-sounding bands modelled on a vintage discrete-op-amp
//  500-series console EQ:
//    * LOW band  — switchable LOW SHELF / BELL, corner ~80 Hz
//    * MID band  — sweepable BELL with PROPORTIONAL-Q: the bell is WIDE
//                  at small boosts/cuts and NARROWS as you push it hard
//                  (the signature reciprocal proportional Q)
//    * HIGH band — switchable HIGH SHELF / BELL, corner ~12 kHz
//  The whole strip is followed by a touch of discrete-stage DRIVE
//  (asymmetric soft saturation) for that punchy, forward console weight.
//  Stable RBJ biquads in Direct-Form I. Pure algorithm, no samples.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

// ---- parameter indices (must match spec.json + the GUI) --------------
const P_LOW_GAIN:   i32 = 0; // 0..1 -> low band   -12..+12 dB  (corner ~80 Hz)
const P_LOW_SHAPE:  i32 = 1; // 0|1  -> 0 = shelf, 1 = bell        (DISCRETE)
const P_MID_FREQ:   i32 = 2; // 0..1 -> mid bell centre 200..7000 Hz (log)
const P_MID_GAIN:   i32 = 3; // 0..1 -> mid bell   -15..+15 dB  (proportional-Q)
const P_HIGH_GAIN:  i32 = 4; // 0..1 -> high band  -12..+15 dB  (corner ~12 kHz)
const P_HIGH_SHAPE: i32 = 5; // 0|1  -> 0 = shelf, 1 = bell        (DISCRETE)
const P_DRIVE:      i32 = 6; // 0..1 -> discrete-stage saturation amount

const PI: f32 = 3.14159265358979;

// ---- per-channel Direct-Form I biquad state (x[n-1],x[n-2],y[n-1],y[n-2]) ----
// three cascaded bands: low, mid, high
const loX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const loX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const loY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const loY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const mdX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const hiX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hiX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hiY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hiY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// ---- shared coefficient registers (recomputed once per process block) ----
let lo_b0: f32 = 1.0; let lo_b1: f32 = 0.0; let lo_b2: f32 = 0.0;
let lo_a1: f32 = 0.0; let lo_a2: f32 = 0.0;
let md_b0: f32 = 1.0; let md_b1: f32 = 0.0; let md_b2: f32 = 0.0;
let md_a1: f32 = 0.0; let md_a2: f32 = 0.0;
let hi_b0: f32 = 1.0; let hi_b1: f32 = 0.0; let hi_b2: f32 = 0.0;
let hi_a1: f32 = 0.0; let hi_a2: f32 = 0.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    loX1[c] = 0.0; loX2[c] = 0.0; loY1[c] = 0.0; loY2[c] = 0.0;
    mdX1[c] = 0.0; mdX2[c] = 0.0; mdY1[c] = 0.0; mdY2[c] = 0.0;
    hiX1[c] = 0.0; hiX2[c] = 0.0; hiY1[c] = 0.0; hiY2[c] = 0.0;
  }
  params[P_LOW_GAIN]   = 0.5;  // flat
  params[P_LOW_SHAPE]  = 0.0;  // shelf
  params[P_MID_FREQ]   = 0.45; // ~1 kHz region
  params[P_MID_GAIN]   = 0.5;  // flat
  params[P_HIGH_GAIN]  = 0.5;  // flat
  params[P_HIGH_SHAPE] = 0.0;  // shelf
  params[P_DRIVE]      = 0.25; // a touch of discrete weight
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 7; }

// dB -> linear amplitude
@inline function dbToGain(db: f32): f32 {
  return f32(Mathf.exp(db * 0.11512925)); // ln(10)/20
}

// discrete-stage asymmetric soft saturation: punchy, forward, with a touch
// of even-harmonic colour. Bounded to roughly ±1.1 so it never runs away.
@inline function saturate(x: f32, amt: f32): f32 {
  const k: f32 = 1.0 + amt * 3.5;
  const t: f32 = f32(Mathf.tanh(x * k));
  const asym: f32 = amt * 0.12 * (t * t - 0.5); // even-harmonic asymmetry
  const driven: f32 = (t + asym) / k;
  return x + amt * (driven - x);
}

// ---- coefficient builders (RBJ cookbook, normalised by a0) -----------
function computeLowShelf(f0: f32, dbGain: f32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(dbGain)));
  const w0: f32 = 2.0 * PI * f0 / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const S: f32 = 0.85;
  const alpha: f32 = sw * 0.5 * f32(Mathf.sqrt((A + 1.0 / A) * (1.0 / S - 1.0) + 2.0));
  const tsa: f32 = 2.0 * f32(Mathf.sqrt(A)) * alpha;

  const b0: f32 =      A * ((A + 1.0) - (A - 1.0) * cw + tsa);
  const b1: f32 =  2.0 * A * ((A - 1.0) - (A + 1.0) * cw);
  const b2: f32 =      A * ((A + 1.0) - (A - 1.0) * cw - tsa);
  const a0: f32 =           (A + 1.0) + (A - 1.0) * cw + tsa;
  const a1: f32 = -2.0 *    ((A - 1.0) + (A + 1.0) * cw);
  const a2: f32 =           (A + 1.0) + (A - 1.0) * cw - tsa;
  const inv: f32 = a0 != 0.0 ? f32(1.0 / a0) : 1.0;

  lo_b0 = b0 * inv; lo_b1 = b1 * inv; lo_b2 = b2 * inv;
  lo_a1 = a1 * inv; lo_a2 = a2 * inv;
}

function computeHighShelf(f0: f32, dbGain: f32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(dbGain)));
  const w0: f32 = 2.0 * PI * f0 / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const S: f32 = 0.9;
  const alpha: f32 = sw * 0.5 * f32(Mathf.sqrt((A + 1.0 / A) * (1.0 / S - 1.0) + 2.0));
  const tsa: f32 = 2.0 * f32(Mathf.sqrt(A)) * alpha;

  const b0: f32 =      A * ((A + 1.0) + (A - 1.0) * cw + tsa);
  const b1: f32 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cw);
  const b2: f32 =      A * ((A + 1.0) + (A - 1.0) * cw - tsa);
  const a0: f32 =           (A + 1.0) - (A - 1.0) * cw + tsa;
  const a1: f32 =  2.0 *    ((A - 1.0) - (A + 1.0) * cw);
  const a2: f32 =           (A + 1.0) - (A - 1.0) * cw - tsa;
  const inv: f32 = a0 != 0.0 ? f32(1.0 / a0) : 1.0;

  hi_b0 = b0 * inv; hi_b1 = b1 * inv; hi_b2 = b2 * inv;
  hi_a1 = a1 * inv; hi_a2 = a2 * inv;
}

// generic peaking bell -> writes into the band selected by `band` (0=lo,1=md,2=hi)
function computeBell(f0: f32, dbGain: f32, q: f32, band: i32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(dbGain)));
  const w0: f32 = 2.0 * PI * f0 / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const alpha: f32 = sw / (2.0 * q);

  const b0: f32 = 1.0 + alpha * A;
  const b1: f32 = -2.0 * cw;
  const b2: f32 = 1.0 - alpha * A;
  const a0: f32 = 1.0 + alpha / A;
  const a1: f32 = -2.0 * cw;
  const a2: f32 = 1.0 - alpha / A;
  const inv: f32 = a0 != 0.0 ? f32(1.0 / a0) : 1.0;

  if (band == 0) {
    lo_b0 = b0 * inv; lo_b1 = b1 * inv; lo_b2 = b2 * inv;
    lo_a1 = a1 * inv; lo_a2 = a2 * inv;
  } else if (band == 1) {
    md_b0 = b0 * inv; md_b1 = b1 * inv; md_b2 = b2 * inv;
    md_a1 = a1 * inv; md_a2 = a2 * inv;
  } else {
    hi_b0 = b0 * inv; hi_b1 = b1 * inv; hi_b2 = b2 * inv;
    hi_a1 = a1 * inv; hi_a2 = a2 * inv;
  }
}

export function process(n: i32): void {
  // --- map params to musical ranges -----------------------------------
  const lowDb:   f32 = (clampf(params[P_LOW_GAIN],  0.0, 1.0) - 0.5) * 24.0;  // -12..+12
  const lowBell: bool = clampf(params[P_LOW_SHAPE], 0.0, 1.0) >= 0.5;
  const midN:    f32 = clampf(params[P_MID_FREQ],   0.0, 1.0);
  const midDb:   f32 = (clampf(params[P_MID_GAIN],  0.0, 1.0) - 0.5) * 30.0;  // -15..+15
  const highDb:  f32 = (clampf(params[P_HIGH_GAIN], 0.0, 1.0) - 0.5) * 27.0;  // -13.5..+13.5
  const hiBell:  bool = clampf(params[P_HIGH_SHAPE], 0.0, 1.0) >= 0.5;
  const drive:   f32 = clampf(params[P_DRIVE],      0.0, 1.0);

  const nyq: f32 = sampleRate * 0.45;

  // log-sweep the mid centre 200 Hz .. 7000 Hz, clamped below Nyquist
  let midHz: f32 = f32(200.0 * Mathf.exp(midN * 3.555)); // 200 * (7000/200)^midN
  if (midHz > nyq) midHz = nyq;
  if (midHz < 20.0) midHz = 20.0;

  // PROPORTIONAL-Q (reciprocal): WIDE bell at small gains, NARROW
  // bell at large gains. The bandwidth shrinks ~ proportional to boost amount.
  const adb: f32 = midDb < 0.0 ? -midDb : midDb;
  const midQ: f32 = clampf(0.5 + adb * 0.18, 0.5, 4.0);

  // band corners
  let lowHz: f32 = 80.0;
  let highHz: f32 = 12000.0;
  if (highHz > nyq) highHz = nyq;
  if (lowHz < 20.0) lowHz = 20.0;

  // LOW band: shelf or wide bell (bell uses a broad, console-like Q)
  if (lowBell) computeBell(lowHz * 1.6, lowDb, 0.7, 0);
  else computeLowShelf(lowHz, lowDb);

  // MID band: always a proportional-Q bell
  computeBell(midHz, midDb, midQ, 1);

  // HIGH band: shelf or wide bell
  if (hiBell) computeBell(highHz * 0.55, highDb, 0.7, 2);
  else computeHighShelf(highHz, highDb);

  // output trim so heavy simultaneous boosts + drive stay <~1.0 peak
  const outTrim: f32 = 0.82;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;

    let ax1: f32 = loX1[c]; let ax2: f32 = loX2[c]; let ay1: f32 = loY1[c]; let ay2: f32 = loY2[c];
    let bx1: f32 = mdX1[c]; let bx2: f32 = mdX2[c]; let by1: f32 = mdY1[c]; let by2: f32 = mdY2[c];
    let cx1: f32 = hiX1[c]; let cx2: f32 = hiX2[c]; let cy1: f32 = hiY1[c]; let cy2: f32 = hiY2[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // low band
      let y: f32 = lo_b0 * x + lo_b1 * ax1 + lo_b2 * ax2 - lo_a1 * ay1 - lo_a2 * ay2;
      ax2 = ax1; ax1 = x; ay2 = ay1; ay1 = y;

      // mid band
      const mIn: f32 = y;
      let ym: f32 = md_b0 * mIn + md_b1 * bx1 + md_b2 * bx2 - md_a1 * by1 - md_a2 * by2;
      bx2 = bx1; bx1 = mIn; by2 = by1; by1 = ym;

      // high band
      const hIn: f32 = ym;
      let yh: f32 = hi_b0 * hIn + hi_b1 * cx1 + hi_b2 * cx2 - hi_a1 * cy1 - hi_a2 * cy2;
      cx2 = cx1; cx1 = hIn; cy2 = cy1; cy1 = yh;

      // discrete-stage drive across the whole strip
      let s: f32 = saturate(yh, drive);

      outBuf[base + f] = clampf(s * outTrim, -1.2, 1.2);
    }

    loX1[c] = ax1; loX2[c] = ax2; loY1[c] = ay1; loY2[c] = ay2;
    mdX1[c] = bx1; mdX2[c] = bx2; mdY1[c] = by1; mdY2[c] = by2;
    hiX1[c] = cx1; hiX2[c] = cx2; hiY1[c] = cy1; hiY2[c] = cy2;
  }
}
