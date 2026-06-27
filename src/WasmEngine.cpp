// WasmEngine.cpp
#include "WasmEngine.h"

namespace
{
    // Resolve an export by name; returns false if missing or wrong kind.
    bool getExport (wasmtime_context_t* ctx, wasmtime_instance_t* inst,
                    const char* name, wasmtime_extern_kind_t kind, wasmtime_extern_t& out)
    {
        if (! wasmtime_instance_export_get (ctx, inst, name, std::strlen (name), &out))
            return false;
        return out.kind == kind;
    }

    // Call a 0-arg function returning a single i32 (used for the ptr getters).
    bool callI32 (wasmtime_context_t* ctx, wasmtime_instance_t* inst,
                  const char* name, int32_t& result)
    {
        wasmtime_extern_t ext;
        if (! getExport (ctx, inst, name, WASMTIME_EXTERN_FUNC, ext))
            return false;

        wasmtime_val_t res {};
        wasm_trap_t* trap = nullptr;
        auto* err = wasmtime_func_call (ctx, &ext.of.func, nullptr, 0, &res, 1, &trap);
        if (err != nullptr) { wasmtime_error_delete (err); return false; }
        if (trap != nullptr) { wasm_trap_delete (trap); return false; }
        if (res.kind != WASMTIME_I32) return false;
        result = res.of.i32;
        return true;
    }
}

WasmEngine::WasmEngine()
{
    engine  = wasm_engine_new();
    store   = wasmtime_store_new (engine, nullptr, nullptr);
    context = wasmtime_store_context (store);
}

WasmEngine::~WasmEngine()
{
    teardownInstance();
    if (store  != nullptr) wasmtime_store_delete (store);
    if (engine != nullptr) wasm_engine_delete (engine);
}

void WasmEngine::teardownInstance()
{
    if (module != nullptr) { wasmtime_module_delete (module); module = nullptr; }
    haveInstance = false;
    paramCount   = 0;
    haveNoteOn   = false;
    haveNoteOff  = false;
    haveSampleBuffer = false;
    samplePtr    = 0;
    sampleCap    = 0;
}

void WasmEngine::applyNotes (const std::vector<NoteEvent>& notes)
{
    if (! haveNoteOn) return;
    wasm_trap_t* trap = nullptr;
    for (const auto& ev : notes)
    {
        if (ev.on)
        {
            wasmtime_val_t a[3];
            a[0].kind = WASMTIME_I32; a[0].of.i32 = ev.id;
            a[1].kind = WASMTIME_F32; a[1].of.f32 = ev.freq;
            a[2].kind = WASMTIME_F32; a[2].of.f32 = ev.vel;
            if (auto* e = wasmtime_func_call (context, &fnNoteOn, a, 3, nullptr, 0, &trap))
                wasmtime_error_delete (e);
        }
        else if (haveNoteOff)
        {
            wasmtime_val_t a; a.kind = WASMTIME_I32; a.of.i32 = ev.id;
            if (auto* e = wasmtime_func_call (context, &fnNoteOff, &a, 1, nullptr, 0, &trap))
                wasmtime_error_delete (e);
        }
        if (trap != nullptr) { wasm_trap_delete (trap); trap = nullptr; }
    }
}

