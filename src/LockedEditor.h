// LockedEditor.h
// =====================================================================
//  The product-only editor for an exported / whitelabel plugin. When a creation
//  is locked (a baked Resources/baked.vstai, document.locked, or VSTAI_FORCE_LOCKED)
//  the processor opens this instead of the authoring shell.
//
//  It is a single WebBrowserComponent that serves *only* the generated GUI
//  full-window, wired to the host through the same fetch bridge the authoring
//  editor injects (BridgeShim.h). There is deliberately no shell.html, no Monaco,
//  no dialogs, and no JUCE native-integration backend — nothing to escape to.
// =====================================================================

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include <memory>
#include <optional>
#include "PluginProcessor.h"

class LockedEditor : public juce::AudioProcessorEditor,
                     private juce::Timer
{
public:
    explicit LockedEditor (VstaiAudioProcessor&);
    ~LockedEditor() override;

    void resized() override;

private:
    // Serves the product GUI (with the bridge shim) and the /__vstai/* fetch bridge.
    std::optional<juce::WebBrowserComponent::Resource> provideResource (const juce::String& url);

    void timerCallback() override;     // push host-automation changes into the GUI
    void reflectParamsToGui();

    VstaiAudioProcessor& processor;
    std::unique_ptr<juce::WebBrowserComponent> web;

    // Mirror host-automation param values into the on-screen controls, sending only
    // what changed since last poll. The sentinel forces a full resync after load.
    float lastSentParam[vstai::kMaxParams];
    bool  pageReady { false };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LockedEditor)
};
