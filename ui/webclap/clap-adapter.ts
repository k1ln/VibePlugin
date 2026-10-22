// =====================================================================
//  clap-adapter.ts — wraps a VibePlugin DSP module as a WebCLAP plugin.
//
//  Compiled together with the plugin's own AssemblyScript (as "./plugin") and a
//  generated "./meta" (name, id, parameter table) by the bundled asc, using
//  `--exportTable`; the driver then renames the table export and makes it growable
//  (see compiler/asc-driver.mjs). The result is a module.wasm a WebCLAP host can
//  load: it exports clap_entry, malloc, memory and __indirect_function_table and
//  imports nothing.
//
//  The adapter speaks the WasmAbi.h contract to the plugin and CLAP to the host:
//    audio in/out   planar f32 blocks copied between the CLAP buffers and the module
//    notes / MIDI   sample-accurate slices, host-side sustain pedal (MidiRouter.h)
//    parameters     the plugin's own indices are the CLAP ids, values in plugin units
//    state          the parameter values
//    webview        a tiny binary protocol to the GUI page (ui/webclap/shim.js)
//
//  Struct offsets are wasm32 offsets of the CLAP headers.
// =====================================================================

import * as P from "./plugin";
import { NAME, ID, VENDOR, VERSION, IS_SYNTH, NUM_PARAMS, UI_W, UI_H,
         PARAM_NAMES, PARAM_INDEX, PARAM_MIN, PARAM_MAX, PARAM_DEF, PARAM_VAL } from "./meta";

// ---- function types the host hands us as table indices -------------------
type HostGetExt   = (host: usize, id: usize) => usize;
type HostVoid     = (host: usize) => void;
type HostSend     = (host: usize, buf: usize, size: u32) => bool;
type InSize       = (list: usize) => u32;
type InGet        = (list: usize, index: u32) => usize;
type TryPush      = (list: usize, ev: usize) => bool;
type StreamWrite  = (stream: usize, buf: usize, size: i64) => i64;
type StreamRead   = (stream: usize, buf: usize, size: i64) => i64;

const MAX_FRAMES: i32 = 8192;
const MIN_SLICE: i32 = 8;
const MAX_PARAMS: i32 = 64;
const HOST_TEMPO_PARAM: i32 = 63;
const NO_ID: u32 = 0xFFFFFFFF;

// CLAP event types / flags
const EV_NOTE_ON: u16 = 0;
const EV_NOTE_OFF: u16 = 1;
const EV_NOTE_CHOKE: u16 = 2;
const EV_NOTE_END: u16 = 3;
const EV_PARAM_VALUE: u16 = 5;
const EV_GESTURE_BEGIN: u16 = 7;
const EV_GESTURE_END: u16 = 8;
const EV_MIDI: u16 = 10;

// ---- function pointers -----------------------------------------------------
// AssemblyScript function values are objects { index: u32, env: usize }, not raw
// table indices. fp() reads the table index out of one (what a CLAP struct stores);
// hf() makes a raw index the host gave us callable, through one shared object
// that is only read at the moment of the call.
const callObj: usize = heap.alloc(8);
function fp(f: usize): u32 { return load<u32>(f); }
function hf<T>(index: u32): T {
  store<u32>(callObj, index);
  store<usize>(callObj + 4, 0);
  return changetype<T>(callObj);
}

// The optimiser (binaryen's gufa pass) treats the function table as closed: a
// call_indirect whose signature no table function has becomes `unreachable`, and
// one whose only candidates all return a constant is folded to that constant. Both
// are wrong for host callbacks, so every callback signature whose result we use
// gets an opaque stand-in in the table (its result comes out of memory, so nothing
// can be inferred): events size / get / get_extension, and the stream read/write.
function standIn1(a: usize): u32 { return load<u32>(scratch); }
function standIn2(a: usize, b: usize): usize { return load<usize>(scratch); }
function standIn3(s: usize, b: usize, n: i64): i64 { return load<i64>(scratch); }
let tableKeep: u32 = 0;

// ---- memory helpers --------------------------------------------------------
export function malloc(size: usize): usize {
  return heap.alloc(size);
}

function cstr(s: string): usize {
  const n = String.UTF8.byteLength(s, true);
  const p = heap.alloc(n);
  String.UTF8.encodeUnsafe(changetype<usize>(s), s.length, p, true);
  return p;
}

function streq(a: usize, b: usize): bool {
  let i: usize = 0;
  while (true) {
    const x = load<u8>(a + i), y = load<u8>(b + i);
    if (x != y) return false;
    if (x == 0) return true;
    i++;
  }
  return false;
}

