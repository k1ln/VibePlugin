// webclap_export_test.cpp
// =====================================================================
//  Headless WebCLAP export: load a .vstai, run the real exporter (adapter +
//  plugin compiled by the bundled compiler, GUI page with the shim, tar.gz).
//
//    vstai_webclap_export <plugin.vstai> <out.wclap.tar.gz>
//
//  The compiler is looked up next to this executable (vstai-node +
//  asc-bundle.mjs) and the adapter/shim under $VSTAI_UI_DIR (the repo's ui/).
// =====================================================================

#include "AssemblyScriptCompiler.h"
#include "VstaiDocument.h"
#include "WebClapExport.h"

#include <iostream>

int main (int argc, char** argv)
{
    if (argc < 3) { std::cerr << "usage: vstai_webclap_export <plugin.vstai> <out.wclap.tar.gz>\n"; return 2; }

    VstaiDocument doc;
    juce::String err;
    if (! VstaiDocument::loadFromFile (juce::File (juce::String::fromUTF8 (argv[1])), doc, err))
    {
        std::cerr << "load failed: " << err << "\n";
        return 1;
    }

    AssemblyScriptCompiler compiler;
    juce::String message;
    const bool ok = vstai::webclap::exportBundle (compiler, doc, {},
                                                  juce::File (juce::String::fromUTF8 (argv[2])), message);
    std::cout << message << "\n";
    return ok ? 0 : 1;
}
