// MidiRouter.h
// =====================================================================
//  Turns one block of host MIDI (plus notes from the on-screen keyboard)
//  into the engine's sample-positioned note and controller events, and owns
//  the sustain pedal so every generated instrument gets it for free.
//
//  Sustain: while CC64 is down, a note-off is held back and the note marked
//  "sustained"; lifting the pedal releases them all at the pedal's frame.
//  Replaying a note that only sounds because of the pedal sends noteOff then
//  noteOn, so the module can retrigger cleanly. CC64 itself is never passed
//  on — modules must not implement sustain (see WasmAbi.h).
//  CC120 / CC123 (all sound / all notes off) release everything.
//
//  Audio-thread only; allocation-free once the output vectors have grown.
// =====================================================================

#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <bitset>
#include <vector>
#include "WasmEngine.h"

class MidiRouter
{
public:
    using NoteEvent    = WasmEngine::NoteEvent;
    using ControlEvent = WasmEngine::ControlEvent;

    void reset()
    {
        held.reset();
        sustained.reset();
        pedalDown = false;
    }

    // `guiNotes` land at frame 0 (the keyboard isn't sample-timed). Output
    // vectors are cleared first.
    void route (const juce::MidiBuffer& midi,
                const std::vector<NoteEvent>& guiNotes,
                std::vector<NoteEvent>& notesOut,
                std::vector<ControlEvent>& controlsOut)
    {
        notesOut.clear();
        controlsOut.clear();

        for (const auto& g : guiNotes)
            note (g.on, g.id, g.vel, 0, notesOut);

        for (const auto meta : midi)
        {
            const auto& m = meta.getMessage();
            const int at = meta.samplePosition;

            if (m.isNoteOn())
                note (true, m.getNoteNumber(), m.getFloatVelocity(), at, notesOut);
            else if (m.isNoteOff())   // includes note-on with velocity 0
                note (false, m.getNoteNumber(), 0.0f, at, notesOut);
            else if (m.isSustainPedalOn())
                pedalDown = true;
            else if (m.isSustainPedalOff())
            {
                pedalDown = false;
                releaseSustained (at, notesOut);
            }
            else if (m.isAllNotesOff() || m.isAllSoundOff())
            {
                pedalDown = false;
                releaseAll (at, notesOut);
            }
            else if (m.isController())
                controlsOut.push_back ({ m.getControllerNumber(), (float) m.getControllerValue() / 127.0f, at });
            else if (m.isPitchWheel())
                controlsOut.push_back ({ vstai::kControlPitchBend,
                                         juce::jlimit (-1.0f, 1.0f, (float) (m.getPitchWheelValue() - 8192) / 8192.0f), at });
            else if (m.isChannelPressure())
                controlsOut.push_back ({ vstai::kControlPressure, (float) m.getChannelPressureValue() / 127.0f, at });
        }
    }

    bool isSustainDown() const { return pedalDown; }

private:
    void note (bool on, int n, float vel, int at, std::vector<NoteEvent>& out)
    {
        if (n < 0 || n > 127) return;
        if (on)
        {
            if (sustained[(size_t) n])          // sounding only because of the pedal
            {
                out.push_back ({ false, n, 0.0f, 0.0f, at });
                sustained[(size_t) n] = false;
            }
            held[(size_t) n] = true;
            out.push_back ({ true, n, (float) juce::MidiMessage::getMidiNoteInHertz (n), vel, at });
        }
        else
        {
            held[(size_t) n] = false;
            if (pedalDown) sustained[(size_t) n] = true;
            else           out.push_back ({ false, n, 0.0f, 0.0f, at });
        }
    }

    void releaseSustained (int at, std::vector<NoteEvent>& out)
    {
        for (int n = 0; n < 128; ++n)
            if (sustained[(size_t) n] && ! held[(size_t) n])
                out.push_back ({ false, n, 0.0f, 0.0f, at });
        sustained.reset();
    }

    void releaseAll (int at, std::vector<NoteEvent>& out)
    {
        for (int n = 0; n < 128; ++n)
            if (held[(size_t) n] || sustained[(size_t) n])
                out.push_back ({ false, n, 0.0f, 0.0f, at });
        held.reset();
        sustained.reset();
    }

    std::bitset<128> held, sustained;
    bool pedalDown = false;
};