function writeCString(dst: usize, cap: u32, s: string): void {
  if (cap == 0) return;
  const n = String.UTF8.byteLength(s, true);
  if (<u32>n <= cap) {
    String.UTF8.encodeUnsafe(changetype<usize>(s), s.length, dst, true);
  } else {
    // truncate: encode into scratch, copy cap-1 bytes
    const tmp = heap.alloc(n);
    String.UTF8.encodeUnsafe(changetype<usize>(s), s.length, tmp, true);
    memory.copy(dst, tmp, cap - 1);
    store<u8>(dst + cap - 1, 0);
  }
}

// ---- global state ----------------------------------------------------------
let host: usize = 0;
let hostGetExt: u32 = 0;
let hostRequestCallback: u32 = 0;
let hostParamsExt: usize = 0;
let hostWebviewExt: usize = 0;

let sampleRate: f64 = 44100;
let activated: bool = false;
let guiOpen: bool = false;

// strings and static structs, built once in start
let sId: usize, sName: usize, sVendor: usize, sVersion: usize, sUrl: usize, sDesc: usize;
let sFeatInstr: usize, sFeatSynth: usize, sFeatFx: usize, sFeatStereo: usize;
let sExtParams: usize, sExtState: usize, sExtAudio: usize, sExtNotes: usize, sExtGui: usize, sExtWebview: usize;
let sFactory: usize, sWebview: usize, sUri: usize, sStereo: usize, sMain: usize, sNotes: usize;

let pEntry: usize, pFactory: usize, pDescriptor: usize, pPlugin: usize;
let pParamsExt: usize, pStateExt: usize, pAudioExt: usize, pNotesExt: usize, pGuiExt: usize, pWebviewExt: usize;

// parameter values in plugin units, by plugin index (CLAP id == plugin index)
const pvals: StaticArray<f64> = new StaticArray<f64>(MAX_PARAMS);
// 1 where the GUI should be told about a new value
const uiDirty: StaticArray<u8> = new StaticArray<u8>(MAX_PARAMS);
let uiAnyDirty: bool = false;
let uiHello: bool = false;           // page said hello: send a full snapshot

// events going to the host: 0 value, 1 gesture begin, 2 gesture end
const OUT_CAP: i32 = 256;
const outKind: StaticArray<u8> = new StaticArray<u8>(OUT_CAP);
const outId: StaticArray<u32> = new StaticArray<u32>(OUT_CAP);
const outVal: StaticArray<f64> = new StaticArray<f64>(OUT_CAP);
let outHead: i32 = 0, outTail: i32 = 0, outCount: i32 = 0;
let evValue: usize = 0, evGesture: usize = 0;

// note routing (MidiRouter.h): held / sustained bits, pedal
const held: StaticArray<u8> = new StaticArray<u8>(128);
const sustained: StaticArray<u8> = new StaticArray<u8>(128);
let pedalDown: bool = false;

let inPtr: usize = 0, outPtr: usize = 0, paramsPtr: usize = 0, displayPtr: usize = 0;
let numParamsPlugin: i32 = 0;

let scratch: usize = 0;              // message / state buffer
const SCRATCH: i32 = 4096;
let frameClock: i64 = 0;             // frames processed, for the UI timers
let displayNext: i64 = 0;
let callbackPending: bool = false;
let callbackSince: i64 = 0;
const lastDisplay: StaticArray<f32> = new StaticArray<f32>(16);

// ---- parameter plumbing ----------------------------------------------------
function slotOf(id: u32): i32 {
  for (let i = 0; i < NUM_PARAMS; i++) if (<u32>unchecked(PARAM_INDEX[i]) == id) return i;
  return -1;
}

function applyParam(index: i32, value: f64): void {
  if (index < 0 || index >= MAX_PARAMS) return;
  const s = slotOf(<u32>index);
  if (s < 0) return;
  const lo = unchecked(PARAM_MIN[s]), hi = unchecked(PARAM_MAX[s]);
  if (value < lo) value = lo;
  if (value > hi) value = hi;
  pvals[index] = value;
  if (paramsPtr != 0) store<f32>(paramsPtr + (<usize>index << 2), <f32>value);
}

function pushOut(kind: u8, id: u32, value: f64): void {
  if (outCount >= OUT_CAP) {          // drop the oldest value event, keep gestures
    outHead = (outHead + 1) % OUT_CAP; outCount--;
  }
  outKind[outTail] = kind; outId[outTail] = id; outVal[outTail] = value;
  outTail = (outTail + 1) % OUT_CAP; outCount++;
}

