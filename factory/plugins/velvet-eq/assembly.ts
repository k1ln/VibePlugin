// =====================================================================
//  VELVET EQ — passive program equalizer (vintage tube-EQ behaviour)
//  A low-frequency band that can BOOST and ATTENUATE at the same time:
//  the boost is a gentle low shelf, the cut is a low shelf a little above
//  it, so dialling both gives the classic "boost with a resonant dip just
//  above" curve. A high-frequency PEAK boost with a selectable centre adds
//  air/presence, and an independent high SHELF attenuation tames the top.
//  All curves are broad and gentle — built from stable RBJ biquads.
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

// ---- parameter indices -------------------------------------------------
const P_LOW_FREQ:   i32 = 0; // 0..1 -> 20..160 Hz (low band centre)
const P_LOW_BOOST:  i32 = 1; // 0..1 -> low shelf boost   0..+14 dB
const P_LOW_ATTEN:  i32 = 2; // 0..1 -> low shelf cut     0..-16 dB (just above boost)
const P_HBOOST_FRQ: i32 = 3; // 0..1 -> 3..16 kHz (high boost peak centre)
const P_HIGH_BOOST: i32 = 4; // 0..1 -> high bell boost   0..+16 dB
const P_HIGH_ATTEN: i32 = 5; // 0..1 -> high shelf cut    0..-16 dB

const NUM_PARAMS: i32 = 6;

// ---- three cascaded biquad stages, stereo state ------------------------
// stage 0 = low shelf boost, 1 = low shelf cut, 2 = high bell boost,
// 3 = high shelf cut.
const NUM_STAGES: i32 = 4;

// coefficients (normalised, a0 = 1): b0 b1 b2 a1 a2 per stage
const b0c: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES);
const b1c: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES);
const b2c: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES);
const a1c: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES);
const a2c: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES);

// direct-form-I state: x1 x2 y1 y2 per stage per channel
const x1s: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES * MAX_CHANNELS);
const x2s: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES * MAX_CHANNELS);
const y1s: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES * MAX_CHANNELS);
const y2s: StaticArray<f32> = new StaticArray<f32>(NUM_STAGES * MAX_CHANNELS);

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let i = 0; i < NUM_STAGES * MAX_CHANNELS; i++) {
    x1s[i] = 0.0; x2s[i] = 0.0; y1s[i] = 0.0; y2s[i] = 0.0;
  }
  for (let s = 0; s < NUM_STAGES; s++) {
    b0c[s] = 1.0; b1c[s] = 0.0; b2c[s] = 0.0; a1c[s] = 0.0; a2c[s] = 0.0;
  }
  params[P_LOW_FREQ]   = 0.3;  // ~60 Hz
  params[P_LOW_BOOST]  = 0.0;
  params[P_LOW_ATTEN]  = 0.0;
  params[P_HBOOST_FRQ] = 0.4;  // ~7 kHz
  params[P_HIGH_BOOST] = 0.0;
  params[P_HIGH_ATTEN] = 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

// ---- RBJ biquad coefficient designers (normalised by a0) --------------
function setLowShelf(stage: i32, freq: f32, gainDb: f32, slope: f32): void {
  const A: f32 = f32(Mathf.pow(10.0, gainDb / 40.0));
  let w0: f32 = f32(2.0 * PI * freq / sampleRate);
  if (w0 > f32(PI * 0.99)) w0 = f32(PI * 0.99);
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  // shelf slope S in (0,1]; alpha guarded
  let sq: f32 = (A + 1.0 / A) * (1.0 / slope - 1.0) + 2.0;
  if (sq < 0.0) sq = 0.0;
  const alpha: f32 = f32(sw / 2.0 * Mathf.sqrt(sq));
  const tsa: f32 = f32(2.0 * Mathf.sqrt(A) * alpha);

  const b0: f32 = f32(A * ((A + 1.0) - (A - 1.0) * cw + tsa));
  const b1: f32 = f32(2.0 * A * ((A - 1.0) - (A + 1.0) * cw));
  const b2: f32 = f32(A * ((A + 1.0) - (A - 1.0) * cw - tsa));
  const a0: f32 = f32((A + 1.0) + (A - 1.0) * cw + tsa);
  const a1: f32 = f32(-2.0 * ((A - 1.0) + (A + 1.0) * cw));
  const a2: f32 = f32((A + 1.0) + (A - 1.0) * cw - tsa);
  const inv: f32 = a0 != 0.0 ? f32(1.0 / a0) : 1.0;
  b0c[stage] = b0 * inv; b1c[stage] = b1 * inv; b2c[stage] = b2 * inv;
  a1c[stage] = a1 * inv; a2c[stage] = a2 * inv;
}

