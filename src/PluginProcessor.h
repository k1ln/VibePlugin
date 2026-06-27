// PluginProcessor.h
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <atomic>
#include <memory>
#include <vector>
#include "WasmEngine.h"
#include "VstaiDocument.h"

class AssemblyScriptCompiler;

// Set per build target: 1 = instrument/synth, 0 = audio effect.
#ifndef VSTAI_IS_SYNTH
 #define VSTAI_IS_SYNTH 0
#endif

// A host-exposed automation parameter. The plugin pre-allocates a fixed pool of
// these (one per possible engine param) so the VST3 parameter set is stable across
// regenerations; each carries a 0..1 normalised value that the processor maps to a
// generated param's real range. The display name is updated live as plugins load
// (host support for live renames varies; the generic "Param N" is the fallback).
class VstaiHostParameter : public juce::AudioParameterFloat
{
public:
    explicit VstaiHostParameter (int idx)
        : juce::AudioParameterFloat (juce::ParameterID ("p" + juce::String (idx), 1),
                                     "Param " + juce::String (idx + 1),
                                     juce::NormalisableRange<float> (0.0f, 1.0f), 0.0f),
          fallbackName ("Param " + juce::String (idx + 1)) {}

    juce::String getName (int maximumStringLength) const override
    {
        return (dynamicName.isNotEmpty() ? dynamicName : fallbackName).substring (0, maximumStringLength);
    }

    juce::String dynamicName, fallbackName;   // dynamicName set on the message thread on load
};

class VstaiAudioProcessor : public juce::AudioProcessor
{
public:
    static constexpr bool kIsSynth = (VSTAI_IS_SYNTH != 0);

    VstaiAudioProcessor();
    ~VstaiAudioProcessor() override;

    // --- AudioProcessor ---------------------------------------------------
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    bool isBusesLayoutSupported (const BusesLayout&) const override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return kIsSynth ? "VibePlugin Synth" : "VibePlugin FX"; }
    bool   acceptsMidi()  const override { return kIsSynth; }
    bool   producesMidi() const override { return false; }
    bool   isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int    getNumPrograms() override { return 1; }
    int    getCurrentProgram() override { return 0; }
    void   setCurrentProgram (int) override {}
    // Surface the loaded plugin's name as the (only) program name. Some hosts show
    // this in the wrapper title; the plugin-list name itself is fixed by VST3.
    const  juce::String getProgramName (int) override
    {
        return document.name.isNotEmpty() && document.name != "Untitled" ? document.name
                                                                         : getName();
    }
    void   changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;

    // --- VibePlugin API (called from the editor) -----------------------------

    // Generate/iterate a plugin from a prompt; reloads the engine on success.
    // `progress` is called on the message thread as the build moves through its
    // stages (generating / compiling / installing) so the UI can reflect them.
    using BuildDone     = std::function<void (bool ok, juce::String message)>;
    using BuildProgress = std::function<void (const juce::String& stage)>;
    void requestBuild (const juce::String& prompt, BuildProgress progress, BuildDone done);

    // Manual ("bring your own chatbot") path: the artifact was parsed from a
    // pasted chatbot reply rather than generated here. Compile it once (no AI
    // auto-fix — there is no model to ask) and install on success; on failure
    // `done` carries the compiler diagnostics so the user can paste them back
    // to their chatbot for a fix.
    void requestBuildFromArtifact (const juce::String& prompt, const juce::var& artifact,
                                   BuildProgress progress, BuildDone done);

    // Compile hand-edited source (no AI). On success the edited assembly/html
    // replace the document, the engine + GUI reload, and `done` reports ok with
    // empty diagnostics; on failure the live plugin is left untouched and `done`
    // carries the compiler output. `progress` mirrors requestBuild's stages.
    using RecompileDone = std::function<void (bool ok, juce::String diagnostics)>;
    void requestRecompile (const juce::String& assembly, const juce::String& html,
                           BuildProgress progress, RecompileDone done);

    // Stash hand-edited source into the document without compiling, so a
    // subsequent requestBuild ("Fix with AI") sends the user's current edits.
    void applyEditedSource (const juce::String& assembly, const juce::String& html);

    // Prompt browser: jump to a past revision by id, reloading engine + GUI.
    void restoreRevision (int id);

    // GUI param bridge.
    void setParamFromGui (int index, float value);
    float getParamValue (int index) const { return engine.getParam (index); }

    // GUI on-screen keyboard (synth builds). note = MIDI note number.
    void noteFromGui (int note, float velocity, bool on);

    // GUI sample upload, streamed through the bridge (begin -> data* -> end).
    // All called on the message thread from the resource provider.
    //   beginSampleUpload: start a transfer; returns the engine's sample capacity
    //                      (frames/channel, 0 if this plugin has no sample buffer)
    //                      so the GUI can clamp before sending.
    //   appendSampleData : append a decoded planar-f32 chunk.
    //   endSampleUpload  : push the staged PCM into the engine; returns "" on
    //                      success or a human-readable error.
    int          beginSampleUpload (int channels, int frames, double sampleRate);
    void         appendSampleData  (const void* bytes, size_t numBytes);
    juce::String endSampleUpload   ();

    bool isInstrument() const { return kIsSynth; }

    // Reset to the blank starter plugin (keeps the model/effort choice).
    void newPlugin();

    // Generation settings, driven by the editor dropdowns and persisted.
    void         setGenerationProvider (const juce::String& p) { document.provider = p; }
    void         setGenerationModel    (const juce::String& m) { document.model  = m; }
    void         setGenerationEffort   (const juce::String& e) { document.effort = e; }
    void         setGenerationThinking (bool b)                { document.thinking = b; }
    juce::String getGenerationProvider() const { return document.provider; }
    juce::String getGenerationModel()    const { return document.model; }
    juce::String getGenerationEffort()   const { return document.effort; }
    bool         getGenerationThinking() const { return document.thinking; }

    // Save/load .vstai to/from disk.
    bool saveDocument (const juce::File&, juce::String& errorOut);
    bool loadDocument (const juce::File&, juce::String& errorOut);

    const VstaiDocument& getDocument() const { return document; }
    juce::String getDisplayHtml() const;     // current GUI, or the default starter GUI

    // Editor subscribes to be notified when the plugin (html/wasm) changes.
    std::function<void()> onDocumentChanged;

    // Editor subscribes to receive GLM reasoning as it streams (called on the
    // message thread, one chunk at a time). Empty when no editor is listening.
    std::function<void (const juce::String&)> onThinkingDelta;

    // Build progress is processor-owned, so a reopened editor can resync: the AI
    // build keeps running on the processor even while no editor is attached.
    std::function<void()> onBuildStateChanged;        // fired on the message thread
    bool         isBuilding()   const { return building.load(); }
    juce::String getBuildStage() const { return buildStage; }