function markUi(index: i32): void {
  if (index < 0 || index >= MAX_PARAMS) return;
  uiDirty[index] = 1; uiAnyDirty = true;
}

function requestCallback(): void {
  if (callbackPending || hostRequestCallback == 0) return;
  callbackPending = true; callbackSince = frameClock;
  hf<HostVoid>(hostRequestCallback)(host);
}

function requestFlush(): void {
  if (hostParamsExt == 0) return;
  const fn = load<u32>(hostParamsExt + 8);
  if (fn != 0) hf<HostVoid>(fn)(host);
}

// ---- notes (MidiRouter.h) ---------------------------------------------------
function noteHz(n: i32): f32 {
  return <f32>(440.0 * Math.pow(2.0, (<f64>(n - 69)) / 12.0));
}

function doNoteOn(n: i32, vel: f32): void {
  if (n < 0 || n > 127) return;
  if (!IS_SYNTH) return;
  if (sustained[n]) { if (isDefined(P.noteOff)) P.noteOff(n); sustained[n] = 0; }
  held[n] = 1;
  if (isDefined(P.noteOn)) P.noteOn(n, noteHz(n), vel);
}

function doNoteOff(n: i32): void {
  if (n < 0 || n > 127) return;
  if (!IS_SYNTH) return;
  held[n] = 0;
  if (pedalDown) { sustained[n] = 1; return; }
  if (isDefined(P.noteOff)) P.noteOff(n);
}

function releaseSustained(): void {
  for (let n = 0; n < 128; n++)
    if (sustained[n] && !held[n]) { if (isDefined(P.noteOff)) P.noteOff(n); }
  for (let n = 0; n < 128; n++) sustained[n] = 0;
}

function releaseAll(): void {
  for (let n = 0; n < 128; n++) {
    if (held[n] || sustained[n]) { if (isDefined(P.noteOff)) P.noteOff(n); }
    held[n] = 0; sustained[n] = 0;
  }
}

function control(num: i32, value: f32): void {
  if (isDefined(P.controlChange)) P.controlChange(num, value);
}

function doMidi(status: u8, d1: u8, d2: u8): void {
  const kind = status & 0xF0;
  if (kind == 0x90 && d2 > 0) doNoteOn(d1, <f32>d2 / 127.0);
  else if (kind == 0x80 || kind == 0x90) doNoteOff(d1);
  else if (kind == 0xB0) {
    if (d1 == 64) {
      if (d2 >= 64) pedalDown = true; else { pedalDown = false; releaseSustained(); }
    } else if (d1 == 120 || d1 == 123) { pedalDown = false; releaseAll(); }
    else control(d1, <f32>d2 / 127.0);
  } else if (kind == 0xE0) {
    const v = (<i32>d1 | (<i32>d2 << 7)) - 8192;
    control(128, <f32>v / 8192.0);
  } else if (kind == 0xD0) control(129, <f32>d1 / 127.0);
}

// ---- audio ------------------------------------------------------------------
let bufIn: usize = 0, bufOut: usize = 0, bufInCount: u32 = 0, bufOutCount: u32 = 0;

function runSlice(start: i32, len: i32): void {
  while (len > 0) {
    const n = len > MAX_FRAMES ? MAX_FRAMES : len;
    if (!IS_SYNTH && bufInCount > 0) {
      const ch = load<u32>(bufIn + 8);
      const data = load<usize>(bufIn);
      for (let c: u32 = 0; c < 2; c++) {
        const src = load<usize>(data + (<usize>(c < ch ? c : ch - 1) << 2)) + (<usize>start << 2);
        memory.copy(inPtr + ((<usize>c * <usize>MAX_FRAMES) << 2), src, <usize>n << 2);
      }
    } else if (!IS_SYNTH) {
      memory.fill(inPtr, 0, <usize>(MAX_FRAMES * 2) << 2);
    }
    P.process(n);
    if (bufOutCount > 0) {
      const ch = load<u32>(bufOut + 8);
      const data = load<usize>(bufOut);
      for (let c: u32 = 0; c < ch; c++) {
        const dst = load<usize>(data + (<usize>c << 2)) + (<usize>start << 2);
        memory.copy(dst, outPtr + ((<usize>(c < 2 ? c : 1) * <usize>MAX_FRAMES) << 2), <usize>n << 2);
      }
    }
    start += n; len -= n;
  }
}

