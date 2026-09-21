// events-probe.ts — test fixture for the host's event delivery (tests/engine_test.cpp).
//
// Writes what it has been told straight into the audio, so the test can read
// back WHERE in the block each event landed:
//   left  = number of held notes, plus the transport's ppq while playing
//   right = last CC1 value, plus pitch bend, plus 10 × channel pressure
//   display[0] = held notes, display[15] = 42 (engine → GUI channel check)
// Not a musical plugin.

const MAX_FRAMES: i32 = 8192;
const MAX_PARAMS: i32 = 64;

const inBuf  = new StaticArray<f32>(MAX_FRAMES * 2);
const outBuf = new StaticArray<f32>(MAX_FRAMES * 2);
const params = new StaticArray<f32>(MAX_PARAMS);
const display = new StaticArray<f32>(16);   // [0] held notes, [15] = 42 marker

let held: i32 = 0;
let cc1: f32 = 0;
let bend: f32 = 0;
let pressure: f32 = 0;
let playing: i32 = 0;
let ppq: f64 = 0;

export function init(sampleRate: f32, maxFrames: i32, numChannels: i32): void {
  held = 0; cc1 = 0; bend = 0; pressure = 0; playing = 0; ppq = 0;
}

export function process(numFrames: i32): void {
  const left: f32 = f32(held) + (playing != 0 ? f32(ppq) : 0);
  display[0] = f32(held);
  display[15] = 42;
  const right: f32 = cc1 + bend + pressure * 10;
  for (let f = 0; f < numFrames; f++) {
    unchecked(outBuf[f] = left);
    unchecked(outBuf[MAX_FRAMES + f] = right);
  }
}

export function noteOn(noteId: i32, freq: f32, velocity: f32): void { held++; }
export function noteOff(noteId: i32): void { if (held > 0) held--; }

export function controlChange(num: i32, value: f32): void {
  if (num == 1) cc1 = value;
  else if (num == 128) bend = value;
  else if (num == 129) pressure = value;
}

export function transport(isPlaying: i32, pos: f64, bpm: f32): void {
  playing = isPlaying;
  ppq = pos;
}

export function getInputPtr(): usize  { return changetype<usize>(inBuf); }
export function getOutputPtr(): usize { return changetype<usize>(outBuf); }
export function getParamsPtr(): usize { return changetype<usize>(params); }
export function getNumParams(): i32   { return 0; }
export function getDisplayPtr(): usize { return changetype<usize>(display); }
