// =====================================================================
//  AIR LIFT — air-band shelving EQ, the silky high-shelf specialist
//  A clean mastering-grade tilt EQ centred on a very-high "AIR" band: a
//  gentle, WIDE high shelf whose corner can be pushed up into the very top
//  octaves so it opens and brightens air without any harshness. Beneath it
//  sit a musical LOW SHELF and a broad MID BELL, plus an OUTPUT trim. All
//  bands are stable RBJ biquads in Direct-Form I, run in pure f32, with a
//  deliberately soft shelf slope so the air "lifts" rather than spikes.
//  Pure algorithm, no samples. No allocation in process().
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
const P_AIR:      i32 = 0; // 0..1  -> air high-shelf gain   0..+14 dB
const P_AIR_FREQ: i32 = 1; // 0..4  -> air corner selector: 2.5k/5k/10k/20k/40k
const P_LOW:      i32 = 2; // 0..1  -> low shelf            -12..+12 dB (corner ~120 Hz)
const P_MID:      i32 = 3; // 0..1  -> broad mid bell        -12..+12 dB (~900 Hz, wide)
const P_OUTPUT:   i32 = 4; // 0..1  -> output trim           ~ -inf..+6 dB (0.5 = unity)

const PI: f32 = 3.14159265358979;

// ---- per-channel Direct-Form I biquad state (x1,x2,y1,y2) ----
// three cascaded bands: 0 = low shelf, 1 = mid bell, 2 = air high shelf
const lsX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lsX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lsY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const lsY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const mdX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const mdY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const arX1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const arX2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const arY1: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const arY2: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// ---- shared coefficient registers (recomputed once per process block) ----
let ls_b0: f32 = 1.0; let ls_b1: f32 = 0.0; let ls_b2: f32 = 0.0;
let ls_a1: f32 = 0.0; let ls_a2: f32 = 0.0;

let md_b0: f32 = 1.0; let md_b1: f32 = 0.0; let md_b2: f32 = 0.0;
let md_a1: f32 = 0.0; let md_a2: f32 = 0.0;

let ar_b0: f32 = 1.0; let ar_b1: f32 = 0.0; let ar_b2: f32 = 0.0;
let ar_a1: f32 = 0.0; let ar_a2: f32 = 0.0;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) {
    lsX1[c] = 0.0; lsX2[c] = 0.0; lsY1[c] = 0.0; lsY2[c] = 0.0;
    mdX1[c] = 0.0; mdX2[c] = 0.0; mdY1[c] = 0.0; mdY2[c] = 0.0;
    arX1[c] = 0.0; arX2[c] = 0.0; arY1[c] = 0.0; arY2[c] = 0.0;
  }
  params[P_AIR]      = 0.45; // a touch of air
  params[P_AIR_FREQ] = 2.0;  // 10 kHz corner (the classic air seat)
  params[P_LOW]      = 0.5;  // flat
  params[P_MID]      = 0.5;  // flat
  params[P_OUTPUT]   = 0.5;  // unity
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

// dB -> linear amplitude
@inline function dbToGain(db: f32): f32 {
  return f32(Mathf.exp(db * 0.11512925)); // ln(10)/20
}

// ---- coefficient builders (RBJ cookbook, normalised by a0) -----------
// shelfS controls slope: smaller S = gentler / wider shelf (more "open").
function computeLowShelf(f0: f32, dbGain: f32, shelfS: f32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(dbGain)));
  const w0: f32 = 2.0 * PI * f0 / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const alpha: f32 = sw * 0.5 * f32(Mathf.sqrt((A + 1.0 / A) * (1.0 / shelfS - 1.0) + 2.0));
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

function computeHighShelf(f0: f32, dbGain: f32, shelfS: f32): void {
  const A: f32 = f32(Mathf.sqrt(dbToGain(dbGain)));
  const w0: f32 = 2.0 * PI * f0 / sampleRate;
  const cw: f32 = f32(Mathf.cos(w0));
  const sw: f32 = f32(Mathf.sin(w0));
  const alpha: f32 = sw * 0.5 * f32(Mathf.sqrt((A + 1.0 / A) * (1.0 / shelfS - 1.0) + 2.0));
  const tsa: f32 = 2.0 * f32(Mathf.sqrt(A)) * alpha;

  const b0: f32 =      A * ((A + 1.0) + (A - 1.0) * cw + tsa);
  const b1: f32 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cw);
  const b2: f32 =      A * ((A + 1.0) + (A - 1.0) * cw - tsa);
  const a0: f32 =           (A + 1.0) - (A - 1.0) * cw + tsa;
  const a1: f32 =  2.0 *    ((A - 1.0) - (A + 1.0) * cw);
  const a2: f32 =           (A + 1.0) - (A - 1.0) * cw - tsa;
  const inv: f32 = a0 != 0.0 ? f32(1.0 / a0) : 1.0;

  ar_b0 = b0 * inv; ar_b1 = b1 * inv; ar_b2 = b2 * inv;
  ar_a1 = a1 * inv; ar_a2 = a2 * inv;
}

