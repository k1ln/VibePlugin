// StandardUiPanel.h
// =====================================================================
//  The "Standard UI" tab: an editable view of the standard component kit
//  (the house style fed to the model on every build), with Save and a
//  "Reset to default" escape hatch. Self-contained so it lays out its own
//  editor + buttons inside the TabbedComponent's content area.
// =====================================================================

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>
#include "SourceEditor.h"

class StandardUiPanel : public juce::Component
{
public:
    StandardUiPanel()
    {
        editor = std::make_unique<SourceEditor> (&tok);
        editor->onSave = [this] { if (onSave) onSave(); };   // Cmd/S also saves
        addAndMakeVisible (*editor);

        hint.setText ("Your standard component kit. The model gets this as the GUI house "
                      "style for every generation. Edit it, or let the AI improve it.",
                      juce::dontSendNotification);
        hint.setColour (juce::Label::textColourId, juce::Colours::grey);
        hint.setJustificationType (juce::Justification::centredLeft);
        hint.setMinimumHorizontalScale (1.0f);
        addAndMakeVisible (hint);

        saveButton.onClick  = [this] { if (onSave)  onSave();  };
        resetButton.onClick = [this] { if (onReset) onReset(); };
        addAndMakeVisible (saveButton);
        addAndMakeVisible (resetButton);
    }

    juce::String getText() const            { return editor->getText(); }
    void setText (const juce::String& text)  { editor->setText (text); }

    std::function<void()> onSave;
    std::function<void()> onReset;

    void resized() override
    {
        auto r = getLocalBounds();
        auto bar = r.removeFromBottom (38).reduced (10, 6);
        resetButton.setBounds (bar.removeFromRight (130));
        bar.removeFromRight (6);
        saveButton.setBounds  (bar.removeFromRight (90));
        bar.removeFromRight (10);
        hint.setBounds (bar);
        editor->setBounds (r);
    }

private:
    juce::XmlTokeniser            tok;            // outlives the editor below
    std::unique_ptr<SourceEditor> editor;
    juce::Label      hint;
    juce::TextButton saveButton  { "Save" };
    juce::TextButton resetButton { "Reset to default" };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StandardUiPanel)
};