private:
    // Bus layout for this build (effect = in+out, synth = out only). A static
    // member so it can name the protected BusesProperties type.
    static BusesProperties makeBuses();

    void loadDocumentIntoEngine();           // (re)instantiate wasm + apply params
    void notifyChanged();

    // ---- host automation -------------------------------------------------
    void setupHostParameters();              // ctor: create the fixed pool
    void syncHostParameters();               // on load: ranges/names/values from document.params
    void pushHostParamsToEngine();           // processBlock: host automation -> engine
    float normToActual (int i, float norm)  const { return hostMin[i] + norm * (hostMax[i] - hostMin[i]); }
    float actualToNorm (int i, float value) const
    {
        const float r = hostMax[i] - hostMin[i];
        return r != 0.0f ? juce::jlimit (0.0f, 1.0f, (value - hostMin[i]) / r) : 0.0f;
    }

    std::vector<VstaiHostParameter*> hostParams;       // pool; owned by the AudioProcessor base
    float hostMin[vstai::kMaxParams] = { 0 };
    float hostMax[vstai::kMaxParams];                  // initialised to 1 in setupHostParameters
    bool  hostActive[vstai::kMaxParams] = { false };   // which engine indices carry real metadata

    WasmEngine    engine;
    VstaiDocument document;
    std::shared_ptr<AssemblyScriptCompiler> compiler; // shared so module JIT is reused

    double currentSampleRate = 44100.0;
    int    currentBlockSize  = 512;
    int    maxFixAttempts    = 3;

    // Notes injected by the GUI keyboard, drained on the audio thread.
    std::vector<WasmEngine::NoteEvent> guiNotes;
    juce::SpinLock                     guiNotesLock;

    // In-flight GUI sample upload (message thread only; reassembled before the
    // single engine.loadSample() call on `end`).
    juce::MemoryBlock sampleStaging;
    int    sampleUpChannels = 0;
    int    sampleUpFrames   = 0;
    double sampleUpRate     = 44100.0;

    // Keeps in-flight build threads from touching a destroyed processor.
    std::shared_ptr<std::atomic<bool>> alive { std::make_shared<std::atomic<bool>> (true) };

    // Whether an AI build is in flight, plus its latest progress label. Owned by
    // the processor so the busy UI survives the editor being closed and reopened.
    std::atomic<bool> building { false };
    juce::String      buildStage;        // written only on the message thread

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (VstaiAudioProcessor)
};
