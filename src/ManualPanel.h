// ManualPanel.h
// =====================================================================
//  The "bring your own chatbot" generation dialog — the free, no-API-key,
//  no-token path. Flow:
//
//    1. The prompt (built with vstai::buildManualPrompt — DIFFERENT from the
//       API prompt: it asks for fenced code blocks, not a JSON schema) is
//       copied to the clipboard the moment the dialog opens.
//    2. The user pastes it into ChatGPT / Claude / any chatbot and pastes the
//       full reply back into the box here.
//    3. "Apply" parses the fenced blocks (vstai::parseManualReply) and compiles
//       them via the processor. If the DSP doesn't compile, the compiler output
//       is shown plus a "Copy fix request" button that puts a fix prompt on the
//       clipboard to paste back into the same chat.
// =====================================================================

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include "Prompt.h"

class ManualPanel : public juce::Component
{
public:
    ManualPanel (VstaiAudioProcessor& p, juce::String userPrompt)
        : processor (p), prompt (std::move (userPrompt))
    {
        title.setText ("Generate with any chatbot — free, no API key", juce::dontSendNotification);
        title.setFont (juce::Font (juce::FontOptions (16.0f)));
        title.setColour (juce::Label::textColourId, juce::Colour (0xff9fb4d8));
        addAndMakeVisible (title);

        intro.setColour (juce::Label::textColourId, juce::Colours::lightgrey);
        intro.setJustificationType (juce::Justification::topLeft);
        intro.setText ("1.  The prompt is on your clipboard. Paste it into ChatGPT, Claude, Gemini "
                       "or any chatbot.\n"
                       "2.  Paste the chatbot's FULL reply into the box below.\n"
                       "3.  Click “Apply pasted result”.",
                       juce::dontSendNotification);
        addAndMakeVisible (intro);

        copyPromptBtn.onClick = [this] { copyPrompt(); };
        addAndMakeVisible (copyPromptBtn);

        pasteBox.setMultiLine (true, true);
        pasteBox.setReturnKeyStartsNewLine (true);
        pasteBox.setScrollbarsShown (true);
        pasteBox.setFont (juce::Font (juce::FontOptions()
                                          .withName (juce::Font::getDefaultMonospacedFontName())
                                          .withHeight (12.0f)));
        pasteBox.setTextToShowWhenEmpty ("Paste the chatbot's reply here…", juce::Colours::grey);
        pasteBox.setColour (juce::TextEditor::backgroundColourId, juce::Colour (0xff0c0f16));
        pasteBox.setColour (juce::TextEditor::outlineColourId,    juce::Colour (0xff2a3344));
        addAndMakeVisible (pasteBox);

        applyBtn.onClick = [this] { apply(); };
        addAndMakeVisible (applyBtn);

        copyFixBtn.onClick = [this] { copyFix(); };
        addChildComponent (copyFixBtn);   // shown only after a failed compile

        status.setColour (juce::Label::textColourId, juce::Colours::lightgrey);
        status.setJustificationType (juce::Justification::topLeft);
        addAndMakeVisible (status);

        setSize (560, 480);
        copyPrompt();   // prime the clipboard the moment we open
    }

    void resized() override
    {
        auto r = getLocalBounds().reduced (14);
        title.setBounds (r.removeFromTop (24));
        r.removeFromTop (4);
        intro.setBounds (r.removeFromTop (66));
        r.removeFromTop (4);

        auto topRow = r.removeFromTop (28);
        copyPromptBtn.setBounds (topRow.removeFromLeft (180));
        r.removeFromTop (8);

        auto bottom = r.removeFromBottom (52);
        auto btnRow = bottom.removeFromTop (30);
        applyBtn.setBounds   (btnRow.removeFromLeft (170));
        btnRow.removeFromLeft (8);
        copyFixBtn.setBounds (btnRow.removeFromLeft (200));
        status.setBounds (bottom);

        r.removeFromBottom (6);
        pasteBox.setBounds (r);
    }

private:
    void setStatus (const juce::String& s, bool error = false)
    {
        status.setColour (juce::Label::textColourId, error ? juce::Colour (0xffff8888)
                                                           : juce::Colours::lightgrey);
        status.setText (s, juce::dontSendNotification);
    }

    void copyPrompt()
    {
        const auto& d = processor.getDocument();
        const auto text = vstai::buildManualPrompt (prompt, d.assembly, d.html, processor.isInstrument());
        juce::SystemClipboard::copyTextToClipboard (text);
        setStatus ("Prompt copied to clipboard — paste it into a chatbot.");
    }

    void copyFix()
    {
        juce::SystemClipboard::copyTextToClipboard (vstai::buildManualFixPrompt (failedAssembly, lastDiag));
        setStatus ("Fix request copied — paste it back into the SAME chat, then paste its new reply above.");
    }

    void apply()
    {
        const auto reply = pasteBox.getText();
        if (reply.trim().isEmpty()) { setStatus ("Paste the chatbot's reply first.", true); return; }

        juce::var artifact;
        juce::String err;
        if (! vstai::parseManualReply (reply, artifact, err))
        {
            setStatus (err, true);
            return;
        }

        failedAssembly = artifact.getProperty ("assembly", {}).toString();
        applyBtn.setEnabled (false);
        copyFixBtn.setVisible (false);
        setStatus ("Compiling pasted code…");

        juce::Component::SafePointer<ManualPanel> safe (this);
        processor.requestBuildFromArtifact (prompt, artifact,
            [safe] (const juce::String& stage) { if (safe != nullptr) safe->setStatus (stage); },
            [safe] (bool ok, juce::String message)
            {
                if (safe == nullptr) return;
                safe->applyBtn.setEnabled (true);
                if (ok)
                {
                    safe->setStatus ("Done — your plugin was built and installed. "
                                     + message + "\nYou can close this window.");
                    safe->copyFixBtn.setVisible (false);
                }
                else
                {
                    safe->lastDiag = message;
                    safe->setStatus ("It didn't compile:\n" + message
                                     + "\n\nClick “Copy fix request”, paste it back to the chatbot, "
                                       "then paste the new reply above.", true);
                    safe->copyFixBtn.setVisible (true);
                    safe->resized();
                }
            });
    }

    VstaiAudioProcessor& processor;
    juce::String prompt;
    juce::String failedAssembly, lastDiag;

    juce::Label      title, intro, status;
    juce::TextButton copyPromptBtn { "Copy prompt again" };
    juce::TextEditor pasteBox;
    juce::TextButton applyBtn   { "Apply pasted result" };
    juce::TextButton copyFixBtn { "Copy fix request →" };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ManualPanel)
};
