// WasmAbi.h
// =====================================================================
//  The contract between the JUCE host (C++/wasmtime) and the WASM DSP
//  module that Claude writes in AssemblyScript. The AssemblyScript is
//  compiled to WASM IN-PROCESS by running the `asc` compiler (itself a
//  WASM module) inside wasmtime — so a shipped plugin needs no toolchain.
//
//  Mirrored in src/Prompt.h (the system prompt) and the reference modules
//  in wasm-template/assembly/.
// =====================================================================
//
//  A conforming module exports planar f32 buffers via pointer getters:
//
//    memory
//    init(sampleRate: f32, maxFrames: i32, numChannels: i32): void
//    process(numFrames: i32): void
//    getInputPtr(): usize     // address of the input buffer
//    getOutputPtr(): usize    // address of the output buffer
//    getParamsPtr(): usize    // address of the param array (f32[])
//    getNumParams(): i32
//        Buffer layout is PLANAR f32:
//            channel c, frame f  ->  base + (c * maxFrames + f) * 4 bytes
//
//  Parameters: the host writes one f32 per parameter into the params region;
//  the GUI drives them via window.vstai.setParam(index, value). Indices in
//  the AssemblyScript must match the indices the HTML sends.
//
//  INSTRUMENT/synth modules ALSO export:
//    noteOn(noteId: i32, freq: f32, velocity: f32): void  // host passes Hz + 0..1
//    noteOff(noteId: i32): void
//  The host converts MIDI note numbers to frequency and calls these.
//
//  OPTIONAL SAMPLE BUFFER (samplers, granular, convolution, wavetable-from-file):
//    getSamplePtr(): usize       // address of the planar f32 sample buffer
//    getSampleCapacity(): i32    // frames PER CHANNEL the buffer can hold
//    setSampleInfo(frames: i32, channels: i32, sampleRate: f32): void
//  The user picks an audio file in the GUI (window.vstai.loadSample); the host
//  decodes it to f32 PCM, memcpy's it into the sample buffer (same planar layout
//  as the audio buffers, but with capacity kMaxSampleFrames per channel) and then
//  calls setSampleInfo() with the valid length, channel count and the sample's
//  OWN sample rate. A module that doesn't load audio simply omits these exports.
//
//  OPTIONAL MIDI CONTROLLERS (instruments that respond to wheels/pedals/pressure):
//    controlChange(num: i32, value: f32): void
//        num 0..127  MIDI CC, value 0..1   (CC64 excepted — see sustain below)
//        num 128     pitch bend, value -1..1
//        num 129     channel pressure (aftertouch), value 0..1
//  Delivered at their exact sample position, like notes. Omit the export and
//  controllers are simply not sent.
//
//  SUSTAIN PEDAL (CC64) is handled by the HOST for every instrument: while the
//  pedal is down, note-offs are held back and released when it lifts; replaying
//  a note that is only sounding because of the pedal sends noteOff then noteOn.
//  So modules never see CC64 and must not implement sustain themselves.
//  CC120 (all sound off) and CC123 (all notes off) release every sounding note.
//
//  SAMPLE-ACCURATE EVENTS: the host splits a block at each MIDI event, calling
//  noteOn/noteOff/controlChange and then process() on the next slice, so a
//  module sees events exactly where they fall. process(numFrames) may therefore
//  run several times per host block with smaller numFrames; each call starts at
//  element 0 of the buffers as always.
//
//  OPTIONAL TRANSPORT (step sequencers, bar-locked LFOs, gated effects):
//    transport(playing: i32, ppq: f64, bpm: f32): void
//  Called once per host block, before any processing, with the DAW's play state
//  (1/0), the song position in quarter notes at the FIRST frame of the block, and
//  the tempo (0 if unknown). Advance ppq yourself inside the block:
//  ppq += bpm / (60 * sampleRate) per frame. Not called by hosts that report no
//  position — keep a free-running fallback.
//
//  OPTIONAL DISPLAY (engine → GUI: step lights, meters, envelope dots):
//    getDisplayPtr(): usize   // address of a StaticArray<f32>(16) the module fills
//  After each host block the host copies the 16 floats out; the GUI receives them
//  ~30 times a second via window.vstai.onDisplay(cb) as an array of 16 numbers.
//  Purely for drawing — they never reach the DSP or the DAW.
//
//  HOST TEMPO: params[kHostTempoParamIndex] (63, the last slot) is written by the
//  host every block with the DAW's current tempo in BPM (0 if the host reports
//  none, e.g. a bare monitoring plug-in with no transport). This is a direct
//  memory write, not a DAW-automatable parameter — modules that want tempo-synced
//  LFOs/delays/arps just read it; they must NOT declare a param at index 63.
// =====================================================================

#pragma once

namespace vstai
{
    static constexpr int kMaxFrames   = 8192;  // max block size per channel
    static constexpr int kMaxChannels = 2;     // stereo
    static constexpr int kMaxParams   = 64;    // params region capacity
    static constexpr int kHostTempoParamIndex = 63;  // reserved: host BPM, see below

    // Pseudo-controller numbers passed to controlChange() beyond the 0..127 CCs.
    static constexpr int kControlPitchBend = 128;   // value -1..1
    static constexpr int kControlPressure  = 129;   // value  0..1

    // Events closer together than this share one process() slice rather than
    // splitting the block into near-empty calls (<= 0.2 ms at 44.1 kHz).
    static constexpr int kMinEventSliceFrames = 8;

    // Floats the optional getDisplayPtr() region holds (engine → GUI only).
    static constexpr int kDisplaySlots = 16;

    // Sample-buffer capacity, per channel. ~5 minutes at up to 48 kHz. This is a
    // fixed StaticArray baked into modules that opt into the sample exports, so it
    // costs ~115 MB of WASM memory (stereo f32) — only sampler-style plugins pay it.
    static constexpr int kMaxSampleFrames = 14400000;  // 48000 * 300

    namespace abi
    {
        static constexpr const char* memory            = "memory";
        static constexpr const char* init              = "init";
        static constexpr const char* process           = "process";
        static constexpr const char* getInputPtr       = "getInputPtr";
        static constexpr const char* getOutputPtr      = "getOutputPtr";
        static constexpr const char* getParamsPtr      = "getParamsPtr";
        static constexpr const char* getNumParams      = "getNumParams";
        static constexpr const char* noteOn            = "noteOn";            // optional (synth)
        static constexpr const char* noteOff           = "noteOff";           // optional (synth)
        static constexpr const char* getSamplePtr      = "getSamplePtr";      // optional (sampler)
        static constexpr const char* getSampleCapacity = "getSampleCapacity"; // optional (sampler)
        static constexpr const char* setSampleInfo     = "setSampleInfo";     // optional (sampler)
        static constexpr const char* controlChange     = "controlChange";     // optional (CC/bend/pressure)
        static constexpr const char* transport         = "transport";         // optional (DAW play state)
        static constexpr const char* getDisplayPtr     = "getDisplayPtr";     // optional (engine → GUI)
    }
}
