// preset_bridge_cli.cpp
// =====================================================================
//  The REAL preset Controller (src/PresetController.h — the code the plugin runs)
//  behind a line protocol on stdin/stdout, so the browser UI can be driven end to
//  end without a DAW: scripts/preset-browser-demo.mjs puts a web page in front of it.
//
//      one request per line on stdin:
//        /__vstai/presets/...     -> the controller's JSON reply (one line)
//        __knobs                  -> JSON array of the 8 knob values
//        __set <i> <value>        -> move a knob
//        __revealed               -> how many times "Show folder" was pressed
//        __quit
//
//  The demo "plugin" is a synth named "Demo Synth" with 8 parameters and a dozen
//  factory sounds (some carrying a category/tags, some not, to show inference).
//  VSTAI_DEMO_FRESH=1 wipes the demo's saved sounds first (used by the QA run).
// =====================================================================

#include "PresetController.h"

#include <iostream>
#include <string>

int main()
{
    const juce::String vendor = "VibePlugin Demo";
    VstaiDocument doc;
    doc.name = "Demo Synth";
    doc.isInstrument = true;
    for (int i = 0; i < 8; ++i) { VstaiParam p; p.index = i; doc.params.push_back (p); }

    auto add = [&doc] (const char* name, const char* cat, std::initializer_list<const char*> tags, double seed)
    {
        VstaiPreset p; p.name = name; p.category = cat;
        for (auto* t : tags) p.tags.add (t);
        for (int i = 0; i < 8; ++i) p.values[i] = std::fmod (seed * (i + 1) * 0.37, 1.0);
        doc.presets.push_back (std::move (p));
    };
    add ("Init",           "",         {},                         0.10);
    add ("Warm Pad",       "",         { "warm", "slow" },         0.21);
    add ("Acid Bass",      "Bass",     { "acid", "303", "squelch" }, 0.33);
    add ("Sub Boom",       "",         { "deep", "clean" },        0.42);
    add ("Glass Keys",     "Keys",     { "bright", "clean" },      0.55);
    add ("Detuned Saw",    "Lead",     { "analog", "wide" },       0.61);
    add ("Vapor Pluck",    "",         { "bright", "short" },      0.72);
    add ("Hoover",         "",         { "rave", "analog" },       0.83);
    add ("Soft Strings",   "Strings",  { "warm", "slow", "wide" }, 0.94);
    add ("FM Bell",        "",         { "bright", "metallic" },   0.15);
    add ("Noise Riser",    "",         { "sweep" },                0.26);
    add ("Wobble",         "Bass",     { "dubstep", "analog" },    0.37);

    double knobs[64] = {};
    int revealed = 0;
    vstai::presets::Controller ctl (vstai::presets::Controller::Hooks {
        [&]() -> const VstaiDocument& { return doc; },
        [&] { return vendor; },
        [&] (int i) { return (float) knobs[i]; },
        [&] (int i, float v) { knobs[i] = v; },
        64,
        [&] (const juce::File&) { ++revealed; } });   // the demo just counts: no Finder window pops up in a test run

    if (juce::SystemStats::getEnvironmentVariable ("VSTAI_DEMO_FRESH", {}) == "1")
        vstai::presets::userDataFolder (vendor, doc.name).deleteRecursively();

    std::string line;
    while (std::getline (std::cin, line))
    {
        const auto l = juce::String::fromUTF8 (line.c_str()).trim();
        juce::String out;
        if (l == "__quit") break;
        if (l == "__knobs")
        {
            out = "[";
            for (int i = 0; i < 8; ++i) out << (i ? "," : "") << juce::String (knobs[i], 4);
            out << "]";
        }
        else if (l == "__revealed")
            out = juce::String (revealed);
        else if (l.startsWith ("__set "))
        {
            auto t = juce::StringArray::fromTokens (l, " ", "");
            if (t.size() >= 3) knobs[juce::jlimit (0, 63, t[1].getIntValue())] = t[2].getDoubleValue();
            out = "ok";
        }
        else if (auto r = ctl.handle (l))
            out = *r;
        else
            out = "{\"error\":\"not a presets request\"}";
        out = out.replace ("\n", " ").replace ("\r", " ");
        std::cout << out.toStdString() << std::endl;
    }
    return 0;
}
