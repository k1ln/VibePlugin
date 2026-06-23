// WebEditor.h
// =====================================================================
//  The WebView-based plugin editor: the entire chrome (prompt, model
//  controls, status, code tabs, live preview) is an HTML single-page app
//  served from the bundle's Resources/ui, talking to C++ through JUCE 8's
//  native-integration bridge (withNativeFunction / emitEvent).
//
//  Native bits that must stay native: the OS file dialogs (Save/Load) and
//  the Keys / Account / License dialogs (reused from the legacy editor).
//  The generated plugin GUI is sandboxed in an <iframe> (served at /preview)
//  so AI-generated JS can't reach the shell.
//
//  VstaiAudioProcessorEditor (the native editor) is kept as a fallback,
//  selectable via appsettings::useWebShell().
// =====================================================================

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include <memory>
#include <thread>
#include "PluginProcessor.h"

class WebEditor : public juce::AudioProcessorEditor,
                  private juce::Timer
{
public:
    explicit WebEditor (VstaiAudioProcessor&);
    ~WebEditor() override;

    void resized() override;

private:
    // Resource provider: shell.html, ui assets, Monaco, and the /preview document.
    std::optional<juce::WebBrowserComponent::Resource> provideResource (const juce::String& url);

    // Snapshot of everything the SPA needs to render itself (model list, current
    // selection, licence/account state, document source for the editors).
    juce::var currentState() const;

    // Push an event to the SPA (no-op if the browser isn't visible).
    void emitEvent (const juce::Identifier& id, const juce::var& payload);

    void timerCallback() override;   // throttles the live "thinking" stream

    void refreshOllamaModelsAsync(); // poll the Ollama server off the message thread
    void revalidateLicenseAsync();   // background re-check on open (fail-open)
    void showNag();                  // friendly shareware warning (native dialog)
    void updateLicenseState();       // emit "licenseChanged" so the SPA refreshes

    // The native dialogs (Keys/Account/License/nag) are top-level desktop windows,
    // not children of this editor, so they would outlive it when the host closes the
    // plugin — and their callbacks would then fire against a destroyed WebBrowser /
    // editor and crash the DAW. We track every one we launch and close them all in
    // the destructor, while this editor (and `web`) are still alive.
    void trackDialog (juce::Component*);
    juce::Array<juce::Component::SafePointer<juce::Component>> openDialogs;

    VstaiAudioProcessor& processor;
    std::unique_ptr<juce::WebBrowserComponent> web;
    std::unique_ptr<juce::FileChooser> chooser;

    juce::StringArray ollamaModels;    // discovered local models (added to the catalogue)
    juce::String thinkingBuffer;       // accumulated reasoning (bounded)
    bool         thinkingDirty { false };
    bool         pageReady { false };  // gate emits until the SPA's bridge is up
    juce::String cacheToken;           // per-open token to defeat WebView asset caching

    // Reflect param changes (host automation) back into the live GUI. We poll the
    // engine on the editor timer and push only what changed since last time.
    float lastSentParam[vstai::kMaxParams];
    void  resetParamReflection();      // re-send everything after a (re)load
    void  reflectParamsToGui();        // called from the timer

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (WebEditor)
};
