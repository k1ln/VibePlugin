// HistoryPanel.h
// =====================================================================
//  The prompt browser: a list of every revision on the document timeline
//  (newest first), with the active one marked. Double-click or "Restore"
//  jumps back to that version — the engine + GUI + code editors reload, and
//  nothing is lost because the timeline is append-only (generating from an
//  older point branches rather than truncates). Reads live from the
//  processor's document; call refresh() when the document changes.
// =====================================================================

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>
#include "PluginProcessor.h"

class HistoryPanel : public juce::Component,
                     private juce::ListBoxModel
{
public:
    explicit HistoryPanel (VstaiAudioProcessor& p) : processor (p)
    {
        list.setModel (this);
        list.setRowHeight (46);
        list.setColour (juce::ListBox::backgroundColourId, juce::Colour (0xff0c0f16));
        addAndMakeVisible (list);

        restoreButton.onClick = [this] { restoreSelected(); };
        addAndMakeVisible (restoreButton);

        hint.setJustificationType (juce::Justification::centred);
        hint.setColour (juce::Label::textColourId, juce::Colours::grey);
        hint.setText ("No history yet. Each generated, AI-fixed, or hand-compiled version "
                      "shows up here so you can step back if something goes wrong.",
                      juce::dontSendNotification);
        addChildComponent (hint);

        refresh();
    }

    // Fired with the revision id to restore.
    std::function<void (int revisionId)> onRestore;

    void refresh()
    {
        const bool empty = processor.getDocument().revisions.empty();
        hint.setVisible (empty);
        list.setVisible (! empty);
        list.updateContent();
        list.repaint();
    }

    void resized() override
    {
        auto r = getLocalBounds().reduced (8);
        auto bottom = r.removeFromBottom (30);
        restoreButton.setBounds (bottom.removeFromLeft (160));
        r.removeFromBottom (6);
        list.setBounds (r);
        hint.setBounds (getLocalBounds().reduced (24));
    }

private:
    // Rows are newest-first; map a row index to its revision.
    const VstaiRevision* revisionForRow (int row) const
    {
        const auto& revs = processor.getDocument().revisions;
        const int n = (int) revs.size();
        if (row < 0 || row >= n) return nullptr;
        return &revs[(size_t) (n - 1 - row)];
    }

    void restoreSelected()
    {
        if (auto* r = revisionForRow (list.getSelectedRow()))
            if (onRestore) onRestore (r->id);
    }

    // --- ListBoxModel -----------------------------------------------------
    int getNumRows() override { return (int) processor.getDocument().revisions.size(); }

    void paintListBoxItem (int row, juce::Graphics& g, int w, int h, bool selected) override
    {
        auto* r = revisionForRow (row);
        if (r == nullptr) return;

        const bool isActive = (r->id == processor.getDocument().activeRevision);
        if (selected)       g.fillAll (juce::Colour (0xff21304a));
        else if (isActive)  g.fillAll (juce::Colour (0xff15202e));

        auto area = juce::Rectangle<int> (0, 0, w, h).reduced (10, 6);

        const auto firstLine = r->prompt.isEmpty()
                                   ? juce::String ("(untitled)")
                                   : r->prompt.upToFirstOccurrenceOf ("\n", false, false);
        g.setColour (isActive ? juce::Colour (0xff9fd0ff) : juce::Colour (0xffe7ecf4));
        g.setFont (juce::Font (juce::FontOptions (14.0f)));
        g.drawText ((isActive ? juce::String (juce::CharPointer_UTF8 ("\xe2\x97\x8f ")) : juce::String())
                        + firstLine,
                    area.removeFromTop (20), juce::Justification::centredLeft, true);

        const auto when = juce::Time (r->timestamp).toString (true, true, false, true);
        g.setColour (juce::Colours::grey);
        g.setFont (juce::Font (juce::FontOptions (11.0f)));
        g.drawText (when + "   " + r->model + (r->isInstrument ? "   synth" : "   fx"),
                    area, juce::Justification::centredLeft, true);
    }

    void listBoxItemDoubleClicked (int row, const juce::MouseEvent&) override
    {
        if (auto* r = revisionForRow (row))
            if (onRestore) onRestore (r->id);
    }

    VstaiAudioProcessor& processor;
    juce::ListBox    list;
    juce::TextButton restoreButton { "Restore selected" };
    juce::Label      hint;
};
