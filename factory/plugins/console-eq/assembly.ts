// =====================================================================
//  CONSOLE EQ — class-A console channel equaliser
//  A three-band program EQ modelled on a vintage broadcast console strip:
//  a musical LOW SHELF, a sweepable MID BELL with proportional-Q (the bell
//  narrows as you push it, the way an inductor-coupled console band does),
//  and a HIGH SHELF with an "air" lift. The whole strip runs through a gentle
//  class-A style transformer/op-amp saturation (DRIVE) for analog weight.
//  Bands are stable RBJ biquads in Direct-Form I. Pure algorithm, no samples.
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
const P_LOW_GAIN:  i32 = 0; // 0..1 -> low shelf  -12..+12 dB  (corner ~100 Hz)
const P_MID_FREQ:  i32 = 1; // 0..1 -> mid bell centre 220..7000 Hz (log)
const P_MID_GAIN:  i32 = 2; // 0..1 -> mid bell   -15..+15 dB  (proportional-Q)
const P_HIGH_GAIN: i32 = 3; // 0..1 -> high shelf -12..+15 dB  (air, corner ~10 kHz)
const P_DRIVE:     i32 = 4; // 0..1 -> class-A saturation amount

const PI: f32 = 3.14159265358979;

// ---- per-channel Direct-Form I biquad state (x[n-1],x[n-2],y[n-1],y[n-2]) ----
// three cascaded bands: 0 = low shelf, 1 = mid bell, 2 = high shelf
const lsX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lsX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lsY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lsY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const mdX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const hsX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hsX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hsY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const hsY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// ---- shared coefficient registers (recomputed once per process block) ----
// low shelf
let ls_b0: f32 = 1.0; let ls_b1: f32 = 0.0; let ls_b2: f32 = 0.0;
let ls_a1: f32 = 0.0; let ls_a2: f32 = 0.0;
// mid bell
let md_b0: f32 = 1.0; let md_b1: f32 = 0.0; let md_b2: f32 = 0.0;
let md_a1: f32 = 0.0; let md_a2: f32 = 0.0;
// high shelf
let hs_b0: f32 = 1.0; let hs_b1: f32 = 0.0; let hs_b2: f32 = 0.0;
let hs_a1: f32 = 0.0; let hs_a2: f32 = 0.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    lsX1[c] = 0.0; lsX2[c] = 0.0; lsY1[c] = 0.0; lsY2[c] = 0.0;
    mdX1[c] = 0.0; mdX2[c] = 0.0; mdY1[c] = 0.0; mdY2[c] = 0.0;
    hsX1[c] = 0.0; hsX2[c] = 0.0; hsY1[c] = 0.0; hsY2[c] = 0.0;
  }
  params[P_LOW_GAIN]  = 0.5;  // flat
  params[P_MID_FREQ]  = 0.45; // ~1 kHz region
  params[P_MID_GAIN]  = 0.5;  // flat
  params[P_HIGH_GAIN] = 0.5;  // flat
  params[P_DRIVE]     = 0.25; // a touch of analog weight
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// dB -> linear amplitude
@inline function dbToGain(db: f32): f32 {
  return f32(Mathf.exp(db * 0.11512925)); // ln(10)/20
}

// class-A style asymmetric soft saturation: warm, harmonically rich,
// bounded to roughly ±1.1 so the output never runs away.
@inline function saturate(x: f32, amt: f32): f32 {
  // amt 0 -> near transparent, 1 -> noticeable transformer warmth
  const k: f32 = 1.0 + amt * 3.0;
  const t: f32 = f32(Mathf.tanh(x * k));
  // gentle even-harmonic asymmetry for "class-A" feel
  const asym: f32 = amt * 0.10 * (t * t - 0.5);
  // blend dry/driven and compensate the make-up of tanh so level stays put
  const driven: f32 = (t + asym) / k;
  return x + amt * (driven - x);
}

// ---- coefficient builders (RBJ cookbook, normalised by a0) -----------
function computeLowShelf(f0: f32, dbGain: f32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(dbGain)));
  const w0: f32 = 2.0 * PI * f0 / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const S: f32 = 0.8; // shelf slope (broad, console-like)
  const alpha: f32 = sw * 0.5 * f32(Mathf.sqrt((A + 1.0 / A) * (1.0 / S - 1.0) + 2.0));
  const tsa: f32 = 2.0 * f32(Mathf.sqrt(A)) * alpha;

  const b0: f32 =      A * ((A + 1.0) - (A - 1.0) * cw + tsa);
  const b1: f32 =  2.0 * A * ((A - 1.0) - (A + 1.0) * cw);
  const b2: f32 =      A * ((A + 1.0) - (A - 1.0) * cw - tsa);
  const a0: f32 =           (A + 1.0) + (A - 1.0) * cw + tsa;
  const a1: f32 = -2.0 *    ((A - 1.0) + (A + 1.0) * cw);
  const a2: f32 =           (A + 1.0) + (A - 1.0) * cw - tsa;
  const inv: f32 = a0 != 0.0 ? f32(1.0 / a0) : 1.0;

  ls_b0 = b0 * inv; ls_b1 = b1 * inv; ls_b2 = b2 * inv;
  ls_a1 = a1 * inv; ls_a2 = a2 * inv;
}

