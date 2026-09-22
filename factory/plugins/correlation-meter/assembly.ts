// =====================================================================
//  CORRELATION METER — a phase/correlation meter with a live goniometer.
//  Correlation is a running Pearson-style coefficient from exponential
//  moving averages of L*R, L^2 and R^2: corr = E[LR]/sqrt(E[L^2]*E[R^2]).
//  The goniometer packs ~7 evenly-spaced (X,Y) sample pairs per block
//  into the getDisplayPtr() telemetry channel for the GUI to accumulate
//  into a fading-trail scatter plot - Goniometer mode uses the standard
//  45-degree-rotated Mid/Side basis (X=Side, Y=Mid, so mono collapses to
//  a vertical line); Lissajous mode plots raw L/R (mono draws a 45-degree
//  diagonal instead). The meter always analyzes the true, pre-sum L/R
//  signal - Mono Check only changes what you HEAR (sums L+R to both
//  output channels), not what the meter measures, so you can audition
//  mono compatibility while still seeing the real stereo relationship
//  that's causing it.
//  Original implementation, no code or samples borrowed.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);
const display: StaticArray<f32> = new StaticArray<f32>(16);

const P_MONO:  i32 = 0;
const P_BALL:  i32 = 1;
const P_MODE:  i32 = 2;   // 0 goniometer (M/S), 1 lissajous (L/R)
const P_FREEZE:i32 = 3;
const NUM_PARAMS: i32 = 4;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

let emaLR: f32 = 0.0;
let emaLL: f32 = 0.0;
let emaRR: f32 = 0.0;
let correlation: f32 = 0.0;

const NPTS: i32 = 7;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  emaLR = 0.0; emaLL = 0.0; emaRR = 0.0; correlation = 0.0;
  for (let k = 0; k < 16; k++) display[k] = 0.0;

  params[P_MONO] = 0.0; params[P_BALL] = 0.4; params[P_MODE] = 0.0; params[P_FREEZE] = 0.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return NUM_PARAMS; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }

export function process(n: i32): void {
  const monoCheck: bool = params[P_MONO] > 0.5;
  const ballN: f32 = clampf(params[P_BALL], 0.0, 1.0);
  const mode: bool = params[P_MODE] > 0.5;   // false = goniometer, true = lissajous
  const frozen: bool = params[P_FREEZE] > 0.5;

  const ballCoef: f32 = f32(1.0 - Mathf.exp(-1.0 / ((0.01 + ballN * 0.4) * sampleRate)));
  const stride: i32 = n / NPTS > 0 ? n / NPTS : 1;

  let ptIdx: i32 = 0;

  for (let i = 0; i < n; i++) {
    const l: f32 = inBuf[i];
    const r: f32 = channels > 1 ? inBuf[MAX_FRAMES + i] : l;

    if (monoCheck) { const mid: f32 = (l + r) * 0.5; outBuf[i] = mid; outBuf[MAX_FRAMES + i] = mid; }
    else { outBuf[i] = l; outBuf[MAX_FRAMES + i] = r; }

    if (!frozen) {
      emaLR = f32(emaLR + (l * r - emaLR) * ballCoef);
      emaLL = f32(emaLL + (l * l - emaLL) * ballCoef);
      emaRR = f32(emaRR + (r * r - emaRR) * ballCoef);
      const denom: f32 = f32(Mathf.sqrt(emaLL * emaRR) + 0.0000001);
      correlation = clampf(emaLR / denom, -1.0, 1.0);

      if (i % stride == 0 && ptIdx < NPTS) {
        let x: f32; let y: f32;
        if (mode) { x = l; y = r; }
        else { x = f32((l - r) * 0.70710678); y = f32((l + r) * 0.70710678); }
        const base: i32 = 1 + ptIdx * 2;
        display[base] = clampf(x, -1.0, 1.0);
        display[base + 1] = clampf(y, -1.0, 1.0);
        ptIdx += 1;
      }
    }
  }

  display[0] = correlation;
}