bool WasmEngine::resolveExports (juce::String& errorOut)
{
    wasmtime_extern_t ext;

    if (! getExport (context, &instance, vstai::abi::memory, WASMTIME_EXTERN_MEMORY, ext))
        { errorOut = "module has no `memory` export"; return false; }
    memory = ext.of.memory;

    if (! getExport (context, &instance, vstai::abi::init, WASMTIME_EXTERN_FUNC, ext))
        { errorOut = "module has no `init` export"; return false; }
    fnInit = ext.of.func;

    if (! getExport (context, &instance, vstai::abi::process, WASMTIME_EXTERN_FUNC, ext))
        { errorOut = "module has no `process` export"; return false; }
    fnProcess = ext.of.func;

    if (! callI32 (context, &instance, vstai::abi::getInputPtr,  inPtr)
     || ! callI32 (context, &instance, vstai::abi::getOutputPtr, outPtr)
     || ! callI32 (context, &instance, vstai::abi::getParamsPtr, paramsPtr))
        { errorOut = "module is missing a buffer-pointer export"; return false; }

    int32_t n = 0;
    if (! callI32 (context, &instance, vstai::abi::getNumParams, n))
        { errorOut = "module has no `getNumParams` export"; return false; }
    paramCount = juce::jlimit (0, vstai::kMaxParams, n);

    // Optional synth note exports.
    haveNoteOn  = getExport (context, &instance, vstai::abi::noteOn,  WASMTIME_EXTERN_FUNC, ext);
    if (haveNoteOn) fnNoteOn = ext.of.func;
    haveNoteOff = getExport (context, &instance, vstai::abi::noteOff, WASMTIME_EXTERN_FUNC, ext);
    if (haveNoteOff) fnNoteOff = ext.of.func;

    // Optional sample buffer (samplers, granular, convolution, ...). All three
    // exports must be present together for the buffer to be usable.
    haveSampleBuffer = false;
    samplePtr = 0; sampleCap = 0;
    if (callI32 (context, &instance, vstai::abi::getSamplePtr,      samplePtr)
     && callI32 (context, &instance, vstai::abi::getSampleCapacity, sampleCap)
     && getExport (context, &instance, vstai::abi::setSampleInfo, WASMTIME_EXTERN_FUNC, ext))
    {
        fnSetSampleInfo  = ext.of.func;
        sampleCap        = juce::jlimit (0, vstai::kMaxSampleFrames, sampleCap);
        haveSampleBuffer = (sampleCap > 0);
    }

    return true;
}

bool WasmEngine::callInit()
{
    wasmtime_val_t args[3];
    args[0].kind = WASMTIME_F32; args[0].of.f32 = (float) sampleRate;
    args[1].kind = WASMTIME_I32; args[1].of.i32 = juce::jmin (maxBlockSize, vstai::kMaxFrames);
    args[2].kind = WASMTIME_I32; args[2].of.i32 = juce::jmin (channels, vstai::kMaxChannels);

    wasm_trap_t* trap = nullptr;
    auto* err = wasmtime_func_call (context, &fnInit, args, 3, nullptr, 0, &trap);
    if (err != nullptr)  { wasmtime_error_delete (err);  return false; }
    if (trap != nullptr) { wasm_trap_delete (trap);      return false; }
    return true;
}

bool WasmEngine::loadModule (const std::vector<uint8_t>& wasmBytes, juce::String& errorOut)
{
    wasmtime_module_t* newModule = nullptr;
    auto* err = wasmtime_module_new (engine, wasmBytes.data(), wasmBytes.size(), &newModule);
    if (err != nullptr)
    {
        wasm_name_t msg; wasmtime_error_message (err, &msg);
        errorOut = juce::String (msg.data, (size_t) msg.size);
        wasm_byte_vec_delete (&msg);
        wasmtime_error_delete (err);
        return false;
    }

    wasmtime_instance_t newInstance {};
    wasm_trap_t* trap = nullptr;
    err = wasmtime_instance_new (context, newModule, nullptr, 0, &newInstance, &trap);
    if (err != nullptr || trap != nullptr)
    {
        errorOut = "failed to instantiate module";
        if (err  != nullptr) wasmtime_error_delete (err);
        if (trap != nullptr) wasm_trap_delete (trap);
        wasmtime_module_delete (newModule);
        return false;
    }

    // Swap under the lock: the audio thread will pass-through while we hold it.
    {
        const juce::SpinLock::ScopedLockType sl (swapLock);
        loaded.store (false);
        teardownInstance();
        module       = newModule;
        instance     = newInstance;
        haveInstance = true;

        if (! resolveExports (errorOut)) { teardownInstance(); return false; }
        if (! callInit())                { errorOut = "init() trapped"; teardownInstance(); return false; }

        // Push current parameter mirror into the freshly initialised module.
        if (auto* base = wasmtime_memory_data (context, &memory))
            std::memcpy (base + paramsPtr, paramValues, sizeof (float) * (size_t) paramCount);

        loaded.store (true);
    }
    return true;
}

void WasmEngine::unload()
{
    const juce::SpinLock::ScopedLockType sl (swapLock);
    loaded.store (false);
    teardownInstance();
}

void WasmEngine::prepare (double newSampleRate, int newMaxBlock, int newChannels)
{
    sampleRate   = newSampleRate;
    maxBlockSize = newMaxBlock;
    channels     = juce::jlimit (1, vstai::kMaxChannels, newChannels);

    if (! loaded.load()) return;
    const juce::SpinLock::ScopedLockType sl (swapLock);
    if (haveInstance) callInit();
}