function setHighShelf(stage: i32, freq: f32, gainDb: f32, slope: f32): void {
  const A: f32 = f32(Mathf.pow(10.0, gainDb / 40.0));
  let w0: f32 = f32(2.0 * PI * freq / sampleRate);
  if (w0 > f32(PI * 0.99)) w0 = f32(PI * 0.99);
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  let sq: f32 = (A + 1.0 / A) * (1.0 / slope - 1.0) + 2.0;
  if (sq < 0.0) sq = 0.0;
  const alpha: f32 = f32(sw / 2.0 * Mathf.sqrt(sq));
  const tsa: f32 = f32(2.0 * Mathf.sqrt(A) * alpha);

  const b0: f32 = f32(A * ((A + 1.0) + (A - 1.0) * cw + tsa));
  const b1: f32 = f32(-2.0 * A * ((A - 1.0) + (A + 1.0) * cw));
  const b2: f32 = f32(A * ((A + 1.0) + (A - 1.0) * cw - tsa));
  const a0: f32 = f32((A + 1.0) - (A - 1.0) * cw + tsa);
  const a1: f32 = f32(2.0 * ((A - 1.0) - (A + 1.0) * cw));
  const a2: f32 = f32((A + 1.0) - (A - 1.0) * cw - tsa);
  const inv: f32 = a0 != 0.0 ? f32(1.0 / a0) : 1.0;
  b0c[stage] = b0 * inv; b1c[stage] = b1 * inv; b2c[stage] = b2 * inv;
  a1c[stage] = a1 * inv; a2c[stage] = a2 * inv;
}

function setPeak(stage: i32, freq: f32, gainDb: f32, q: f32): void {
  const A: f32 = f32(Mathf.pow(10.0, gainDb / 40.0));
  let w0: f32 = f32(2.0 * PI * freq / sampleRate);
  if (w0 > f32(PI * 0.99)) w0 = f32(PI * 0.99);
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const qg: f32 = q > 0.0001 ? q : 0.0001;
  const alpha: f32 = f32(sw / (2.0 * qg));

  const b0: f32 = f32(1.0 + alpha * A);
  const b1: f32 = f32(-2.0 * cw);
  const b2: f32 = f32(1.0 - alpha * A);
  const a0: f32 = f32(1.0 + alpha / A);
  const a1: f32 = f32(-2.0 * cw);
  const a2: f32 = f32(1.0 - alpha / A);
  const inv: f32 = a0 != 0.0 ? f32(1.0 / a0) : 1.0;
  b0c[stage] = b0 * inv; b1c[stage] = b1 * inv; b2c[stage] = b2 * inv;
  a1c[stage] = a1 * inv; a2c[stage] = a2 * inv;
}

function setBypass(stage: i32): void {
  b0c[stage] = 1.0; b1c[stage] = 0.0; b2c[stage] = 0.0;
  a1c[stage] = 0.0; a2c[stage] = 0.0;
}

export function process(n: i32): void {
  // ---- map params to musical ranges ----
  const lowN:    f32 = clampf(params[P_LOW_FREQ], 0.0, 1.0);
  const lowFreq: f32 = f32(20.0 + lowN * lowN * 140.0);      // 20..160 Hz
  const lowBoostDb: f32 = clampf(params[P_LOW_BOOST], 0.0, 1.0) * 14.0;
  const lowAttenDb: f32 = clampf(params[P_LOW_ATTEN], 0.0, 1.0) * 16.0;

  const hbN:  f32 = clampf(params[P_HBOOST_FRQ], 0.0, 1.0);
  const hbFreq: f32 = f32(3000.0 + hbN * hbN * 13000.0);     // 3..16 kHz
  const highBoostDb: f32 = clampf(params[P_HIGH_BOOST], 0.0, 1.0) * 16.0;
  const highAttenDb: f32 = clampf(params[P_HIGH_ATTEN], 0.0, 1.0) * 16.0;

  // STAGE 0: low shelf BOOST at lowFreq (gentle, broad).
  if (lowBoostDb > 0.001) setLowShelf(0, lowFreq, lowBoostDb, 0.5);
  else setBypass(0);

  // STAGE 1: low shelf CUT a little ABOVE the boost — this is the program-EQ
  // trick: the dip sits just above the bump, giving the resonant low end.
  const cutFreq: f32 = f32(clampf(lowFreq * 2.2, 30.0, 400.0));
  if (lowAttenDb > 0.001) setLowShelf(1, cutFreq, -lowAttenDb, 0.55);
  else setBypass(1);

  // STAGE 2: high PEAK boost (broad bell) at selectable centre.
  if (highBoostDb > 0.001) setPeak(2, hbFreq, highBoostDb, 0.9);
  else setBypass(2);

  // STAGE 3: high SHELF attenuation, fixed ~12 kHz, gentle.
  if (highAttenDb > 0.001) setHighShelf(3, 12000.0, -highAttenDb, 0.5);
  else setBypass(3);

  // slight makeup compensation so simultaneous boosts don't run hot
  const totalBoost: f32 = lowBoostDb + highBoostDb;
  let makeup: f32 = f32(Mathf.pow(10.0, -0.18 * totalBoost / 20.0));
  if (makeup < 0.25) makeup = 0.25;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    for (let f = 0; f < n; f++) {
      let s: f32 = inBuf[base + f];
      // cascade the four biquad stages
      for (let st = 0; st < NUM_STAGES; st++) {
        const si: i32 = st * MAX_CHANNELS + c;
        const x0: f32 = s;
        const y0: f32 = f32(
          b0c[st] * x0 + b1c[st] * x1s[si] + b2c[st] * x2s[si]
          - a1c[st] * y1s[si] - a2c[st] * y2s[si]
        );
        x2s[si] = x1s[si]; x1s[si] = x0;
        y2s[si] = y1s[si]; y1s[si] = y0;
        s = y0;
      }
      let o: f32 = f32(s * makeup);
      // safety soft limit (transparent until very hot)
      if (o > 1.6) o = 1.6;
      else if (o < -1.6) o = -1.6;
      outBuf[base + f] = o;
    }
  }
}
