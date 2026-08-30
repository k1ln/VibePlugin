// =====================================================================
//  AssemblyScript DSP module template  (compiles to WASM via `asc`)
//
//  This is the *shape* every Claude-generated module follows. It implements
//  the ABI described in src/WasmAbi.h. The example DSP here is a simple
//  stereo gain + one-pole low-pass so you can hear something immediately;
//  Claude replaces the body of `process()` and the parameter wiring.
//
//  Rules the generated code must obey:
//   - No imports. Self-contained. No host calls, no JS, no WASI.
//   - Planar f32 buffers, layout: base + (channel * MAX_FRAMES + frame) * 4.
//   - Never write past MAX_FRAMES / MAX_CHANNELS.
//   - process() must be allocation-free and must not block.
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

// --- Static buffers (their addresses never move after start) ----------
// StaticArray<f32> stores its elements inline starting at the object
// pointer, so changetype<usize>(buf) is the address of element 0.
const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

// --- DSP state --------------------------------------------------------
let sampleRate: f32 = 44100.0;
let channels: i32 = 2;
let lpState: StaticArray<f32> = new StaticArray<f32>(MAX_CHANNELS);

// Parameter indices (must match the indices the generated HTML sends).
const P_GAIN: i32 = 0;   // 0..2  (linear, 1 = unity)
const P_CUTOFF: i32 = 1; // 0..1  (1 = wide open)

// --- ABI exports ------------------------------------------------------

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr;
  channels = numChannels < MAX_CHANNELS ? numChannels : MAX_CHANNELS;
  for (let c = 0; c < MAX_CHANNELS; c++) lpState[c] = 0.0;

  // sensible defaults
  params[P_GAIN] = 1.0;
  params[P_CUTOFF] = 1.0;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 2; }

export function process(numFrames: i32): void {
  const gain: f32 = params[P_GAIN];
  // map cutoff 0..1 to a one-pole coefficient
  const cutoff: f32 = params[P_CUTOFF];
  const coeff: f32 = cutoff <= 0.0 ? 0.0 : (cutoff >= 1.0 ? 1.0 : cutoff);

  for (let c = 0; c < channels; c++) {
    const base: i32 = c * MAX_FRAMES;
    let z: f32 = lpState[c];
    for (let f = 0; f < numFrames; f++) {
      const x: f32 = inBuf[base + f];
      z = z + coeff * (x - z);     // one-pole low-pass
      outBuf[base + f] = z * gain;
    }
    lpState[c] = z;
  }
}
