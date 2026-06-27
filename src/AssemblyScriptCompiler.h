// AssemblyScriptCompiler.h
// =====================================================================
//  Compiles AssemblyScript -> WASM by running a self-contained compiler
//  executable (vstai-asc) that ships AS PART OF THE PLUGIN. asc's Binaryen
//  backend needs a real WebAssembly engine, which only a full JS runtime
//  (V8/JSC/SpiderMonkey) provides — so the compiler is a bundled runtime
//  with asc baked in (built once by compiler/build.sh), not a WASI module.
//
//  The plugin execs the bundled binary DIRECTLY (no shell): it writes the
//  source to a temp file and runs `vstai-asc <in.ts> <out.wasm>`.
//
//  The executable is located via Config.h / $VSTAI_COMPILER / next to the
//  plugin binary (see Settings.h).
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <vector>

class AssemblyScriptCompiler
{
public:
    AssemblyScriptCompiler() = default;

    bool isAvailable() const;   // true if the bundled compiler exists

    // Synchronous; call from a background thread.
    bool compile (const juce::String& assembly,
                  std::vector<uint8_t>& wasmOut,
                  juce::String& diagnosticsOut);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AssemblyScriptCompiler)
};
