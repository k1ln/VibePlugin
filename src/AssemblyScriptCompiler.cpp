// AssemblyScriptCompiler.cpp
#include "AssemblyScriptCompiler.h"
#include "Settings.h"
#include "DevLog.h"

bool AssemblyScriptCompiler::isAvailable() const
{
    return ! vstai::settings::compilerCommand().isEmpty();
}

bool AssemblyScriptCompiler::compile (const juce::String& assembly,
                                      std::vector<uint8_t>& wasmOut,
                                      juce::String& diagnosticsOut)
{
    auto cmd = vstai::settings::compilerCommand();
    if (cmd.isEmpty())
    {
        diagnosticsOut =
            "vstai-asc (the bundled AssemblyScript compiler) was not found. Build it "
            "with compiler/build.sh and set VSTAI_CONFIG_COMPILER in Config.h, set "
            "$VSTAI_COMPILER, or ship it next to the plugin.";
        return false;
    }

    // Scratch dir for this compile.
    auto dir = juce::File::getSpecialLocation (juce::File::tempDirectory)
                   .getChildFile ("vstai-" + juce::Uuid().toString());
    dir.createDirectory();
    auto inFile  = dir.getChildFile ("in.ts");
    auto outFile = dir.getChildFile ("out.wasm");
    inFile.replaceWithText (assembly);

    // Direct exec of the bundled binary — no shell is involved.
    cmd.add (inFile.getFullPathName());
    cmd.add (outFile.getFullPathName());
    VSTAI_LOG ("running compiler: " + cmd.joinIntoString (" "));
    juce::ChildProcess cp;

    bool ok = false;
    if (cp.start (cmd, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
    {
        const juce::String output = cp.readAllProcessOutput(); // blocks until exit
        cp.waitForProcessToFinish (120000);

        if (outFile.existsAsFile() && outFile.getSize() > 0)
        {
            juce::MemoryBlock mb;
            if (outFile.loadFileAsData (mb))
            {
                const auto* p = static_cast<const uint8_t*> (mb.getData());
                wasmOut.assign (p, p + mb.getSize());
                ok = true;
            }
        }
        if (! ok)
            diagnosticsOut = output.isNotEmpty() ? output
                                                 : juce::String ("compiler produced no output");
    }
    else
    {
        diagnosticsOut = "could not launch the bundled compiler";
    }

    dir.deleteRecursively();
    return ok;
}
