// SilenceProbe.h
// =====================================================================
//  A freshly compiled plugin that outputs nothing at its DEFAULT settings is
//  almost always a bad default (a filter cutoff at 0, a level at 0, a mix at the
//  wrong end), not what the user asked for. After a build compiles we render about
//  a second of audio through a private engine at the declared defaults - white-ish
//  noise in for an effect, a held middle C for an instrument - and report whether
//  anything came out. The build then asks the model for one targeted fix.
// =====================================================================
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <cmath>
#include <vector>
#include "WasmEngine.h"

namespace vstai
{
    // Returns true only when we are SURE the module is dead at its defaults: it loaded,
    // ran, and produced (near) nothing. Anything we can't judge (needs a sample, won't
    // load, produced NaN) is "not silent" so we never trigger a repair on a guess.
    inline bool probeSilentAtDefaults (const std::vector<uint8_t>& wasm, const juce::var& params,
                                       bool isInstrument)
    {
        WasmEngine eng;
        juce::String err;
        if (! eng.loadModule (wasm, err)) return false;
        if (eng.hasSampleBuffer()) return false;       // legitimately silent until a sample is loaded

        constexpr int kBlock = 512, kBlocks = 100;
        eng.prepare (48000.0, kBlock, 2);
        if (auto* arr = params.getArray())
            for (const auto& pv : *arr)
                if (auto* po = pv.getDynamicObject())
                {
                    const int idx = (int) po->getProperty ("index");
                    if (idx >= 0 && idx < vstai::kMaxParams && po->hasProperty ("default"))
                        eng.setParam (idx, (float) (double) po->getProperty ("default"));
                }

        juce::AudioBuffer<float> buf (2, kBlock);
        juce::Random rng (12345);
        std::vector<WasmEngine::NoteEvent> notes;
        float peak = 0.0f;
        for (int b = 0; b < kBlocks; ++b)
        {
            notes.clear();
            for (int c = 0; c < 2; ++c)
                for (int i = 0; i < kBlock; ++i)
                    buf.setSample (c, i, isInstrument ? 0.0f
                                                      : 0.35f * (rng.nextFloat() * 2.0f - 1.0f));
            if (isInstrument && b == 0) notes.push_back ({ true, 60, 261.63f, 0.8f, 0 });
            eng.process (buf, isInstrument ? &notes : nullptr);
            for (int c = 0; c < 2; ++c)
            {
                const float* d = buf.getReadPointer (c);
                for (int i = 0; i < kBlock; ++i)
                {
                    if (! std::isfinite (d[i])) return false;
                    peak = std::max (peak, std::abs (d[i]));
                }
            }
        }
        return peak < 1.0e-5f;
    }

    inline juce::String buildSilenceFixMessage (bool isInstrument)
    {
        juce::StringArray s;
        s.add ("I rendered the plugin you just returned at its DEFAULT parameter values "
               + juce::String (isInstrument ? "while holding middle C for a second" : "with white noise at its input")
               + " and the output was completely silent.");
        s.add ("");
        s.add ("That is a bug in the defaults or the signal path. Typical causes: a filter cutoff, level, gain,");
        s.add ("mix or amount whose \"default\" is 0 (or at the inaudible end of its range); a cutoff mapped so");
        s.add ("that its default closes the filter; an envelope that never opens; a wet/dry mix that defaults");
        s.add ("to a silent end; or an output stage that multiplies by a parameter left at 0.");
        s.add ("");
        s.add ("Fix it so the plugin is clearly audible out of the box: pick musical, audible defaults (a filter");
        s.add ("cutoff around the middle of its range or wide open, level around 0.7-1.0, mix around 50%), and make");
        s.add ("sure a cutoff at its MINIMUM still passes some signal (clamp the frequency to a sane floor such as");
        s.add ("20 Hz and never divide by or multiply with a raw 0). Keep the parameter indices and the GUI");
        s.add ("unchanged unless a default in the params list must change.");
        s.add ("");
        s.add ("Return the full corrected JSON (assembly + html + params + explanation).");
        return s.joinIntoString ("\n");
    }
}
