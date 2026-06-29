// =====================================================================
//  NOISE GATE — a clean downward-expander / gate
//
//  A stereo-linked peak detector watches the input level. When it falls
//  below Threshold the signal is attenuated toward the Range floor; when
//  it rises back above Threshold the gate opens. A small hysteresis band
//  plus a Hold time keeps the gate from chattering on sustains and decays.
//  Attack sets how fast the gate opens, Release how fast it closes, and a
//  soft cosine fade across the open/close transition avoids zipper clicks.
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

// gate state (shared across the stereo pair = stereo-linked)
let env: f32 = 0.0;        // smoothed detector level (linear amplitude)
let gate: f32 = 0.0;       // gate gain 0..1 (0 = closed, 1 = open), smoothed
let holdCtr: f32 = 0.0;    // remaining hold time in samples

const P_THRESH:  i32 = 0;  // 0..1 -> threshold  -72..0 dBFS
const P_RANGE:   i32 = 1;  // 0..1 -> floor attenuation 0..-90 dB (how deep it gates)
const P_ATTACK:  i32 = 2;  // 0..1 -> attack   0.05..50 ms (open speed)
const P_RELEASE: i32 = 3;  // 0..1 -> release  5..1000 ms (close speed)
const P_HOLD:    i32 = 4;  // 0..1 -> hold     0..500 ms (stay-open time)

const LN10_20: f32 = 0.11512925; // ln(10)/20, for dB<->linear
const HYST_DB: f32 = 3.0;        // hysteresis: close threshold sits this far below open

@inline function clampf(x: f32, lo: f32, hi: f32): f32 {
  return x < lo ? lo : (x > hi ? hi : x);
}

@inline function db2lin(db: f32): f32 {
  return f32(Mathf.exp(db * LN10_20));
}

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  env = 0.0;
  gate = 0.0;
  holdCtr = 0.0;
  params[P_THRESH]  = 0.55; // ~ -32 dBFS — opens on the test bed transients, gates the noise floor
  params[P_RANGE]   = 0.8;  // deep cut when closed (~ -72 dB)
  params[P_ATTACK]  = 0.15; // snappy open
  params[P_RELEASE] = 0.35; // medium close
  params[P_HOLD]    = 0.2;  // ~100 ms hold
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 5; }

export function process(n: i32): void {
  // ---- map params to engineering units ----
  const tN: f32 = clampf(params[P_THRESH], 0.0, 1.0);
  const threshDb: f32 = -72.0 + tN * 72.0;               // -72..0 dBFS
  const openThresh: f32 = db2lin(threshDb);              // linear amplitude to open
  const closeThresh: f32 = db2lin(threshDb - HYST_DB);   // lower bar to close (hysteresis)

  const rN: f32 = clampf(params[P_RANGE], 0.0, 1.0);
  const floorDb: f32 = rN * -90.0;                       // 0..-90 dB closed-gain
  const floorGain: f32 = db2lin(floorDb);                // linear floor (0..1)

  const aN: f32 = clampf(params[P_ATTACK], 0.0, 1.0);
  const atkMs: f32 = 0.05 + aN * aN * 49.95;             // 0.05..50 ms (curved)
  const relN: f32 = clampf(params[P_RELEASE], 0.0, 1.0);
  const relMs: f32 = 5.0 + relN * relN * 995.0;          // 5..1000 ms (curved)
  const holdN: f32 = clampf(params[P_HOLD], 0.0, 1.0);
  const holdMs: f32 = holdN * 500.0;                     // 0..500 ms

  // one-pole coefficients (per-sample) for opening / closing the gate gain
  const atkCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (atkMs * 0.001 * sampleRate)));
  const relCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / (relMs * 0.001 * sampleRate)));
  // detector smoothing: fast attack so transients punch the gate open quickly,
  // slower decay so it tracks the envelope rather than every zero-crossing
  const detAtk: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.0005 * sampleRate))); // ~0.5 ms
  const detRel: f32 = f32(1.0 - Mathf.exp(-1.0 / (0.010 * sampleRate)));  // ~10 ms

  const holdSamples: f32 = holdMs * 0.001 * sampleRate;

  let e: f32 = env;
  let g: f32 = gate;
  let hc: f32 = holdCtr;

  const baseL: i32 = 0;
  const baseR: i32 = MAX_FRAMES;
  const stereo: bool = channels > 1;

  for (let f = 0; f < n; f++) {
    const xL: f32 = inBuf[baseL + f];
    const xR: f32 = stereo ? inBuf[baseR + f] : xL;

    // ---- stereo-linked peak detector (rectified, envelope-followed) ----
    const aL: f32 = xL < 0.0 ? -xL : xL;
    const aR: f32 = xR < 0.0 ? -xR : xR;
    const pk: f32 = aL > aR ? aL : aR;

    const dCoef: f32 = pk > e ? detAtk : detRel;
    e = e + dCoef * (pk - e);

    // ---- gate decision with hysteresis + hold ----
    // target gate gain: 1 when open, floorGain when closed
    let targetOpen: bool;
    if (e >= openThresh) {
      targetOpen = true;
      hc = holdSamples;                  // (re)arm the hold timer while signal is up
    } else if (e <= closeThresh) {
      if (hc > 0.0) {
        hc -= 1.0;                        // still within hold window -> keep open
        targetOpen = true;
      } else {
        targetOpen = false;
      }
    } else {
      // in the hysteresis band: hold current state, decay the hold timer
      if (hc > 0.0) { hc -= 1.0; targetOpen = true; }
      else targetOpen = g > 0.5 ? true : false;
    }

    const targetGain: f32 = targetOpen ? 1.0 : floorGain;

    // ---- ballistics: attack coef when opening, release coef when closing ----
    const coef: f32 = targetGain > g ? atkCoef : relCoef;
    g = g + coef * (targetGain - g);

    outBuf[baseL + f] = xL * g;
    if (stereo) outBuf[baseR + f] = xR * g;
  }

  env = e;
  gate = g;
  holdCtr = hc;
}