void WasmEngine::setParam (int index, float value)
{
    if (index < 0 || index >= vstai::kMaxParams) return;
    paramValues[index] = value;
    // best-effort live write; the audio thread also re-applies the mirror each block
}

float WasmEngine::getParam (int index) const
{
    if (index < 0 || index >= vstai::kMaxParams) return 0.0f;
    return paramValues[index];
}

bool WasmEngine::loadSample (const float* data, int channels, int frames,
                             float srcSampleRate, juce::String& errorOut)
{
    if (data == nullptr || frames <= 0) { errorOut = "no sample data"; return false; }

    const juce::SpinLock::ScopedLockType sl (swapLock);
    if (! loaded.load() || ! haveInstance) { errorOut = "no module loaded"; return false; }
    if (! haveSampleBuffer)                { errorOut = "this plugin has no sample buffer"; return false; }

    const int ch = juce::jlimit (1, vstai::kMaxChannels, channels);
    const int n  = juce::jmin (frames, sampleCap);   // clamp to the module's capacity

    auto* base = wasmtime_memory_data (context, &memory);
    if (base == nullptr) { errorOut = "no wasm memory"; return false; }

    // Source is planar with stride `frames`; destination is planar with stride
    // `sampleCap` (the module's per-channel capacity).
    for (int c = 0; c < ch; ++c)
        std::memcpy (base + samplePtr + (size_t) c * sampleCap * sizeof (float),
                     data + (size_t) c * frames,
                     sizeof (float) * (size_t) n);

    // Tell the module how much is valid and at what rate.
    wasmtime_val_t a[3];
    a[0].kind = WASMTIME_I32; a[0].of.i32 = n;
    a[1].kind = WASMTIME_I32; a[1].of.i32 = ch;
    a[2].kind = WASMTIME_F32; a[2].of.f32 = srcSampleRate;
    wasm_trap_t* trap = nullptr;
    if (auto* e = wasmtime_func_call (context, &fnSetSampleInfo, a, 3, nullptr, 0, &trap))
        { wasmtime_error_delete (e); errorOut = "setSampleInfo() failed"; return false; }
    if (trap != nullptr) { wasm_trap_delete (trap); errorOut = "setSampleInfo() trapped"; return false; }

    return true;
}

void WasmEngine::process (juce::AudioBuffer<float>& buffer,
                          const std::vector<NoteEvent>* notes)
{
    const int numFrames   = buffer.getNumSamples();
    const int numChannels = juce::jmin (buffer.getNumChannels(), vstai::kMaxChannels);

    // If a reload is happening or nothing is loaded, pass audio through.
    const juce::SpinLock::ScopedTryLockType sl (swapLock);
    if (! sl.isLocked() || ! loaded.load() || numFrames > vstai::kMaxFrames)
        return; // buffer already holds the input -> acts as bypass

    auto* base = wasmtime_memory_data (context, &memory);
    if (base == nullptr) return;

    // Synth note events (no-op for effects).
    if (notes != nullptr && ! notes->empty())
        applyNotes (*notes);

    // Apply the parameter mirror, then copy input in (planar).
    std::memcpy (base + paramsPtr, paramValues, sizeof (float) * (size_t) paramCount);
    for (int c = 0; c < numChannels; ++c)
        std::memcpy (base + inPtr + c * vstai::kMaxFrames * (int) sizeof (float),
                     buffer.getReadPointer (c),
                     sizeof (float) * (size_t) numFrames);

    // Call process(numFrames).
    wasmtime_val_t arg; arg.kind = WASMTIME_I32; arg.of.i32 = numFrames;
    wasm_trap_t* trap = nullptr;
    auto* err = wasmtime_func_call (context, &fnProcess, &arg, 1, nullptr, 0, &trap);
    if (err != nullptr)  { wasmtime_error_delete (err);  return; }
    if (trap != nullptr) { wasm_trap_delete (trap);      return; }

    // Memory may have moved if process grew it; re-fetch the base before reading.
    base = wasmtime_memory_data (context, &memory);
    if (base == nullptr) return;

    for (int c = 0; c < numChannels; ++c)
        std::memcpy (buffer.getWritePointer (c),
                     base + outPtr + c * vstai::kMaxFrames * (int) sizeof (float),
                     sizeof (float) * (size_t) numFrames);
}
