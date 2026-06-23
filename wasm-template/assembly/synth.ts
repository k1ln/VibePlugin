// =====================================================================
//  Reference INSTRUMENT module (monophonic saw + AR envelope).
//  Implements the VibePlugin WASM ABI plus the synth note exports. The host
//  converts MIDI note numbers to frequency (Hz) and calls noteOn/noteOff.
//  Compiled to WASM in-process by asc.wasm (see wasm-toolchain/).
// =====================================================================

const MAX_FRAMES: i32 = 8192;
const MAX_CHANNELS: i32 = 2;
const MAX_PARAMS: i32 = 64;

const inBuf:  StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const outBuf: StaticArray<f32> = new StaticArray<f32>(MAX_FRAMES * MAX_CHANNELS);
const params: StaticArray<f32> = new StaticArray<f32>(MAX_PARAMS);

let sampleRate: f32 = 44100;
let phase: f32 = 0;
let freq:  f32 = 0;
let env:   f32 = 0;   // current envelope level
let vel:   f32 = 0;   // gate target while held
let gate:  i32 = 0;   // 1 while a note is held
let note:  i32 = -1;  // currently sounding note id

const P_LEVEL: i32 = 0;

export function init(sr: f32, maxFrames: i32, numChannels: i32): void {
  sampleRate = sr;
  phase = 0; env = 0; gate = 0; note = -1;
  params[P_LEVEL] = 0.5;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 1; }

// Host passes frequency in Hz (no note->Hz math needed in the module).
export function noteOn(id: i32, f: f32, v: f32): void { note = id; freq = f; vel = v; gate = 1; }
export function noteOff(id: i32): void { if (id == note) gate = 0; }

export function process(n: i32): void {
  const gain: f32 = params[P_LEVEL];
  const inc:  f32 = freq / sampleRate;
  const tgt:  f32 = gate ? vel : 0.0;

  for (let f = 0; f < n; f++) {
    env = env + 0.001 * (tgt - env);        // ~20 ms attack/release
    phase += inc; if (phase >= 1.0) phase -= 1.0;
    const saw: f32 = phase * 2.0 - 1.0;       // naive saw (no transcendentals)
    const s: f32 = saw * env * gain;
    outBuf[f] = s;                            // left
    outBuf[MAX_FRAMES + f] = s;               // right
  }
}
