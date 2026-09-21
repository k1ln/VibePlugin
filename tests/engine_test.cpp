// engine_test.cpp
// =====================================================================
//  Headless test of the knob/note path — no DAW, no WebView.
//
//  Usage:
//    vstai_tests <effect.wasm> <synth.wasm> [<events-probe.wasm>]
//                                             reference regression tests
//    vstai_tests <plugin.vstai>               sweep every param of a plugin
//                                             and report which ones change
//                                             the audio (pre-release check)
//
//  It drives the real WasmEngine the plugin uses, so it verifies the exact
//  host-side path a knob travels: setParam -> param mirror -> wasm process.
// =====================================================================

#include "WasmEngine.h"
#include "MidiRouter.h"
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

    // First frame of channel `ch` whose value differs from frame 0 (-1 if none).
    int firstChange (const juce::AudioBuffer<float>& b, int ch)
    {
        const float* d = b.getReadPointer (ch);
        for (int i = 1; i < b.getNumSamples(); ++i)
            if (std::abs (d[i] - d[0]) > 1e-6f) return i;
        return -1;
    }

    // Host event delivery: sample-accurate notes/controllers, transport.
    void runEventTests (const juce::String& probeWasm)
    {
        std::cout << "[events] sample-accurate delivery (events-probe module)\n";
        WasmEngine eng; juce::String err;
        check (eng.loadModule (readBytes (probeWasm), err), "load events-probe.wasm  " + err);
        check (eng.wantsControllers(), "probe exposes controlChange()");
        check (eng.wantsTransport(),   "probe exposes transport()");
        eng.prepare (48000.0, 512, 2);

        juce::AudioBuffer<float> buf (2, 512);

        {   // a note-on at frame 300 sounds from frame 300, not from 0
            buf.clear();
            std::vector<WasmEngine::NoteEvent> n { { true, 60, 261.6f, 1.0f, 300 } };
            eng.process (buf, &n);
            check (buf.getSample (0, 0) == 0.0f && firstChange (buf, 0) == 300,
                   "note-on at frame 300 lands at frame 300 (got " + juce::String (firstChange (buf, 0)) + ")");
        }
        {   // ...and its note-off at frame 17 in the next block lands there too
            buf.clear();
            std::vector<WasmEngine::NoteEvent> n { { false, 60, 0.0f, 0.0f, 17 } };
            eng.process (buf, &n);
            check (buf.getSample (0, 0) == 1.0f && firstChange (buf, 0) == 17,
                   "note-off at frame 17 lands at frame 17 (got " + juce::String (firstChange (buf, 0)) + ")");
        }
        {   // two notes in one block, in reverse order in the vector: sorted by frame
            buf.clear();
            std::vector<WasmEngine::NoteEvent> n { { true, 64, 330.0f, 1.0f, 400 },
                                                   { true, 60, 261.6f, 1.0f, 100 } };
            eng.process (buf, &n);
            check (buf.getSample (0, 99) == 0.0f && buf.getSample (0, 100) == 1.0f
                && buf.getSample (0, 399) == 1.0f && buf.getSample (0, 400) == 2.0f,
                   "out-of-order events are delivered in frame order");
            std::vector<WasmEngine::NoteEvent> off { { false, 60, 0, 0, 0 }, { false, 64, 0, 0, 0 } };
            buf.clear(); eng.process (buf, &off);
        }
        {   // events a few frames apart share one slice rather than splitting
            buf.clear();
            std::vector<WasmEngine::NoteEvent> n { { true, 60, 261.6f, 1.0f, 3 } };
            eng.process (buf, &n);
            check (buf.getSample (0, 0) == 1.0f,
                   "an event within kMinEventSliceFrames of the start is applied at frame 0");
            std::vector<WasmEngine::NoteEvent> off { { false, 60, 0, 0, 0 } };
            buf.clear(); eng.process (buf, &off);
        }
        {   // CC1 at frame 128, and a note at the same frame: controller applied first
            buf.clear();
            std::vector<WasmEngine::ControlEvent> c { { 1, 0.5f, 128 } };
            eng.process (buf, nullptr, &c);
            check (firstChange (buf, 1) == 128 && std::abs (buf.getSample (1, 511) - 0.5f) < 1e-6f,
                   "CC1 = 0.5 at frame 128 lands at frame 128");
        }
        {
            buf.clear();
            std::vector<WasmEngine::ControlEvent> c { { vstai::kControlPitchBend, -1.0f, 0 },
                                                      { vstai::kControlPressure, 0.25f, 0 } };
            eng.process (buf, nullptr, &c);
            // right = cc1 (0.5) + bend (-1) + 10 * pressure (2.5) = 2.0
            check (std::abs (buf.getSample (1, 0) - 2.0f) < 1e-5f, "pitch bend (128) and pressure (129) reach the module");
        }
        {   // transport: ppq reaches the module while playing, is ignored when stopped
            buf.clear();
            WasmEngine::TransportInfo t { true, 8.0, 120.0f };
            eng.process (buf, nullptr, nullptr, &t);
            check (std::abs (buf.getSample (0, 0) - 8.0f) < 1e-6f, "transport(playing, ppq=8) reaches the module");
            t.playing = false;
            buf.clear(); eng.process (buf, nullptr, nullptr, &t);
            check (buf.getSample (0, 0) == 0.0f, "transport(stopped) reaches the module");
        }
        {   // engine → GUI display: snapshotted after the block
            check (eng.hasDisplay(), "probe exposes getDisplayPtr()");
            buf.clear();
            std::vector<WasmEngine::NoteEvent> n { { true, 60, 261.6f, 1.0f, 0 }, { true, 62, 293.7f, 1.0f, 0 } };
            eng.process (buf, &n);
            check (eng.getDisplay (0) == 2.0f && eng.getDisplay (15) == 42.0f,
                   "display values reach the host after the block (held=2, marker=42)");
            check (eng.getDisplay (16) == 0.0f && eng.getDisplay (-1) == 0.0f, "display index out of range reads 0");
        }
        {   // an effect-style module without the optional exports is unaffected
            WasmEngine plain; juce::String e2;
            check (! plain.wantsControllers() && ! plain.wantsTransport() && ! plain.hasDisplay(),
                   "a module without the exports opts out");
        }
    }

    // MidiRouter: MIDI → events, sustain pedal, panic. Pure logic, no wasm.
    void runRouterTests()
    {
        std::cout << "[midi] MidiRouter: offsets, controllers, sustain pedal\n";
        MidiRouter r;
        std::vector<WasmEngine::NoteEvent> notes, gui;
        std::vector<WasmEngine::ControlEvent> ctl;
        auto has = [&] (bool on, int n, int at)
        {
            for (auto& e : notes) if (e.on == on && e.id == n && e.offset == at) return true;
            return false;
        };

        {
            juce::MidiBuffer m;
            m.addEvent (juce::MidiMessage::noteOn (1, 60, (juce::uint8) 100), 42);
            m.addEvent (juce::MidiMessage::controllerEvent (1, 1, 127), 50);
            m.addEvent (juce::MidiMessage::pitchWheel (1, 0), 60);
            m.addEvent (juce::MidiMessage::channelPressureChange (1, 127), 70);
            r.route (m, gui, notes, ctl);
            check (notes.size() == 1 && has (true, 60, 42), "note-on keeps its sample position (42)");
            check (std::abs (notes[0].freq - 261.6256f) < 0.01f, "note-on carries the note's frequency");
            check (ctl.size() == 3 && ctl[0].num == 1 && ctl[0].value == 1.0f && ctl[0].offset == 50,
                   "CC1 = 127 -> controlChange(1, 1.0) at frame 50");
            check (ctl.size() == 3 && ctl[1].num == vstai::kControlPitchBend && ctl[1].value == -1.0f,
                   "pitch wheel fully down -> -1");
            check (ctl.size() == 3 && ctl[2].num == vstai::kControlPressure && ctl[2].value == 1.0f,
                   "channel pressure 127 -> 1");
        }
        {   // pedal down, release the key: no note-off until the pedal lifts
            juce::MidiBuffer m;
            m.addEvent (juce::MidiMessage::controllerEvent (1, 64, 127), 0);
            m.addEvent (juce::MidiMessage::noteOff (1, 60), 10);
            r.route (m, gui, notes, ctl);
            check (notes.empty() && r.isSustainDown(), "pedal down: note-off is held back");
            check (ctl.empty(), "CC64 is not forwarded to the module");

            juce::MidiBuffer m2;   // replay the sustained note: off, then on
            m2.addEvent (juce::MidiMessage::noteOn (1, 60, (juce::uint8) 90), 5);
            r.route (m2, gui, notes, ctl);
            check (notes.size() == 2 && ! notes[0].on && notes[1].on && notes[0].offset == 5,
                   "replaying a sustained note sends note-off then note-on");

            juce::MidiBuffer m3;   // play 64, release both keys, lift the pedal at 200
            m3.addEvent (juce::MidiMessage::noteOn (1, 64, (juce::uint8) 90), 0);
            m3.addEvent (juce::MidiMessage::noteOff (1, 60), 20);
            m3.addEvent (juce::MidiMessage::noteOff (1, 64), 30);
            m3.addEvent (juce::MidiMessage::controllerEvent (1, 64, 0), 200);
            r.route (m3, gui, notes, ctl);
            check (notes.size() == 3 && has (false, 60, 200) && has (false, 64, 200),
                   "pedal up releases every sustained note at the pedal's frame");
        }
        {   // a key still held when the pedal lifts keeps sounding
            juce::MidiBuffer m;
            m.addEvent (juce::MidiMessage::noteOn (1, 67, (juce::uint8) 90), 0);
            m.addEvent (juce::MidiMessage::controllerEvent (1, 64, 127), 1);
            m.addEvent (juce::MidiMessage::controllerEvent (1, 64, 0), 2);
            r.route (m, gui, notes, ctl);
            check (notes.size() == 1 && notes[0].on, "a key held through the pedal is not released by it");
        }
        {   // panic: all notes off releases held + sustained
            juce::MidiBuffer m;
            m.addEvent (juce::MidiMessage::controllerEvent (1, 64, 127), 0);
            m.addEvent (juce::MidiMessage::noteOn (1, 72, (juce::uint8) 90), 1);
            m.addEvent (juce::MidiMessage::noteOff (1, 72), 2);
            m.addEvent (juce::MidiMessage::allNotesOff (1), 3);
            r.route (m, gui, notes, ctl);
            check (has (false, 67, 3) && has (false, 72, 3) && ! r.isSustainDown(),
                   "all-notes-off releases held and sustained notes and lifts the pedal");
        }
        {   // on-screen keyboard notes arrive at frame 0 and obey the pedal too
            r.reset();
            gui = { { true, 48, 0.0f, 0.8f } };
            juce::MidiBuffer none;
            r.route (none, gui, notes, ctl);
            check (notes.size() == 1 && notes[0].on && notes[0].offset == 0 && notes[0].freq > 130.0f,
                   "GUI keyboard note lands at frame 0 with its frequency");
            gui.clear();
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
    runRouterTests();

    if (argc >= 3)
        runReferenceTests (argv[1], argv[2]);
    else
        std::cout << "(skipping engine tests — pass <effect.wasm> <synth.wasm> to run them)\n";

    if (argc >= 4)
        runEventTests (argv[3]);
    else
        std::cout << "(skipping event tests — pass <events-probe.wasm> as a third argument)\n";

    std::cout << (failures == 0 ? "\nALL TESTS PASSED\n"
                                : "\n" + juce::String (failures) + " TEST(S) FAILED\n");
    return failures == 0 ? 0 : 1;
}