function handleEvent(ev: usize): void {
  if (load<u16>(ev + 8) != 0) return;          // core event space only
  const type = load<u16>(ev + 10);
  if (type == EV_NOTE_ON) {
    const key = <i32>load<i16>(ev + 24);
    if (key >= 0) doNoteOn(key, <f32>load<f64>(ev + 32));
  } else if (type == EV_NOTE_OFF || type == EV_NOTE_CHOKE) {
    const key = <i32>load<i16>(ev + 24);
    if (key >= 0) doNoteOff(key);
  } else if (type == EV_PARAM_VALUE) {
    const id = load<u32>(ev + 16);
    applyParam(<i32>id, load<f64>(ev + 40));
    markUi(<i32>id);
  } else if (type == EV_MIDI) {
    doMidi(load<u8>(ev + 18), load<u8>(ev + 19), load<u8>(ev + 20));
  }
}

// ---- output events + page updates ------------------------------------------
function flushOut(outEvents: usize): void {
  if (outEvents == 0) { outHead = 0; outTail = 0; outCount = 0; return; }
  const push = load<u32>(outEvents + 4);
  while (outCount > 0) {
    const kind = outKind[outHead], id = outId[outHead], v = outVal[outHead];
    outHead = (outHead + 1) % OUT_CAP; outCount--;
    let ev: usize;
    if (kind == 0) {
      ev = evValue;
      memory.fill(ev, 0, 48);
      store<u32>(ev, 48); store<u16>(ev + 10, EV_PARAM_VALUE);
      store<u32>(ev + 16, id);
      store<i32>(ev + 24, -1); store<i16>(ev + 28, -1); store<i16>(ev + 30, -1); store<i16>(ev + 32, -1);
      store<f64>(ev + 40, v);
    } else {
      ev = evGesture;
      memory.fill(ev, 0, 24);
      store<u32>(ev, 20); store<u16>(ev + 10, kind == 1 ? EV_GESTURE_BEGIN : EV_GESTURE_END);
      store<u32>(ev + 16, id);
    }
    hf<TryPush>(push)(outEvents, ev);
  }
}

function sendToPage(len: i32): void {
  if (hostWebviewExt == 0) return;
  const fn = load<u32>(hostWebviewExt);
  if (fn != 0) hf<HostSend>(fn)(host, scratch, <u32>len);
}

function sendParams(all: bool): void {
  if (!guiOpen) return;
  let n: u16 = 0;
  let p = scratch + 3;
  for (let s = 0; s < NUM_PARAMS; s++) {
    const idx = unchecked(PARAM_INDEX[s]);
    if (!all && !uiDirty[idx]) continue;
    store<u32>(p, <u32>idx); store<f64>(p + 4, pvals[idx]);
    p += 12; n++;
    if (n >= 300) break;
  }
  for (let i = 0; i < MAX_PARAMS; i++) uiDirty[i] = 0;
  uiAnyDirty = false;
  if (n == 0) return;
  store<u8>(scratch, 0x50); store<u16>(scratch + 1, n);
  sendToPage(<i32>(p - scratch));
}

function sendDisplay(): void {
  if (!guiOpen || displayPtr == 0) return;
  let changed = false;
  for (let i = 0; i < 16; i++) {
    let v = load<f32>(displayPtr + (<usize>i << 2));
    if (v != v) v = 0;
    if (v != lastDisplay[i]) { changed = true; lastDisplay[i] = v; }
  }
  if (!changed) return;
  store<u8>(scratch, 0x44);
  memory.copy(scratch + 1, changetype<usize>(lastDisplay), 64);
  sendToPage(65);
}

function pumpPage(): void {
  if (!guiOpen) { uiHello = false; return; }
  if (uiHello) { uiHello = false; sendParams(true); }
  else if (uiAnyDirty) sendParams(false);
  sendDisplay();
}

// ---- clap_plugin_t ----------------------------------------------------------
function plugInit(p: usize): bool { return true; }
function plugDestroy(p: usize): void {}

function plugActivate(p: usize, sr: f64, minFrames: u32, maxFrames: u32): bool {
  sampleRate = sr;
  P.init(<f32>sr, MAX_FRAMES, 2);
  inPtr = P.getInputPtr(); outPtr = P.getOutputPtr(); paramsPtr = P.getParamsPtr();
  numParamsPlugin = P.getNumParams();
  displayPtr = isDefined(P.getDisplayPtr) ? P.getDisplayPtr() : 0;
  // host-visible values win over the module's own defaults
  for (let s = 0; s < NUM_PARAMS; s++) applyParam(unchecked(PARAM_INDEX[s]), pvals[unchecked(PARAM_INDEX[s])]);
  activated = true;
  return true;
}
function plugDeactivate(p: usize): void { activated = false; }
function plugStart(p: usize): bool { return true; }
function plugStop(p: usize): void {}
function plugReset(p: usize): void { releaseAll(); pedalDown = false; }

