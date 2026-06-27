// engine_test.cpp
// =====================================================================
//  Headless test of the knob/note path — no DAW, no WebView.
//
//  Usage:
//    vstai_tests <effect.wasm> <synth.wasm>   reference regression tests
//    vstai_tests <plugin.vstai>               sweep every param of a plugin
//                                             and report which ones change
//                                             the audio (pre-release check)
//
//  It drives the real WasmEngine the plugin uses, so it verifies the exact
//  host-side path a knob travels: setParam -> param mirror -> wasm process.
// =====================================================================

#include "WasmEngine.h"
#include "VstaiDocument.h"
#include "BridgeProtocol.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <iostream>
#include <vector>
#include <cmath>

namespace
{
    int failures = 0;

    void check (bool ok, const juce::String& what)
    {
        std::cout << (ok ? "  ok   : " : "  FAIL : ") << what << "\n";
        if (! ok) ++failures;
    }

    std::vector<uint8_t> readBytes (const juce::String& path)
    {
        juce::MemoryBlock mb;
        juce::File (path).loadFileAsData (mb);
        const auto* p = static_cast<const uint8_t*> (mb.getData());
        return { p, p + mb.getSize() };
    }

    // Deterministic noise so two renders see identical input.
    struct Noise
    {
        uint32_t s = 22695477u;
        float next() { s = s * 1664525u + 1013904223u; return (float) ((s >> 9) & 0xFFFF) / 32768.0f - 1.0f; }
    };

    double energy (const std::vector<float>& v)
    {
        double e = 0.0;
        for (auto x : v) e += (double) x * (double) x;
        return e;
    }

    // Render `blocks` of audio with one parameter overridden. Effects get noise
    // input; instruments get a held note. Returns channel-0 output concatenated.
    std::vector<float> render (WasmEngine& eng,
                               const std::vector<VstaiParam>& params,
                               int overrideIndex, float overrideValue,
                               bool isSynth,
                               double sr = 48000.0, int block = 256, int blocks = 48)
    {
        eng.prepare (sr, block, 2);                      // re-init DSP state
        for (const auto& p : params) eng.setParam (p.index, (float) p.defVal);
        if (overrideIndex >= 0) eng.setParam (overrideIndex, overrideValue);

        Noise noise;
        std::vector<float> out;
        out.reserve ((size_t) block * (size_t) blocks);
        juce::AudioBuffer<float> buf (2, block);
        std::vector<WasmEngine::NoteEvent> on { { true, 60, 261.6256f, 1.0f } };

        for (int b = 0; b < blocks; ++b)
        {
            if (isSynth)
                buf.clear();
            else
                for (int i = 0; i < block; ++i)
                {
                    const float v = noise.next();
                    buf.setSample (0, i, v);
                    buf.setSample (1, i, v);
                }

            const std::vector<WasmEngine::NoteEvent>* notes = (isSynth && b == 0) ? &on : nullptr;
            eng.process (buf, notes);
            for (int i = 0; i < block; ++i) out.push_back (buf.getSample (0, i));
        }
        return out;
    }

    // Does sweeping a parameter from min to max change the audio?
    struct SweepResult { bool affects; bool inconclusive; double relChange; };

    SweepResult sweepParam (WasmEngine& eng, const std::vector<VstaiParam>& params,
                            const VstaiParam& p, bool isSynth)
    {
        if (std::abs (p.maxVal - p.minVal) < 1e-12)
            return { false, true, 0.0 };

        auto lo = render (eng, params, p.index, (float) p.minVal, isSynth);
        auto hi = render (eng, params, p.index, (float) p.maxVal, isSynth);

        std::vector<float> diff (lo.size());
        for (size_t i = 0; i < lo.size(); ++i) diff[i] = lo[i] - hi[i];

        const double ref  = std::max (energy (lo), energy (hi));
        const double rel  = ref > 1e-9 ? energy (diff) / ref : 0.0;
        if (ref <= 1e-9) return { false, true, 0.0 };       // produced no audio either way
        return { rel > 1e-4, false, rel };
    }

    // -----------------------------------------------------------------
    void runProtocolTests()
    {
        std::cout << "[protocol] window.vstai URL parsing\n";
        using namespace vstai::bridge;

        auto p = parseParam ("/__vstai/param/3/0.5?_=123");
        check (p.valid && p.index == 3 && std::abs (p.value - 0.5f) < 1e-6f, "param path /3/0.5");

        auto pn = parseParam ("__vstai/param/0/-0.25");       // no leading slash, negative
        check (pn.valid && pn.index == 0 && std::abs (pn.value + 0.25f) < 1e-6f, "param no-slash, negative");

        auto n = parseNote ("/__vstai/note/60/0.8/1?_=9");
        check (n.valid && n.note == 60 && n.on && std::abs (n.vel - 0.8f) < 1e-6f, "note on /60/0.8/1");

        auto off = parseNote ("/__vstai/note/60/0/0");
        check (off.valid && off.note == 60 && ! off.on, "note off /60/0/0");

        auto bad = parseParam ("/something/else");
        check (! bad.valid, "non-matching path rejected");
    }

