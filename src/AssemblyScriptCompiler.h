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

    // The WebCLAP flavour: compiles `adapter` (ui/webclap/clap-adapter.ts) as the entry
    // point, with the plugin's own source and the generated parameter table importable
    // as ./plugin and ./meta. The module comes back with its function table exported
    // (see compiler/asc-driver.mjs --clap). Needs a compiler built from this driver.
    bool compileWebClap (const juce::String& adapter,
                         const juce::String& pluginSource,
                         const juce::String& meta,
                         std::vector<uint8_t>& wasmOut,
                         juce::String& diagnosticsOut);

private:
    bool run (const juce::String& entry, const juce::StringPairArray& siblings, bool clap,
              std::vector<uint8_t>& wasmOut, juce::String& diagnosticsOut);

public:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AssemblyScriptCompiler)
};
