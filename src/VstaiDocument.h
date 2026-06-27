// VstaiDocument.h
// =====================================================================
//  The .vstai file: a JSON document holding everything needed to restore
//  a generated plugin — the compiled WASM (base64), the HTML GUI, the
//  AssemblyScript source, the prompt history, and parameter metadata.
//
//  This same JSON is what gets written into the DAW's session state, so a
//  reopened project restores the exact plugin.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <vector>

struct VstaiParam
{
    juce::String name;
    int          index   = 0;
    double       minVal  = 0.0;
    double       maxVal  = 1.0;
    double       defVal  = 0.0;
    double       value   = 0.0; // last value (persisted)
};

// One entry in the prompt browser: a full snapshot of the plugin after a build
// (generate / fix / manual compile). The timeline is append-only — stepping back
// and generating again creates a new entry whose `parent` points to where you
// branched from, so a bad generation never destroys earlier work.
struct VstaiRevision
{
    int                       id       = 0;   // stable; survives capping
    int                       parent   = 0;   // id this branched from (0 = root)
    juce::String              prompt;          // what produced this (or a label)
    juce::String              assembly;
    juce::String              html;
    juce::String              explanation;
    juce::String              provider;
    juce::String              model;
    std::vector<uint8_t>      wasm;
    std::vector<VstaiParam>   params;
    bool                      isInstrument = false;
    juce::int64               timestamp = 0;   // ms since epoch
};

class VstaiDocument
{
public:
    static constexpr int kFormatVersion = 1;

    juce::String              name = "Untitled";
    juce::StringArray         promptHistory;     // chronological prompts
    juce::String              assembly;          // AssemblyScript source (index.ts)
    juce::String              html;              // GUI document
    std::vector<uint8_t>      wasm;              // assembled module bytes
    std::vector<VstaiParam>   params;
    juce::String              lastExplanation;
    bool                      isInstrument = false; // effect vs synth

    // Generation settings (persisted so a reopened project keeps your choice).
    juce::String              provider = "anthropic";       // anthropic | glm | ollama | cloud
    juce::String              model  = "claude-opus-4-8";   // claude-* / glm-* / an Ollama model
    juce::String              effort = "medium";            // low | medium | high | max (anthropic)
    bool                      thinking = true;              // glm: reasoning on/off

    // Prompt-browser timeline (persisted). `activeRevision` is the id currently
    // loaded; the most recent full snapshots are kept (older ones drop off).
    static constexpr int      kMaxRevisions = 25;
    std::vector<VstaiRevision> revisions;
    int                       activeRevision = 0;   // id, 0 = none
    int                       nextRevisionId = 1;

    bool hasPlugin() const { return ! wasm.empty() && html.isNotEmpty(); }

    // Snapshot the current live state onto the timeline (branching from the
    // active revision). Called after every successful build.
    void pushRevision (const juce::String& promptLabel);

    // Load a revision by id into the live fields. Returns false if not found.
    bool restoreRevision (int id);

    // --- JSON <-> document ------------------------------------------------
    juce::var toVar() const;
    static VstaiDocument fromVar (const juce::var& v);

    juce::String toJsonString() const;
    static VstaiDocument fromJsonString (const juce::String& json);

    // --- disk -------------------------------------------------------------
    bool saveToFile (const juce::File& file, juce::String& errorOut) const;
    static bool loadFromFile (const juce::File& file, VstaiDocument& out, juce::String& errorOut);

    // --- ingest a generated artifact -------------------------------------
    // Updates assembly/html/params from the parsed artifact (assembly, html,
    // params, explanation), stores the freshly compiled `wasmBytes`, and
    // appends `prompt` to the history.
    void applyBuildResult (const juce::var& artifact,
                           const std::vector<uint8_t>& wasmBytes,
                           const juce::String& prompt);
};
