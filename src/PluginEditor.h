// PluginEditor.h
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include <vector>
#include <memory>
#include "PluginProcessor.h"
#include "SourceEditor.h"
#include "StandardUiPanel.h"
#include "HistoryPanel.h"
#include "Spinner.h"

class VstaiAudioProcessorEditor : public juce::AudioProcessorEditor,
                                  private juce::Timer
{
public:
    explicit VstaiAudioProcessorEditor (VstaiAudioProcessor&);
    ~VstaiAudioProcessorEditor() override;

    void resized() override;
    void paint (juce::Graphics&) override;

private:
    void doGenerate();
    void doGenerateManual();   // "bring your own chatbot" flow (no API key/tokens)
    void doNew();
    void doSave();
    void doLoad();
    void doSaveCompile();      // recompile the hand-edited source
    void doFixWithAI();        // send the edited source (+ diagnostics) to the model
    void reseedEditors();      // load the document's source into the code editors
    void setProblems (const juce::String& text, bool isError);
    void refreshWebView();
    void setBusy (bool busy, const juce::String& status);
    void setStage (const juce::String& stage);   // update status text while busy

    // Serves the generated HTML + the window.vstai bridge to the WebView.
    std::optional<juce::WebBrowserComponent::Resource> provideResource (const juce::String& url);

    VstaiAudioProcessor& processor;

    void onModelChanged();
    void onEffortChanged();

    // Provider/model selection.
    struct ModelOption { juce::String provider, id, label; };
    std::vector<ModelOption> modelOptions;   // parallel to modelBox item ids (id = index + 1)
    juce::StringArray        ollamaModels;   // discovered local models
    juce::String             currentProvider { "anthropic" };

    void rebuildModelBox();            // (re)populate the dropdown from modelOptions + ollamaModels
    void refreshOllamaModelsAsync();   // poll the Ollama server off the message thread
    void openSettings();               // "Keys…" dialog: Anthropic/GLM keys + Ollama URL
    void openAccount();                // "Account…" dialog: VibePlugin Cloud sign-in + credits
    void openLicense();                // "License…" dialog: activate a lifetime license
    void showNag();                    // the friendly shareware warning (joke)
    void updateLicenseButton();        // reflect licensed/unlicensed in the toolbar
    void revalidateLicenseAsync();     // background re-check on open (fail-open)
    void updateEffortEnablement (bool busy);
    void applyThinkingLayout();        // show/hide the live reasoning strip + relayout
    void refreshThinkingView();        // repaint the panel with the last N reasoning lines
    void timerCallback() override;     // throttles live-reasoning repaints (keeps the UI fluid)
    void syncBuildState();             // restore busy/spinner from the processor (survives reopen)

    std::unique_ptr<juce::LookAndFeel_V4> lnf;   // app-wide dark/accent theme

    juce::Label       titleLabel;                // header brand strip
    juce::TextEditor  promptBox;
    juce::TextButton  generateButton { "Generate" };
    juce::TextButton  chatbotButton  { "Copy to chatbot" };   // free manual flow (no key)
    juce::TextButton  newButton  { "New" };
    juce::TextButton  saveButton { "Save" };
    juce::TextButton  loadButton { "Load" };
    juce::TextButton  keysButton { "Keys..." };
    juce::TextButton  accountButton { "Account..." };
    juce::TextButton  licenseButton { "License..." };
    juce::ComboBox    modelBox;
    juce::ComboBox    effortBox;
    juce::ToggleButton thinkButton { "On" };   // GLM reasoning on/off (shares the effort slot)
    juce::Label       modelLabel;
    juce::Label       effortLabel;
    juce::Label       statusLabel;
    Spinner           spinner;

    // Collapsible live-reasoning panel — streams GLM's thinking (direct GLM only).
    juce::TextButton  thinkingToggle;
    juce::TextEditor  thinkingView;
    bool              thinkingExpanded { false };
    juce::String      thinkingBuffer;            // accumulated reasoning (bounded)
    bool              thinkingDirty { false };   // a repaint is pending

    // ---- code editors, tabbed alongside the live GUI --------------------
    // Declared so `tabs` (which hosts the others as tab content) is destroyed
    // first, and the tokenisers outlive the editors that reference them.
    juce::TextButton  compileButton { "Save & Compile" };
    juce::TextButton  fixButton     { "Fix with AI" };
    juce::TextButton  revertButton  { "Revert" };

    juce::CPlusPlusCodeTokeniser  asmTokeniser;    // AssemblyScript ~ C-family
    juce::XmlTokeniser            htmlTokeniser;
    juce::TextEditor              problemsView;     // compiler output / errors
    std::unique_ptr<SourceEditor> asmEditor;
    std::unique_ptr<SourceEditor> htmlEditor;
    std::unique_ptr<StandardUiPanel> standardPanel;  // editable house-style kit
    std::unique_ptr<HistoryPanel> historyPanel;      // prompt browser
    std::unique_ptr<juce::WebBrowserComponent> web;
    juce::TabbedComponent         tabs { juce::TabbedButtonBar::TabsAtTop };
    juce::String                  lastDiagnostics;

    std::unique_ptr<juce::FileChooser> chooser;

    // The Keys/Account/License/nag/Manual dialogs are top-level desktop windows, not
    // children of this editor, so they would outlive it when the host closes the plugin
    // and stay open as orphans (and their callbacks could fire against a destroyed
    // editor). Track every one we launch and close them all in the destructor.
    void trackDialog (juce::Component*);
    juce::Array<juce::Component::SafePointer<juce::Component>> openDialogs;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (VstaiAudioProcessorEditor)
};