function plugProcess(p: usize, proc: usize): i32 {
  if (!activated) return 0;
  const frames = <i32>load<u32>(proc + 8);
  const transport = load<usize>(proc + 12);
  bufIn = load<usize>(proc + 16); bufOut = load<usize>(proc + 20);
  bufInCount = load<u32>(proc + 24); bufOutCount = load<u32>(proc + 28);
  const inEvents = load<usize>(proc + 32), outEvents = load<usize>(proc + 36);

  // tempo / transport (WasmAbi.h: params[63] = BPM, transport() once per block)
  let bpm: f32 = 0;
  if (transport != 0) {
    const flags = load<u32>(transport + 16);
    if (flags & 1) bpm = <f32>load<f64>(transport + 40);
    if (isDefined(P.transport)) {
      if (flags & 2) P.transport((flags & 16) ? 1 : 0, <f64>load<i64>(transport + 24) / 2147483648.0, bpm);
    }
  }
  if (paramsPtr != 0) store<f32>(paramsPtr + (<usize>HOST_TEMPO_PARAM << 2), bpm);

  const nEv = inEvents != 0 ? hf<InSize>(load<u32>(inEvents + 4))(inEvents) : 0;
  const getEv = inEvents != 0 ? load<u32>(inEvents + 8) : 0;
  let pos = 0;
  for (let e: u32 = 0; e < nEv; e++) {
    const ev = hf<InGet>(getEv)(inEvents, e);
    let at = <i32>load<u32>(ev + 4);
    if (at >= frames) at = frames > 0 ? frames - 1 : 0;
    if (at - pos >= MIN_SLICE) { runSlice(pos, at - pos); pos = at; }
    handleEvent(ev);
  }
  runSlice(pos, frames - pos);

  frameClock += frames;
  flushOut(outEvents);

  // page updates: through on_main_thread, from here if the host never calls back
  if (guiOpen) {
    if (frameClock >= displayNext) { displayNext = frameClock + <i64>(sampleRate / 30.0); requestCallback(); }
    if (uiAnyDirty || uiHello) requestCallback();
    if (callbackPending && frameClock - callbackSince > <i64>(sampleRate * 0.1)) {
      callbackPending = false; pumpPage();
    }
  }
  return 1;   // CLAP_PROCESS_CONTINUE
}

function plugOnMainThread(p: usize): void {
  callbackPending = false;
  pumpPage();
  if (outCount > 0) requestFlush();
}

function plugGetExtension(p: usize, id: usize): usize {
  if (streq(id, sExtParams))  return pParamsExt;
  if (streq(id, sExtState))   return pStateExt;
  if (streq(id, sExtAudio))   return pAudioExt;
  if (streq(id, sExtNotes))   return IS_SYNTH ? pNotesExt : 0;
  if (streq(id, sExtGui))     return pGuiExt;
  if (streq(id, sExtWebview)) return pWebviewExt;
  return 0;
}

// ---- clap.params -----------------------------------------------------------
function paramsCount(p: usize): u32 { return <u32>NUM_PARAMS; }

function paramsGetInfo(p: usize, i: u32, info: usize): bool {
  if (i >= <u32>NUM_PARAMS) return false;
  memory.fill(info, 0, 1320);
  store<u32>(info, <u32>unchecked(PARAM_INDEX[<i32>i]));
  store<u32>(info + 4, 1 << 5);                        // automatable
  writeCString(info + 12, 256, unchecked(PARAM_NAMES[<i32>i]));
  store<f64>(info + 1296, unchecked(PARAM_MIN[<i32>i]));
  store<f64>(info + 1304, unchecked(PARAM_MAX[<i32>i]));
  store<f64>(info + 1312, unchecked(PARAM_DEF[<i32>i]));
  return true;
}

function paramsGetValue(p: usize, id: u32, out: usize): bool {
  if (id >= <u32>MAX_PARAMS || slotOf(id) < 0) return false;
  store<f64>(out, pvals[<i32>id]);
  return true;
}

function paramsValueToText(p: usize, id: u32, value: f64, buf: usize, cap: u32): bool {
  writeCString(buf, cap, (<f32>value).toString());
  return true;
}
function paramsTextToValue(p: usize, id: u32, text: usize, out: usize): bool { return false; }

function paramsFlush(p: usize, inEvents: usize, outEvents: usize): void {
  if (inEvents != 0) {
    const n = hf<InSize>(load<u32>(inEvents + 4))(inEvents);
    const get = load<u32>(inEvents + 8);
    for (let e: u32 = 0; e < n; e++) handleEvent(hf<InGet>(get)(inEvents, e));
  }
  flushOut(outEvents);
}

