// =====================================================================
//  STRIP EQ — British console channel-strip equaliser
//  A full mixing-desk channel EQ: a low shelf, two swept parametric MID
//  bells (low-mid + high-mid, each with gain + frequency), a high shelf,
//  plus a sweepable high-pass filter to clean the bottom. Clean, surgical
//  and punchy — RBJ biquads in series, all f32. Pure algorithm.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const PI: f32 = 3.14159265358979;

// ---- Parameter indices ----------------------------------------------
const P_LOW:       i32 = 0; // low shelf gain      0..1 -> -16..+16 dB
const P_LOMID:     i32 = 1; // low-mid bell gain   0..1 -> -16..+16 dB
const P_LOMID_F:   i32 = 2; // low-mid frequency   0..1 -> 80..2000 Hz (log)
const P_HIMID:     i32 = 3; // high-mid bell gain  0..1 -> -16..+16 dB
const P_HIMID_F:   i32 = 4; // high-mid frequency  0..1 -> 600..15000 Hz (log)
const P_HIGH:      i32 = 5; // high shelf gain     0..1 -> -16..+16 dB
const P_HP:        i32 = 6; // high-pass freq      0..1 -> 16..400 Hz (log), <0.02 = off
const P_OUTPUT:    i32 = 7; // output trim         0..1 -> -inf..+12 dB

// ---- Biquad state (per channel) -------------------------------------
// 5 cascaded sections: HP, low shelf, low-mid bell, high-mid bell, high shelf
const NSEC: i32 = 5;
const z1: StaticArray<f32> = new StaticArray<f32>(NSEC * MAX_CHANNELS);
const z2: StaticArray<f32> = new StaticArray<f32>(NSEC * MAX_CHANNELS);

// ---- Biquad coefficients (shared across channels, recomputed per block)
const cb0: StaticArray<f32> = new StaticArray<f32>(NSEC);
const cb1: StaticArray<f32> = new StaticArray<f32>(NSEC);
const cb2: StaticArray<f32> = new StaticArray<f32>(NSEC);
const ca1: StaticArray<f32> = new StaticArray<f32>(NSEC);
const ca2: StaticArray<f32> = new StaticArray<f32>(NSEC);

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// log map: t in [0,1] -> [lo,hi] geometrically
@inline function logMap(t: f32, lo: f32, hi: f32): f32 {
  return f32(lo * Mathf.exp(clampf(t, 0.0, 1.0) * f32(Mathf.log(hi / lo))));
}

@inline function dbToGain(db: f32): f32 {
  return f32(Mathf.exp(db * 0.11512925)); // 10^(db/20) = e^(db*ln10/20)
}

// --- Coefficient setters (RBJ cookbook, normalised by a0) -------------
function setPeaking(s: i32, freq: f32, q: f32, gainDb: f32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(gainDb)));
  const w0: f32 = 2.0 * PI * freq / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const alpha: f32 = sw / (2.0 * q);
  const a0: f32 = 1.0 + alpha / A;
  const inv: f32 = 1.0 / a0;
  cb0[s] = (1.0 + alpha * A) * inv;
  cb1[s] = (-2.0 * cw) * inv;
  cb2[s] = (1.0 - alpha * A) * inv;
  ca1[s] = (-2.0 * cw) * inv;
  ca2[s] = (1.0 - alpha / A) * inv;
}

function setLowShelf(s: i32, freq: f32, gainDb: f32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(gainDb)));
  const w0: f32 = 2.0 * PI * freq / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const alpha: f32 = sw * 0.5 * f32(Mathf.sqrt(2.0)); // Q ~ 0.707
  const tsa: f32 = 2.0 * f32(Mathf.sqrt(A)) * alpha;
  const ap1: f32 = A + 1.0;
  const am1: f32 = A - 1.0;
  const a0: f32 = ap1 + am1 * cw + tsa;
  const inv: f32 = 1.0 / a0;
  cb0[s] = (A * (ap1 - am1 * cw + tsa)) * inv;
  cb1[s] = (2.0 * A * (am1 - ap1 * cw)) * inv;
  cb2[s] = (A * (ap1 - am1 * cw - tsa)) * inv;
  ca1[s] = (-2.0 * (am1 + ap1 * cw)) * inv;
  ca2[s] = (ap1 + am1 * cw - tsa) * inv;
}