export function process(n: i32): void {
  // --- map params to musical ranges -----------------------------------
  // Air is a boost-only silky high shelf: 0 .. +14 dB.
  const airDb:  f32 = clampf(params[P_AIR], 0.0, 1.0) * 14.0;
  // Low / Mid are bipolar: -12 .. +12 dB (0.5 = flat).
  const lowDb:  f32 = (clampf(params[P_LOW], 0.0, 1.0) - 0.5) * 24.0;
  const midDb:  f32 = (clampf(params[P_MID], 0.0, 1.0) - 0.5) * 24.0;
  const outN:   f32 = clampf(params[P_OUTPUT], 0.0, 1.0);

  // Air-frequency selector: discrete classic corners up into the highs.
  // 0=2.5k 1=5k 2=10k 3=20k 4=40k. The two top seats are above audio range,
  // so the shelf's wide skirt reaches DOWN into the air band — exactly the
  // "open the top, no spike" behaviour of an air-band EQ.
  let sel: i32 = i32(params[P_AIR_FREQ] + 0.5);
  if (sel < 0) sel = 0;
  if (sel > 4) sel = 4;
  let airHz: f32 = 10000.0;
  if (sel == 0) airHz = 2500.0;
  else if (sel == 1) airHz = 5000.0;
  else if (sel == 2) airHz = 10000.0;
  else if (sel == 3) airHz = 20000.0;
  else airHz = 40000.0;

  // Keep every corner safely below Nyquist so the biquad stays stable.
  const nyq: f32 = sampleRate * 0.49;
  if (airHz > nyq) airHz = nyq;

  // Fixed musical corners for the other bands.
  let lowHz: f32 = 120.0;
  let midHz: f32 = 900.0;
  if (lowHz < 20.0) lowHz = 20.0;
  if (midHz > nyq) midHz = nyq;

  // Output trim: 0.5 -> unity, 1 -> +6 dB, 0 -> silence.
  const outGain: f32 = outN <= 0.5
    ? outN * 2.0
    : 1.0 + (outN - 0.5) * 2.0; // up to 2.0x (~+6 dB)

  // Wide, gentle shelves so the air "lifts" instead of spiking; broad bell.
  computeLowShelf(lowHz, lowDb, 0.55);
  computeMidBell(midHz, midDb, 0.5);   // broad bell (Q ~0.5)
  computeHighShelf(airHz, airDb, 0.45); // very gentle, wide air shelf

  // Headroom trim so simultaneous big boosts stay below ~1.0 peak.
  const headroom: f32 = 0.9;

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;

    let lx1: f32 = lsX1[c]; let lx2: f32 = lsX2[c]; let ly1: f32 = lsY1[c]; let ly2: f32 = lsY2[c];
    let mx1: f32 = mdX1[c]; let mx2: f32 = mdX2[c]; let my1: f32 = mdY1[c]; let my2: f32 = mdY2[c];
    let hx1: f32 = arX1[c]; let hx2: f32 = arX2[c]; let hy1: f32 = arY1[c]; let hy2: f32 = arY2[c];

    for (let f = 0; f < n; f++) {
      const x: f32 = inBuf[base + f];

      // low shelf
      let y: f32 = ls_b0 * x + ls_b1 * lx1 + ls_b2 * lx2 - ls_a1 * ly1 - ls_a2 * ly2;
      lx2 = lx1; lx1 = x; ly2 = ly1; ly1 = y;

      // mid bell
      const mIn: f32 = y;
      let ym: f32 = md_b0 * mIn + md_b1 * mx1 + md_b2 * mx2 - md_a1 * my1 - md_a2 * my2;
      mx2 = mx1; mx1 = mIn; my2 = my1; my1 = ym;

      // air high shelf
      const hIn: f32 = ym;
      let yh: f32 = ar_b0 * hIn + ar_b1 * hx1 + ar_b2 * hx2 - ar_a1 * hy1 - ar_a2 * hy2;
      hx2 = hx1; hx1 = hIn; hy2 = hy1; hy1 = yh;

      // clean output: trim + headroom, hard-bounded so it never clips past 1.
      const o: f32 = yh * outGain * headroom;
      outBuf[base + f] = clampf(o, -1.0, 1.0);
    }

    lsX1[c] = lx1; lsX2[c] = lx2; lsY1[c] = ly1; lsY2[c] = ly2;
    mdX1[c] = mx1; mdX2[c] = mx2; mdY1[c] = my1; mdY2[c] = my2;
    arX1[c] = hx1; arX2[c] = hx2; arY1[c] = hy1; arY2[c] = hy2;
  }
}