// ---- clap.state --------------------------------------------------------------
function stateSave(p: usize, stream: usize): bool {
  let w = scratch;
  store<u32>(w, 0x41545356); store<u32>(w + 4, <u32>NUM_PARAMS); w += 8;     // "VSTA"
  for (let s = 0; s < NUM_PARAMS; s++) {
    const idx = unchecked(PARAM_INDEX[s]);
    store<u32>(w, <u32>idx); store<f64>(w + 4, pvals[idx]); w += 12;
  }
  const total = <i64>(w - scratch);
  const write = hf<StreamWrite>(load<u32>(stream + 4));
  return write(stream, scratch, total) == total;
}

function stateLoad(p: usize, stream: usize): bool {
  const read = hf<StreamRead>(load<u32>(stream + 4));
  let got: i64 = 0;
  while (got < SCRATCH) {
    const r = read(stream, scratch + <usize>got, <i64>SCRATCH - got);
    if (r <= 0) break;
    got += r;
  }
  if (got < 8 || load<u32>(scratch) != 0x41545356) return false;
  const n = <i32>load<u32>(scratch + 4);
  let r = scratch + 8;
  for (let i = 0; i < n && (r + 12 - scratch) <= <usize>got; i++, r += 12) {
    const idx = <i32>load<u32>(r);
    applyParam(idx, load<f64>(r + 4));
    markUi(idx);
  }
  return true;
}

// ---- clap.audio-ports / clap.note-ports ----------------------------------------
function audioCount(p: usize, isInput: bool): u32 { return (isInput && IS_SYNTH) ? 0 : 1; }
function audioGet(p: usize, index: u32, isInput: bool, info: usize): bool {
  if (index != 0 || (isInput && IS_SYNTH)) return false;
  memory.fill(info, 0, 276);
  store<u32>(info, isInput ? 0 : 1);
  writeCString(info + 4, 256, "Main");
  store<u32>(info + 260, 1);                           // CLAP_AUDIO_PORT_IS_MAIN
  store<u32>(info + 264, 2);
  store<usize>(info + 268, sStereo);
  store<u32>(info + 272, NO_ID);
  return true;
}

function notesCount(p: usize, isInput: bool): u32 { return isInput ? 1 : 0; }
function notesGet(p: usize, index: u32, isInput: bool, info: usize): bool {
  if (index != 0 || !isInput) return false;
  memory.fill(info, 0, 268);
  store<u16>(info, 0);
  store<u32>(info + 4, 3);                             // CLAP | MIDI dialects
  store<u32>(info + 8, 1);
  writeCString(info + 12, 256, "Notes");
  return true;
}

// ---- clap.gui (webview) ---------------------------------------------------------
function guiIsApiSupported(p: usize, api: usize, floating: bool): bool { return !floating && streq(api, sWebview); }
function guiGetPreferredApi(p: usize, api: usize, floating: usize): bool { return false; }
function guiCreate(p: usize, api: usize, floating: bool): bool { return !floating; }
function guiDestroy(p: usize): void { guiOpen = false; }
function guiSetScale(p: usize, scale: f64): bool { return false; }
function guiGetSize(p: usize, w: usize, h: usize): bool { store<u32>(w, UI_W); store<u32>(h, UI_H); return true; }
function guiCanResize(p: usize): bool { return true; }
function guiGetResizeHints(p: usize, hints: usize): bool { return false; }
function guiAdjustSize(p: usize, w: usize, h: usize): bool { return true; }
function guiSetSize(p: usize, w: u32, h: u32): bool { return true; }
function guiSetParent(p: usize, window: usize): bool { return true; }
function guiSetTransient(p: usize, window: usize): bool { return false; }
function guiSuggestTitle(p: usize, title: usize): void {}
function guiShow(p: usize): bool { guiOpen = true; return true; }
function guiHide(p: usize): bool { guiOpen = false; return true; }

// ---- clap.webview ---------------------------------------------------------------
function webviewGetUri(p: usize, uri: usize, cap: u32): i32 {
  const n = <u32>String.UTF8.byteLength("/ui/index.html", true);
  if (uri != 0 && cap > 0) writeCString(uri, cap, "/ui/index.html");
  return <i32>n;
}
function webviewGetResource(p: usize, path: usize, mime: usize, mimeCap: u32, stream: usize): bool { return false; }

