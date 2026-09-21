// WasmEngine.h
// =====================================================================
//  Assembles WAT to WASM in-process (wasmtime wat2wasm), instantiates it,
//  and drives it from the audio thread. Implements the ABI in WasmAbi.h,
//  including the optional synth note exports.
//
//  Threading: loadModule()/setParam() come from the message thread, process()
//  from the audio thread. A spin-lock guards the swap; while a reload is in
//  progress the audio thread passes input through unchanged.
// =====================================================================

#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <vector>
#include <atomic>
#include <array>

#include <wasmtime.h>
#include "WasmAbi.h"

class WasmEngine
{
public:
    // A note event for instrument modules (host has already done note->Hz).
    // `offset` is the frame within the block where it falls (0 = block start).
    struct NoteEvent { bool on; int id; float freq; float vel; int offset = 0; };

    // A controller for modules exporting controlChange(): num 0..127 = CC (value
    // 0..1), vstai::kControlPitchBend (-1..1), vstai::kControlPressure (0..1).
    struct ControlEvent { int num; float value; int offset = 0; };

    // DAW play state for modules exporting transport(); ppq is at the block start.
    struct TransportInfo { bool playing; double ppq; float bpm; };

    WasmEngine();
    ~WasmEngine();

    // Replace the running module from compiled WASM bytes (produced by the
    // in-process asc compiler).
    bool loadModule (const std::vector<uint8_t>& wasmBytes, juce::String& errorOut);

    // Drop the current module — process() then passes audio through (effect) or
    // is silent (synth). Used by "New".
    void unload();

    void prepare (double sampleRate, int maxBlockSize, int numChannels);

    // Audio-thread entry point. Notes and controllers are delivered at their
    // `offset`: the block is split there and process() runs slice by slice, so
    // timing is sample-accurate. Events at the same frame: controllers first.
    // `transport` (null = host reports no position) is passed once, up front.
    void process (juce::AudioBuffer<float>& buffer,
                  const std::vector<NoteEvent>* notes = nullptr,
                  const std::vector<ControlEvent>* controls = nullptr,
                  const TransportInfo* transport = nullptr);

    void setParam (int index, float value);
    float getParam (int index) const;

    // Load decoded f32 PCM into the module's optional sample buffer. `data` is
    // PLANAR: channel c starts at data[c * frames]. Frames are clamped to the
    // module's reported capacity. Then setSampleInfo(frames, channels, srcRate)
    // is called so the DSP knows how much audio is valid and at what rate.
    // Called from the message thread; takes the swap lock (audio bypasses while
    // the copy runs). Returns false (with errorOut) if the module has no sample
    // buffer or the write fails.
    bool loadSample (const float* data, int channels, int frames, float srcSampleRate,
                     juce::String& errorOut);

    bool isLoaded()  const { return loaded.load(); }
    int  numParams() const { return paramCount; }
    bool isInstrument() const { return haveNoteOn; }
    bool wantsControllers() const { return haveControl; }
    bool wantsTransport()   const { return haveTransport; }

    // Engine → GUI display values (see WasmAbi.h). Snapshotted after every host
    // block on the audio thread; safe to read from any thread.
    bool  hasDisplay() const { return haveDisplay.load(); }
    float getDisplay (int i) const
    {
        return (i >= 0 && i < vstai::kDisplaySlots) ? display[(size_t) i].load (std::memory_order_relaxed) : 0.0f;
    }

    // 0 when the loaded module exposes no sample buffer; otherwise frames/channel.
    bool hasSampleBuffer()       const { return haveSampleBuffer; }
    int  sampleCapacityFrames()  const { return sampleCap; }

private:
    void teardownInstance();
    bool resolveExports (juce::String& errorOut);
    bool callInit();
    void noteEvent (const NoteEvent& ev);
    void controlEvent (const ControlEvent& ev);
    void callTransport (const TransportInfo& t);
    // Run process() on frames [start, start+len) of `buffer`, via the module's
    // buffers (which always begin at element 0).
    bool processSlice (juce::AudioBuffer<float>& buffer, int start, int len, int numChannels);

    wasm_engine_t*       engine   = nullptr;
    wasmtime_store_t*    store    = nullptr;
    wasmtime_context_t*  context  = nullptr;
    wasmtime_module_t*   module   = nullptr;
    bool                 haveInstance = false;
    wasmtime_instance_t  instance {};

    wasmtime_memory_t    memory {};
    wasmtime_func_t      fnInit {}, fnProcess {}, fnNoteOn {}, fnNoteOff {};
    wasmtime_func_t      fnSetSampleInfo {}, fnControl {}, fnTransport {};
    bool                 haveNoteOn = false, haveNoteOff = false;
    bool                 haveControl = false, haveTransport = false;
    int32_t              displayPtr = 0;
    std::atomic<bool>    haveDisplay { false };
    std::array<std::atomic<float>, vstai::kDisplaySlots> display {};
    bool                 haveSampleBuffer = false;
    int32_t              inPtr = 0, outPtr = 0, paramsPtr = 0;
    int32_t              samplePtr = 0, sampleCap = 0;

    double sampleRate   = 44100.0;
    int    maxBlockSize = 512;
    int    channels     = 2;
    int    paramCount   = 0;

    float  paramValues[vstai::kMaxParams] = { 0 };

    // Scratch for merging note + controller events into one ordered timeline.
    // Reserved in prepare() so the audio thread never allocates in steady state.
    struct Timed { int offset; int order; bool isNote; int index; };
    std::vector<Timed> timeline;

    std::atomic<bool>    loaded { false };
    juce::SpinLock       swapLock;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (WasmEngine)
};