function setHighShelf(s: i32, freq: f32, gainDb: f32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(gainDb)));
  const w0: f32 = 2.0 * PI * freq / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const alpha: f32 = sw * 0.5 * f32(Mathf.sqrt(2.0));
  const tsa: f32 = 2.0 * f32(Mathf.sqrt(A)) * alpha;
  const ap1: f32 = A + 1.0;
  const am1: f32 = A - 1.0;
  const a0: f32 = ap1 - am1 * cw + tsa;
  const inv: f32 = 1.0 / a0;
  cb0[s] = (A * (ap1 + am1 * cw + tsa)) * inv;
  cb1[s] = (-2.0 * A * (am1 + ap1 * cw)) * inv;
  cb2[s] = (A * (ap1 + am1 * cw - tsa)) * inv;
  ca1[s] = (2.0 * (am1 - ap1 * cw)) * inv;
  ca2[s] = (ap1 - am1 * cw - tsa) * inv;
}

function setHighPass(s: i32, freq: f32, q: f32): void {
  const w0: f32 = 2.0 * PI * freq / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const alpha: f32 = sw / (2.0 * q);
  const a0: f32 = 1.0 + alpha;
  const inv: f32 = 1.0 / a0;
  cb0[s] = ((1.0 + cw) * 0.5) * inv;
  cb1[s] = (-(1.0 + cw)) * inv;
  cb2[s] = ((1.0 + cw) * 0.5) * inv;
  ca1[s] = (-2.0 * cw) * inv;
  ca2[s] = (1.0 - alpha) * inv;
}

function setBypass(s: i32): void {
  cb0[s] = 1.0; cb1[s] = 0.0; cb2[s] = 0.0; ca1[s] = 0.0; ca2[s] = 0.0;
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < NSEC * MAX_CHANNELS; i++) { z1[i] = 0.0; z2[i] = 0.0; }
  params[P_LOW] = 0.5; params[P_LOMID] = 0.5; params[P_LOMID_F] = 0.3;
  params[P_HIMID] = 0.5; params[P_HIMID_F] = 0.5; params[P_HIGH] = 0.5;
  params[P_HP] = 0.0; params[P_OUTPUT] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 8; }

export function process(n: i32): void {
  // --- map params to physical values ---
  const lowDb:   f32 = (clampf(params[P_LOW],   0.0, 1.0) - 0.5) * 32.0;  // -16..+16
  const loMidDb: f32 = (clampf(params[P_LOMID], 0.0, 1.0) - 0.5) * 32.0;
  const loMidF:  f32 = logMap(params[P_LOMID_F], 80.0, 2000.0);
  const hiMidDb: f32 = (clampf(params[P_HIMID], 0.0, 1.0) - 0.5) * 32.0;
  const hiMidF:  f32 = logMap(params[P_HIMID_F], 600.0, 15000.0);
  const highDb:  f32 = (clampf(params[P_HIGH],  0.0, 1.0) - 0.5) * 32.0;
  const hpN:     f32 = clampf(params[P_HP], 0.0, 1.0);

  // output: 0->-inf-ish (silence), 0.5->0dB, 1->+12dB
  const outN: f32 = clampf(params[P_OUTPUT], 0.0, 1.0);
  let outGain: f32;
  if (outN <= 0.001) outGain = 0.0;
  else outGain = dbToGain((outN - 0.5) * 24.0);

  // --- compute coefficients ---
  // section 0: high-pass (or bypass when nearly off)
  if (hpN < 0.02) setBypass(0);
  else setHighPass(0, logMap(hpN, 16.0, 400.0), 0.707);
  // section 1: low shelf @ 110 Hz
  setLowShelf(1, 110.0, lowDb);
  // section 2: low-mid bell (swept), moderate Q
  setPeaking(2, loMidF, 1.0, loMidDb);
  // section 3: high-mid bell (swept)
  setPeaking(3, hiMidF, 1.0, hiMidDb);
  // section 4: high shelf @ 9 kHz
  setHighShelf(4, 9000.0, highDb);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    for (let f = 0; f < n; f++) {
      let x: f32 = inBuf[base + f];
      // cascade of NSEC transposed-direct-form-II biquads
      for (let s = 0; s < NSEC; s++) {
        const si: i32 = s * MAX_CHANNELS + c;
        const y: f32 = cb0[s] * x + z1[si];
        z1[si] = cb1[s] * x - ca1[s] * y + z2[si];
        z2[si] = cb2[s] * x - ca2[s] * y;
        x = y;
      }
      x = x * outGain;
      // safety clamp (clean — never clip in normal use)
      outBuf[base + f] = clampf(x, -1.5, 1.5);
    }
  }
}