// page -> plugin
//   'H'                          hello (page loaded): answer with every value
//   'P' u32 index, f64 value     parameter edit
//   'B' u32 index / 'E' u32 idx  gesture begin / end
//   'N' u8 note, f32 velocity    note on;  'F' u8 note  note off
function webviewReceive(p: usize, buf: usize, size: u32): bool {
  if (size < 1) return false;
  const t = load<u8>(buf);
  if (t == 0x48) { guiOpen = true; uiHello = true; requestCallback(); return true; }
  if (t == 0x50 && size >= 13) {
    const idx = <i32>load<u32>(buf + 1);
    applyParam(idx, load<f64>(buf + 5));
    if (idx >= 0 && idx < MAX_PARAMS) { pushOut(0, <u32>idx, pvals[idx]); requestFlush(); }
    return true;
  }
  if ((t == 0x42 || t == 0x45) && size >= 5) {
    pushOut(t == 0x42 ? 1 : 2, load<u32>(buf + 1), 0); requestFlush();
    return true;
  }
  if (t == 0x4E && size >= 6) { doNoteOn(<i32>load<u8>(buf + 1), load<f32>(buf + 2)); return true; }
  if (t == 0x46 && size >= 2) { doNoteOff(<i32>load<u8>(buf + 1)); return true; }
  return false;
}

// ---- entry ----------------------------------------------------------------------
function entryInit(path: usize): bool { return true; }
function entryDeinit(): void {}
function entryGetFactory(id: usize): usize { return pFactory; }

function factoryCount(f: usize): u32 { return 1; }
function factoryDescriptor(f: usize, index: u32): usize { return index == 0 ? pDescriptor : 0; }
function factoryCreate(f: usize, h: usize, id: usize): usize {
  if (!streq(id, sId)) return 0;
  host = h;
  const getExt = load<u32>(h + 32);
  hostRequestCallback = load<u32>(h + 44);
  hostParamsExt = getExt != 0 ? hf<HostGetExt>(getExt)(h, sExtParams) : 0;
  hostWebviewExt = getExt != 0 ? hf<HostGetExt>(getExt)(h, sExtWebview) : 0;
  return pPlugin;
}

function alloc0(size: usize): usize {
  const p = heap.alloc(size);
  memory.fill(p, 0, size);
  return p;
}