    void runReferenceTests (const juce::String& effectWasm, const juce::String& synthWasm)
    {
        std::cout << "[effect] reference gain + low-pass module\n";
        {
            WasmEngine eng; juce::String err;
            check (eng.loadModule (readBytes (effectWasm), err), "load effect.wasm  " + err);

            std::vector<VstaiParam> params {
                { "Gain",   0, 0.0, 2.0, 1.0, 1.0 },
                { "Cutoff", 1, 0.0, 1.0, 1.0, 1.0 } };

            auto silent = render (eng, params, 0, 0.0f, false);   // gain = 0
            auto loud   = render (eng, params, 0, 1.0f, false);   // gain = 1
            check (energy (silent) < 1e-6,                 "gain=0 -> silence");
            check (energy (loud)   > 1e-2,                 "gain=1 -> audio");

            check (sweepParam (eng, params, params[0], false).affects, "gain knob changes audio");
            check (sweepParam (eng, params, params[1], false).affects, "cutoff knob changes audio");
        }

        std::cout << "[synth] reference saw + envelope module\n";
        {
            WasmEngine eng; juce::String err;
            check (eng.loadModule (readBytes (synthWasm), err), "load synth.wasm  " + err);
            check (eng.isInstrument(), "synth exposes noteOn/noteOff");

            std::vector<VstaiParam> params { { "Level", 0, 0.0, 1.0, 0.5, 0.5 } };

            // note held -> sound
            auto held = render (eng, params, 0, 0.8f, true);
            check (energy (held) > 1e-3, "noteOn -> sound");

            // note released for the whole render -> (near) silence
            {
                eng.prepare (48000.0, 256, 2);
                eng.setParam (0, 0.8f);
                juce::AudioBuffer<float> buf (2, 256);
                std::vector<WasmEngine::NoteEvent> off { { false, 60, 0.0f, 0.0f } };
                double e = 0.0;
                for (int b = 0; b < 300; ++b)
                {
                    buf.clear();
                    eng.process (buf, b == 0 ? &off : nullptr);
                    if (b >= 280) e += energy ({ buf.getReadPointer (0), buf.getReadPointer (0) + 256 });
                }
                check (e < 1e-4, "noteOff -> decays to silence");
            }

            check (sweepParam (eng, params, params[0], true).affects, "level knob changes audio");
        }
    }

    bool p_outOfRange (const VstaiDocument& doc, const WasmEngine& eng);

    int runVstaiSweep (const juce::String& file)
    {
        VstaiDocument doc; juce::String err;
        if (! VstaiDocument::loadFromFile (juce::File (file), doc, err))
        {
            std::cerr << "could not load " << file << ": " << err << "\n";
            return 2;
        }
        if (doc.wasm.empty()) { std::cerr << "no compiled wasm in " << file << "\n"; return 2; }

        WasmEngine eng;
        if (! eng.loadModule (doc.wasm, err)) { std::cerr << "wasm failed to load: " << err << "\n"; return 2; }

        const bool isSynth = doc.isInstrument || eng.isInstrument();
        std::cout << "plugin: " << doc.name << "  (" << (isSynth ? "instrument" : "effect")
                  << ", " << (int) doc.params.size() << " params, engine reports "
                  << eng.numParams() << ")\n";

        int dead = 0;
        for (const auto& p : doc.params)
        {
            const auto r = sweepParam (eng, doc.params, p, isSynth);
            const char* tag = r.inconclusive ? "??  (no audio to compare)"
                                             : (r.affects ? "OK  affects audio" : "DEAD does nothing");
            if (! r.inconclusive && ! r.affects) ++dead;
            std::cout << "  param[" << p.index << "] " << p.name.paddedRight (' ', 16)
                      << tag << "   (change=" << juce::String (r.relChange, 4) << ")\n";
        }

        if (p_outOfRange (doc, eng))
            std::cout << "  note: some param indices are >= getNumParams() — the module "
                         "won't read them.\n";

        std::cout << (dead == 0 ? "\nAll knobs affect the audio.\n"
                                : "\n" + juce::String (dead) + " knob(s) do nothing — ask the AI to wire them.\n");
        return dead == 0 ? 0 : 1;
    }

    bool p_outOfRange (const VstaiDocument& doc, const WasmEngine& eng)
    {
        for (const auto& p : doc.params)
            if (p.index >= eng.numParams()) return true;
        return false;
    }
}

int main (int argc, char** argv)
{
    // .vstai mode: one argument ending in .vstai
    if (argc == 2 && juce::String (argv[1]).endsWithIgnoreCase (".vstai"))
        return runVstaiSweep (argv[1]);

    runProtocolTests();

    if (argc >= 3)
        runReferenceTests (argv[1], argv[2]);
    else
        std::cout << "(skipping engine tests — pass <effect.wasm> <synth.wasm> to run them)\n";

    std::cout << (failures == 0 ? "\nALL TESTS PASSED\n"
                                : "\n" + juce::String (failures) + " TEST(S) FAILED\n");
    return failures == 0 ? 0 : 1;
}
