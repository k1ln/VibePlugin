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
// =====================================================================

#pragma once

namespace vstai
{
    static constexpr int kMaxFrames   = 8192;  // max block size per channel
    static constexpr int kMaxChannels = 2;     // stereo
    static constexpr int kMaxParams   = 64;    // params region capacity

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
    }
}