function build(): usize {
  sId = cstr(ID); sName = cstr(NAME); sVendor = cstr(VENDOR); sVersion = cstr(VERSION);
  sUrl = cstr("https://github.com/k1ln/VibePlugin");
  sDesc = cstr("Made with VibePlugin");
  sFeatInstr = cstr("instrument"); sFeatSynth = cstr("synthesizer"); sFeatFx = cstr("audio-effect");
  sFeatStereo = cstr("stereo");
  sExtParams = cstr("clap.params");
  sExtState = cstr("clap.state"); sExtAudio = cstr("clap.audio-ports");
  sExtNotes = cstr("clap.note-ports"); sExtGui = cstr("clap.gui"); sExtWebview = cstr("clap.webview/3");
  sFactory = cstr("clap.plugin-factory"); sWebview = cstr("webview");
  sStereo = cstr("stereo"); sMain = cstr("Main"); sNotes = cstr("Notes");
  scratch = heap.alloc(SCRATCH);
  evValue = alloc0(48); evGesture = alloc0(24);

  tableKeep = fp(changetype<usize>(standIn1)) + fp(changetype<usize>(standIn2)) + fp(changetype<usize>(standIn3));

  // clap_plugin_entry: version, init, deinit, get_factory
  pEntry = alloc0(24);
  store<u32>(pEntry, 1); store<u32>(pEntry + 4, 2); store<u32>(pEntry + 8, 0);
  store<u32>(pEntry + 12, fp(changetype<usize>(entryInit)));
  store<u32>(pEntry + 16, fp(changetype<usize>(entryDeinit)));
  store<u32>(pEntry + 20, fp(changetype<usize>(entryGetFactory)));

  pFactory = alloc0(12);
  store<u32>(pFactory, fp(changetype<usize>(factoryCount)));
  store<u32>(pFactory + 4, fp(changetype<usize>(factoryDescriptor)));
  store<u32>(pFactory + 8, fp(changetype<usize>(factoryCreate)));

  pDescriptor = alloc0(48);
  store<u32>(pDescriptor, 1); store<u32>(pDescriptor + 4, 2); store<u32>(pDescriptor + 8, 0);
  store<usize>(pDescriptor + 12, sId); store<usize>(pDescriptor + 16, sName);
  store<usize>(pDescriptor + 20, sVendor); store<usize>(pDescriptor + 24, sUrl);
  store<usize>(pDescriptor + 28, sUrl); store<usize>(pDescriptor + 32, sUrl);
  store<usize>(pDescriptor + 36, sVersion); store<usize>(pDescriptor + 40, sDesc);
  const feats = alloc0(20);
  if (IS_SYNTH) { store<usize>(feats, sFeatInstr); store<usize>(feats + 4, sFeatSynth); store<usize>(feats + 8, sFeatStereo); }
  else          { store<usize>(feats, sFeatFx);    store<usize>(feats + 4, sFeatStereo); }
  store<usize>(pDescriptor + 44, feats);

  pPlugin = alloc0(48);
  store<usize>(pPlugin, pDescriptor);
  store<u32>(pPlugin + 8, fp(changetype<usize>(plugInit)));
  store<u32>(pPlugin + 12, fp(changetype<usize>(plugDestroy)));
  store<u32>(pPlugin + 16, fp(changetype<usize>(plugActivate)));
  store<u32>(pPlugin + 20, fp(changetype<usize>(plugDeactivate)));
  store<u32>(pPlugin + 24, fp(changetype<usize>(plugStart)));
  store<u32>(pPlugin + 28, fp(changetype<usize>(plugStop)));
  store<u32>(pPlugin + 32, fp(changetype<usize>(plugReset)));
  store<u32>(pPlugin + 36, fp(changetype<usize>(plugProcess)));
  store<u32>(pPlugin + 40, fp(changetype<usize>(plugGetExtension)));
  store<u32>(pPlugin + 44, fp(changetype<usize>(plugOnMainThread)));

  pParamsExt = alloc0(24);
  store<u32>(pParamsExt, fp(changetype<usize>(paramsCount)));
  store<u32>(pParamsExt + 4, fp(changetype<usize>(paramsGetInfo)));
  store<u32>(pParamsExt + 8, fp(changetype<usize>(paramsGetValue)));
  store<u32>(pParamsExt + 12, fp(changetype<usize>(paramsValueToText)));
  store<u32>(pParamsExt + 16, fp(changetype<usize>(paramsTextToValue)));
  store<u32>(pParamsExt + 20, fp(changetype<usize>(paramsFlush)));

  pStateExt = alloc0(8);
  store<u32>(pStateExt, fp(changetype<usize>(stateSave)));
  store<u32>(pStateExt + 4, fp(changetype<usize>(stateLoad)));

  pAudioExt = alloc0(8);
  store<u32>(pAudioExt, fp(changetype<usize>(audioCount)));
  store<u32>(pAudioExt + 4, fp(changetype<usize>(audioGet)));

  pNotesExt = alloc0(8);
  store<u32>(pNotesExt, fp(changetype<usize>(notesCount)));
  store<u32>(pNotesExt + 4, fp(changetype<usize>(notesGet)));

  pGuiExt = alloc0(60);
  store<u32>(pGuiExt, fp(changetype<usize>(guiIsApiSupported)));
  store<u32>(pGuiExt + 4, fp(changetype<usize>(guiGetPreferredApi)));
  store<u32>(pGuiExt + 8, fp(changetype<usize>(guiCreate)));
  store<u32>(pGuiExt + 12, fp(changetype<usize>(guiDestroy)));
  store<u32>(pGuiExt + 16, fp(changetype<usize>(guiSetScale)));
  store<u32>(pGuiExt + 20, fp(changetype<usize>(guiGetSize)));
  store<u32>(pGuiExt + 24, fp(changetype<usize>(guiCanResize)));
  store<u32>(pGuiExt + 28, fp(changetype<usize>(guiGetResizeHints)));
  store<u32>(pGuiExt + 32, fp(changetype<usize>(guiAdjustSize)));
  store<u32>(pGuiExt + 36, fp(changetype<usize>(guiSetSize)));
  store<u32>(pGuiExt + 40, fp(changetype<usize>(guiSetParent)));
  store<u32>(pGuiExt + 44, fp(changetype<usize>(guiSetTransient)));
  store<u32>(pGuiExt + 48, fp(changetype<usize>(guiSuggestTitle)));
  store<u32>(pGuiExt + 52, fp(changetype<usize>(guiShow)));
  store<u32>(pGuiExt + 56, fp(changetype<usize>(guiHide)));

  pWebviewExt = alloc0(12);
  store<u32>(pWebviewExt, fp(changetype<usize>(webviewGetUri)));
  store<u32>(pWebviewExt + 4, fp(changetype<usize>(webviewGetResource)));
  store<u32>(pWebviewExt + 8, fp(changetype<usize>(webviewReceive)));

  // initial parameter values = the sound the plugin was exported with
  for (let s = 0; s < NUM_PARAMS; s++) pvals[unchecked(PARAM_INDEX[s])] = unchecked(PARAM_VAL[s]);
  return pEntry;
}

export let clap_entry: usize = build();
