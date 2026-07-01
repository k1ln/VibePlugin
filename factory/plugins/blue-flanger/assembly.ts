// =====================================================================
//  BLUE FLANGER — a deep, resonant, wide-stereo flanger (Boss BF-2
//  lineage). Distinct from the factory's other flangers by its lush,
//  watery voice: a long swept fractional delay (~0.3..12 ms) with a
//  strong RESONANT positive feedback that can ring into metallic
//  territory, and a stereo WIDTH control that offsets the LFO between
//  channels for the wide "underwater" spread. Triangle LFO around a
//  Manual base delay. Pure algorithm, no samples.
//  Controls: Rate, Depth, Feedback, Manual, Width, Mix.
// =====================================================================
const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

const DLY_LEN: i32 = 2048;
const dline:  StaticArray<f32> = new StaticArray<f32>(DLY_LEN * MAX_CHANNELS);

let sampleRate: f32 = 48000.0;
let channels: i32 = 2;

const writePos: StaticArray<i32> = new StaticArray<i32>(MAX_CHANNELS);
const lfoPhase: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);
const fbState:  StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

const P_RATE: i32 = 0; const P_DEPTH: i32 = 1; const P_FB: i32 = 2; const P_MANUAL: i32 = 3; const P_WIDTH: i32 = 4; const P_MIX: i32 = 5;

@inline function clampf(x: f32, lo: f32, hi: f32): f32 { return x < lo ? lo : (x > hi ? hi : x); }

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr > 0.0 ? sr : 48000.0;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) { writePos[c] = 0; lfoPhase[c] = 0.0; fbState[c] = 0.0; }
  for (let i = 0; i < DLY_LEN * MAX_CHANNELS; i++) dline[i] = 0.0;
  params[P_RATE] = 0.28; params[P_DEPTH] = 0.7; params[P_FB] = 0.6; params[P_MANUAL] = 0.25; params[P_WIDTH] = 0.5; params[P_MIX] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 6; }

export function process(n: i32): void {
  const rateN: f32   = clampf(params[P_RATE], 0.0, 1.0);
  const depthN: f32  = clampf(params[P_DEPTH], 0.0, 1.0);
  const fbN: f32     = clampf(params[P_FB], 0.0, 1.0);
  const manualN: f32 = clampf(params[P_MANUAL], 0.0, 1.0);
  const widthN: f32  = clampf(params[P_WIDTH], 0.0, 1.0);
  const mixN: f32    = clampf(params[P_MIX], 0.0, 1.0);

  const rate: f32 = 0.05 + rateN * 6.0;                    // Hz
  const lfoInc: f32 = rate / sampleRate;
  const baseMs: f32 = 0.3 + manualN * 7.0;
  const depthMs: f32 = depthN * 5.5;
  const fb: f32 = fbN * 0.92;                              // resonant positive feedback
  const wet: f32 = mixN;
  const dry: f32 = 1.0 - mixN * 0.5;
  const chOff: f32 = widthN * 0.5;                         // stereo LFO phase offset

  for (let c = 0; c < channels; c++) {
    let wp: i32 = writePos[c];
    let lp: f32 = lfoPhase[c] + (c == 1 ? chOff : 0.0); if (lp >= 1.0) lp -= 1.0;
    let fbs: f32 = fbState[c];
    const base: i32 = c * DLY_LEN;
    for (let i = 0; i < n; i++) {
      const x: f32 = inBuf[c * MAX_FRAMES + i];
      // triangle LFO 0..1
      const tri: f32 = lp < 0.5 ? (lp * 2.0) : (2.0 - lp * 2.0);
      const dms: f32 = baseMs + depthMs * tri;
      let dsamp: f32 = dms * 0.001 * sampleRate;
      if (dsamp < 1.0) dsamp = 1.0; if (dsamp > f32(DLY_LEN - 2)) dsamp = f32(DLY_LEN - 2);
      // write with feedback
      dline[base + wp] = x + fbs * fb;
      // fractional read
      let rp: f32 = f32(wp) - dsamp; if (rp < 0.0) rp += f32(DLY_LEN);
      let ri0: i32 = i32(rp); const frac: f32 = rp - f32(ri0);
      if (ri0 >= DLY_LEN) ri0 -= DLY_LEN;
      let ri1: i32 = ri0 + 1; if (ri1 >= DLY_LEN) ri1 -= DLY_LEN;
      const dl: f32 = dline[base + ri0] + (dline[base + ri1] - dline[base + ri0]) * frac;
      fbs = dl;
      let o: f32 = x * dry + dl * wet;
      if (o > 1.4) o = 1.4; else if (o < -1.4) o = -1.4;
      outBuf[c * MAX_FRAMES + i] = o;
      wp += 1; if (wp >= DLY_LEN) wp -= DLY_LEN;
      lp += lfoInc; if (lp >= 1.0) lp -= 1.0;
    }
    writePos[c] = wp;
    lfoPhase[c] = lfoPhase[c] + lfoInc * f32(n);
    while (lfoPhase[c] >= 1.0) lfoPhase[c] -= 1.0;
    fbState[c] = fbs;
  }
}