function computeMidBell(f0: f32, dbGain: f32, q: f32): void {
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

  md_b0 = b0 * inv; md_b1 = b1 * inv; md_b2 = b2 * inv;
  md_a1 = a1 * inv; md_a2 = a2 * inv;
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

  hs_b0 = b0 * inv; hs_b1 = b1 * inv; hs_b2 = b2 * inv;
  hs_a1 = a1 * inv; hs_a2 = a2 * inv;
}

export function process(n: i32): void {
  // --- map params to musical ranges -----------------------------------
  const lowDb:  f32 = (clampf(params[P_LOW_GAIN],  0.0, 1.0) - 0.5) * 24.0;   // -12..+12
  const midN:   f32 = clampf(params[P_MID_FREQ],   0.0, 1.0);
  const midDb:  f32 = (clampf(params[P_MID_GAIN],  0.0, 1.0) - 0.5) * 30.0;   // -15..+15
  const highDb: f32 = (clampf(params[P_HIGH_GAIN], 0.0, 1.0) - 0.5) * 27.0;   // -13.5..+13.5
  const drive:  f32 = clampf(params[P_DRIVE],      0.0, 1.0);

  // log-sweep the mid centre 220 Hz .. 7000 Hz, clamped below Nyquist
  let midHz: f32 = f32(220.0 * Mathf.exp(midN * 3.456)); // 220 * (7000/220)^midN
  const nyq: f32 = sampleRate * 0.45;
  if (midHz > nyq) midHz = nyq;
  if (midHz < 20.0) midHz = 20.0;

  // proportional-Q: gentle at small boosts, tighter as you push it,
  // the way a console's inductor band narrows with drive.
  const adb: f32 = midDb < 0.0 ? -midDb : midDb;
  const midQ: f32 = clampf(0.5 + adb * 0.13, 0.4, 4.0);

  // fixed shelf corners, console-style
  let lowHz: f32 = 100.0;
  let highHz: f32 = 10000.0;
  if (highHz > nyq) highHz = nyq;
  if (lowHz < 20.0) lowHz = 20.0;

  computeLowShelf(lowHz, lowDb);
  computeMidBell(midHz, midDb, midQ);
  computeHighShelf(highHz, highDb);

  // a tiny output trim so heavy simultaneous boosts + drive stay <~1.0 peak
  const outTrim: f32 = 0.85;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;

    let lx1: f32 = lsX1[c]; let lx2: f32 = lsX2[c]; let ly1: f32 = lsY1[c]; let ly2: f32 = lsY2[c];
    let mx1: f32 = mdX1[c]; let mx2: f32 = mdX2[c]; let my1: f32 = mdY1[c]; let my2: f32 = mdY2[c];
    let hx1: f32 = hsX1[c]; let hx2: f32 = hsX2[c]; let hy1: f32 = hsY1[c]; let hy2: f32 = hsY2[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // low shelf
      let y: f32 = ls_b0 * x + ls_b1 * lx1 + ls_b2 * lx2 - ls_a1 * ly1 - ls_a2 * ly2;
      lx2 = lx1; lx1 = x; ly2 = ly1; ly1 = y;

      // mid bell
      const mIn: f32 = y;
      let ym: f32 = md_b0 * mIn + md_b1 * mx1 + md_b2 * mx2 - md_a1 * my1 - md_a2 * my2;
      mx2 = mx1; mx1 = mIn; my2 = my1; my1 = ym;

      // high shelf
      const hIn: f32 = ym;
      let yh: f32 = hs_b0 * hIn + hs_b1 * hx1 + hs_b2 * hx2 - hs_a1 * hy1 - hs_a2 * hy2;
      hx2 = hx1; hx1 = hIn; hy2 = hy1; hy1 = yh;

      // class-A style saturation across the whole strip
      let s: f32 = saturate(yh, drive);

      outBuf[base + f] = clampf(s * outTrim, -1.2, 1.2);
    }

    lsX1[c] = lx1; lsX2[c] = lx2; lsY1[c] = ly1; lsY2[c] = ly2;
    mdX1[c] = mx1; mdX2[c] = mx2; mdY1[c] = my1; mdY2[c] = my2;
    hsX1[c] = hx1; hsX2[c] = hx2; hsY1[c] = hy1; hsY2[c] = hy2;
  }
}
