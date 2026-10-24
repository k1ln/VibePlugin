// vst3_export_test.cpp
// =====================================================================
//  Headless "Export plugin…": bake a .vstai into a copy of a built VibePlugin
//  bundle as a locked, re-identified, signed whitelabel .vst3 — the same
//  vstai::pluginexport::exportPlugin the editor's button runs, minus the editor.
//  Used by scripts/build-vst3-gallery.mjs to render the whole gallery on each OS.
//
//    vstai_export_vst3 <plugin.vstai> <source.vst3> <dest.vst3> [--notary <profile>] [--vendor <name>]
//
//  <source.vst3> is a built "VibePlugin Synth.vst3" or "VibePlugin FX.vst3" (its name
//  picks the identity that is rewritten). Exit 0 only if the export succeeded AND the
//  copy got its own VST3 id — a copy that still shares VibePlugin's id would collide
//  with every other export, so it is reported as a failure here.
// =====================================================================

#include "PluginExport.h"
#include "VstaiDocument.h"

#include <iostream>

int main (int argc, char** argv)
{
    if (argc < 4)
    {
        std::cerr << "usage: vstai_export_vst3 <plugin.vstai> <source.vst3> <dest.vst3> [--notary <profile>] [--vendor <name>]\n";
        return 2;
    }

    juce::String notary, vendor;
    for (int i = 4; i + 1 < argc; ++i)
    {
        if (juce::String (argv[i]) == "--notary") notary = juce::String::fromUTF8 (argv[i + 1]);
        if (juce::String (argv[i]) == "--vendor") vendor = juce::String::fromUTF8 (argv[i + 1]);
    }

    VstaiDocument doc;
    juce::String err;
    if (! VstaiDocument::loadFromFile (juce::File (juce::String::fromUTF8 (argv[1])), doc, err))
    {
        std::cerr << "load failed: " << err << "\n";
        return 1;
    }

    const juce::File src (juce::String::fromUTF8 (argv[2]));
    const juce::File dest (juce::String::fromUTF8 (argv[3]));
    const bool synth = src.getFileName().containsIgnoreCase ("Synth");
    const juce::String oldName = synth ? "VibePlugin Synth" : "VibePlugin FX";
    const juce::String oldCode = synth ? "Vssy" : "Vsfx";

    if (doc.isInstrument != synth)
    {
        std::cerr << "kind mismatch: " << doc.name << (doc.isInstrument ? " is a synth" : " is an effect")
                  << " but the source bundle is " << src.getFileName() << "\n";
        return 1;
    }

    juce::String message;
    const bool ok = vstai::pluginexport::exportPlugin (src, dest, doc, doc.name, oldName, oldCode, notary,
                                                       nullptr, message, vendor);
    std::cout << message << "\n";
    if (! ok) return 1;
    if (message.contains ("shares VibePlugin's id") || message.contains ("VibePlugin's shared id"))
    {
        std::cerr << "export kept VibePlugin's shared id — refusing it\n";
        dest.deleteRecursively();
        return 1;
    }
    return 0;
}
