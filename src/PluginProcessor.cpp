// PluginProcessor.cpp
#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "WebEditor.h"
#include "LockedEditor.h"
#include "PluginExport.h"
#include "LlmClient.h"
#include "AssemblyScriptCompiler.h"
#include "Prompt.h"
#include "DevLog.h"
#include "Settings.h"
#include "AppSettings.h"
#include <thread>

namespace
{
    // Minimal starter GUI shown before anything is generated. (Mirrors
    // web/index.html; kept inline so the plugin needs no bundled resources.)
    const char* kDefaultHtml = R"HTML(<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>:root{color-scheme:dark}body{margin:0;height:100vh;display:flex;flex-direction:column;
align-items:center;justify-content:center;gap:18px;font-family:system-ui,sans-serif;
background:radial-gradient(120% 120% at 50% 0%,#1b2230,#0c0f16 70%);color:#e7ecf4}
h1{margin:0;font-size:18px;letter-spacing:.14em;color:#9fb4d8}
.hint{font-size:12px;color:#6c7a93;max-width:320px;text-align:center;line-height:1.5}
input[type=range]{-webkit-appearance:none;width:150px;height:5px;border-radius:3px;background:#2a3344}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;
background:#5b8cff;cursor:pointer;box-shadow:0 0 10px rgba(91,140,255,.6)}
.knob{display:flex;flex-direction:column;align-items:center;gap:8px}
label{font-size:11px;letter-spacing:.1em;color:#8ea2c6;text-transform:uppercase}
.rack{display:flex;gap:40px}.val{font-size:12px;color:#c4d2ea;font-variant-numeric:tabular-nums}</style>
</head><body><h1>VibePlugin</h1>
<div class="rack">
<div class="knob"><label>Gain</label><input id="g" type="range" min="0" max="2" step="0.01" value="1"/><span class="val" id="gv">1.00</span></div>
<div class="knob"><label>Tone</label><input id="c" type="range" min="0" max="1" step="0.001" value="1"/><span class="val" id="cv">1.00</span></div>
</div>
<div class="hint">Starter plugin. Type a prompt above and press Generate.</div>
<script>
function withBridge(fn){if(window.vstai&&window.vstai.setParam)return fn();
if(window.vstai&&window.vstai.onReady)return window.vstai.onReady(fn);setTimeout(()=>withBridge(fn),50);}
function bind(id,idx,out){var e=document.getElementById(id),o=document.getElementById(out);
function p(){var v=parseFloat(e.value);o.textContent=v.toFixed(2);if(window.vstai)window.vstai.setParam(idx,v);}
e.addEventListener('input',p);p();}
withBridge(function(){bind('g',0,'gv');bind('c',1,'cv');});
</script></body></html>)HTML";
}

// Trailing return type so BusesProperties resolves in the class's scope (it is
// a protected member of AudioProcessor, not nameable from namespace scope).
auto VstaiAudioProcessor::makeBuses() -> BusesProperties
{
    // Synth: output only. Effect: input + output.
    if (kIsSynth)
        return BusesProperties()
            .withOutput ("Output", juce::AudioChannelSet::stereo(), true);

    return BusesProperties()
        .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
        .withOutput ("Output", juce::AudioChannelSet::stereo(), true);
}

VstaiAudioProcessor::VstaiAudioProcessor()
    : AudioProcessor (makeBuses())
{
    vstai::dev::initLog (getName());
    setupHostParameters();   // fixed pool of host-automatable params (stable VST3 interface)
    document.model    = vstai::settings::model();   // Config.h/env default; dropdown overrides
    document.provider = LlmClient::providerToString (LlmClient::providerForModel (document.model));
    compiler = std::make_shared<AssemblyScriptCompiler>();
    // API key + model come from the compiled-in Config.h (or env); the
    // compiler executable is resolved from Config.h / env / the plugin bundle.
    maybeLoadBakedDocument();   // exported/whitelabel build: load the baked creation, lock the UI
    VSTAI_LOG ("processor created (" + juce::String (kIsSynth ? "synth" : "fx")
               + "), compiler available: " + (compiler->isAvailable() ? "yes" : "no")
               + ", host params: " + juce::String (getParameters().size())
               + (isLocked() ? ", LOCKED (whitelabel)" : ""));
}

// An exported plugin ships its creation as Contents/Resources/baked.vstai. Load it
// here (the host may never call setStateInformation on a fresh insert) and lock the
// editor to the product GUI. VSTAI_FORCE_LOCKED locks the normal plugin for testing.
void VstaiAudioProcessor::maybeLoadBakedDocument()
{
    auto baked = vstai::pluginexport::bakedDocFile();
    if (baked.existsAsFile())
    {
        // An export bundle is always a locked product — lock first, so even a
        // corrupt baked doc can't fall through to the (now-stripped) authoring shell.
        lockedFromBundle = true;
        VstaiDocument loaded;
        juce::String err;
        if (VstaiDocument::loadFromFile (baked, loaded, err))
        {
            document = std::move (loaded);
            document.locked = true;       // belt-and-suspenders: persist the lock through state
            loadDocumentIntoEngine();
            VSTAI_LOG ("loaded baked creation: " + document.name);
        }
        else
            VSTAI_LOG ("baked creation present but failed to load: " + err);
        return;
    }

    if (vstai::pluginexport::forceLocked())
    {
        lockedFromBundle = true;          // lock the current (normal) doc for testing
        VSTAI_LOG ("VSTAI_FORCE_LOCKED set — opening in locked product mode");
    }
}

bool VstaiAudioProcessor::exportToBundle (const juce::File& destBundle,
                                          const juce::String& productName,
                                          std::function<void(const juce::String&)> progress,
                                          juce::String& messageOut)
{
    const auto src = vstai::pluginexport::findOwnBundle();
    // The compiled-in identity this build ships with — what patchIdentity rewrites.
    const juce::String oldName = kIsSynth ? "VibePlugin Synth" : "VibePlugin FX";
    const juce::String oldCode = kIsSynth ? "Vssy" : "Vsfx";
    const juce::String profile = vstai::appsettings::notaryProfile();
    return vstai::pluginexport::exportPlugin (src, destBundle, document, productName,
                                              oldName, oldCode, profile, progress, messageOut);
}

VstaiAudioProcessor::~VstaiAudioProcessor()
{
    // Tell any in-flight build thread that `this` is gone.
    alive->store (false);
}

void VstaiAudioProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    currentBlockSize  = samplesPerBlock;
    engine.prepare (sampleRate, samplesPerBlock, getTotalNumOutputChannels());
    if (! engine.isLoaded() && ! document.wasm.empty())
        loadDocumentIntoEngine();
}

bool VstaiAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::mono() && out != juce::AudioChannelSet::stereo())
        return false;
    if (! kIsSynth && layouts.getMainInputChannelSet() != out)
        return false;
    return true;
}

void VstaiAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;

    // Mirror the DAW's tempo into the reserved param slot every block, so tempo-
    // synced DSP (arps, synced delays/LFOs) can read it. 0 if the host reports none.
    {
        float bpm = 0.0f;
        if (auto* ph = getPlayHead())
            if (const auto pos = ph->getPosition())
                if (const auto hostBpm = pos->getBpm())
                    bpm = (float) *hostBpm;
        engine.setParam (vstai::kHostTempoParamIndex, bpm);
    }

    pushHostParamsToEngine();   // apply host automation before the DSP runs

    if (kIsSynth)
    {
        // Instrument: start every block from silence. The loaded DSP overwrites
        // the output; if nothing is loaded (blank/new plugin) the buffer stays
        // silent instead of replaying whatever garbage the host left in it,
        // which otherwise sounds as a stuck, continuous tone.
        buffer.clear();

        // Build note events from incoming MIDI (host converts note -> Hz here)
        // plus any notes the on-screen keyboard queued.
        std::vector<WasmEngine::NoteEvent> notes;
        {
            const juce::SpinLock::ScopedTryLockType sl (guiNotesLock);
            if (sl.isLocked() && ! guiNotes.empty())
            {
                notes.swap (guiNotes);
                guiNotes.clear();
            }
        }
        for (const auto meta : midi)
        {
            const auto m = meta.getMessage();
            if (m.isNoteOn())
                notes.push_back ({ true, m.getNoteNumber(),
                                   (float) juce::MidiMessage::getMidiNoteInHertz (m.getNoteNumber()),
                                   m.getFloatVelocity() });
            else if (m.isNoteOff())
                notes.push_back ({ false, m.getNoteNumber(), 0.0f, 0.0f });
        }
        engine.process (buffer, &notes);
    }
    else
    {
        // Engine passes audio through unchanged if no module is loaded.
        engine.process (buffer);
    }
}

void VstaiAudioProcessor::noteFromGui (int note, float velocity, bool on)
{
    const float freq = (float) juce::MidiMessage::getMidiNoteInHertz (note);
    const juce::SpinLock::ScopedLockType sl (guiNotesLock);
    guiNotes.push_back ({ on, note, freq, velocity });
    if (on) guiHeldNotes.insert (note);
    else    guiHeldNotes.erase (note);
}

void VstaiAudioProcessor::allNotesOffFromGui()
{
    const juce::SpinLock::ScopedLockType sl (guiNotesLock);
    for (const int note : guiHeldNotes)
        guiNotes.push_back ({ false, note, 0.0f, 0.0f });
    guiHeldNotes.clear();
}

int VstaiAudioProcessor::beginSampleUpload (int channels, int frames, double rate)
{
    sampleStaging.reset();
    sampleUpChannels = juce::jlimit (1, vstai::kMaxChannels, channels);
    sampleUpFrames   = juce::jmax (0, frames);
    sampleUpRate     = rate > 0.0 ? rate : currentSampleRate;
    return engine.sampleCapacityFrames();   // GUI clamps to this before sending
}

void VstaiAudioProcessor::appendSampleData (const void* bytes, size_t numBytes)
{
    if (bytes != nullptr && numBytes > 0)
        sampleStaging.append (bytes, numBytes);
}

juce::String VstaiAudioProcessor::endSampleUpload()
{
    const size_t need = (size_t) sampleUpChannels * (size_t) sampleUpFrames * sizeof (float);
    if (sampleUpFrames <= 0 || sampleStaging.getSize() < need)
    {
        sampleStaging.reset();
        return "sample upload incomplete";
    }

    juce::String err;
    const bool ok = engine.loadSample ((const float*) sampleStaging.getData(),
                                       sampleUpChannels, sampleUpFrames,
                                       (float) sampleUpRate, err);
    sampleStaging.reset();
    return ok ? juce::String() : err;
}

void VstaiAudioProcessor::loadDocumentIntoEngine()
{
    if (document.wasm.empty()) return;

    juce::String err;
    if (engine.loadModule (document.wasm, err))
    {
        engine.prepare (currentSampleRate, currentBlockSize, getTotalNumOutputChannels());
        for (const auto& p : document.params)
            engine.setParam (p.index, (float) p.value);
    }
    else
    {
        DBG ("WASM load failed: " << err);
    }

    syncHostParameters();   // remap the host pool to this plugin's params
}

void VstaiAudioProcessor::notifyChanged()
{
    // Nudge the host so it re-reads the program name (the loaded plugin's name).
    updateHostDisplay (juce::AudioProcessorListener::ChangeDetails{}.withProgramChanged (true));

    if (onDocumentChanged)
        juce::MessageManager::callAsync ([cb = onDocumentChanged] { cb(); });
}

void VstaiAudioProcessor::requestBuild (const juce::String& prompt, BuildProgress progress, BuildDone done)
{
    VSTAI_LOG ("build requested: " + prompt.substring (0, 200));

    // Mark the build in flight so a reopened editor can show it's still running.
    building   = true;
    buildStage = "Generating with AI...";
    if (onBuildStateChanged) onBuildStateChanged();

    // Snapshot what the worker needs so it never touches `this` during the
    // (potentially minutes-long) network + compile work.
    const juce::String curAssembly = document.assembly;
    const juce::String curHtml     = document.html;
    const int          maxFix      = maxFixAttempts;
    const bool         isSynth     = kIsSynth;
    const juce::String genModel    = document.model;
    const juce::String genEffort   = document.effort;
    const bool         genThinking = document.thinking;
    const juce::String genStandardUi = vstai::appsettings::standardUi();   // house style for the prompt
    const juce::String genDesignName       = vstai::appsettings::selectedDesignName();
    const juce::String genDesignPrinciples = vstai::appsettings::selectedDesignPrinciples();
    auto               aliveToken  = alive;     // shared_ptr copy keeps the flag alive
    auto               comp        = compiler;  // shared_ptr: reused JIT'd asc module

    // Resolve the provider (explicit choice, else inferred from the model id) and
    // snapshot the matching credentials on the message thread — the worker must
    // not touch settings or `this` while it runs.
    const auto provider = document.provider.isNotEmpty()
                              ? LlmClient::providerFromString (document.provider)
                              : LlmClient::providerForModel (genModel);
    const juce::String genKey =
        provider == LlmClient::Provider::glm      ? vstai::appsettings::glmKey()
      : provider == LlmClient::Provider::ollama   ? juce::String()
      : provider == LlmClient::Provider::cloud    ? juce::String()
                                                  : vstai::appsettings::anthropicKey();
    const juce::String ollamaUrl = vstai::appsettings::ollamaBaseUrl();
    const juce::String glmUrl    = vstai::appsettings::glmBaseUrl();
    const juce::String cloudUrl  = vstai::appsettings::cloudBaseUrl();
    const juce::String genToken  = vstai::appsettings::cloudToken();   // cloud session token
    auto thinkingCb = onThinkingDelta;   // snapshot the UI sink on the message thread

    // Push a stage label to the UI from the worker thread, guarded like the
    // completion callback so it never touches a destroyed processor.
    auto reportProgress = [this, aliveToken, progress] (juce::String stage)
    {
        juce::MessageManager::callAsync ([this, aliveToken, progress, stage]
        {
            if (! aliveToken->load()) return;
            buildStage = stage;
            if (progress) progress (stage);                 // the editor that started the build
            if (onBuildStateChanged) onBuildStateChanged(); // any editor (survives reopen)
        });
    };

    // Forward each GLM reasoning chunk to the editor (same destroyed-processor guard).
    auto streamThinking = [aliveToken, thinkingCb] (const juce::String& delta)
    {
        if (thinkingCb == nullptr) return;
        juce::MessageManager::callAsync ([aliveToken, thinkingCb, delta]
        {
            if (aliveToken->load()) thinkingCb (delta);
        });
    };

    auto finishOnUi = [this, aliveToken, done] (bool ok, juce::String message,
                                                juce::var artifact, std::vector<uint8_t> wasm,
                                                juce::String prompt)
    {
        juce::MessageManager::callAsync (
            [this, aliveToken, done, ok, message, artifact, wasm, prompt]() mutable
            {
                if (! aliveToken->load()) return; // processor was destroyed

                building   = false;               // clear busy state for any attached editor
                buildStage = {};
                if (onBuildStateChanged) onBuildStateChanged();

                if (ok)
                {
                    document.applyBuildResult (artifact, wasm, prompt);
                    document.isInstrument = kIsSynth;
                    loadDocumentIntoEngine();
                    notifyChanged();
                    if (done) done (true, document.lastExplanation);
                }
                else if (done)
                {
                    done (false, message);
                }
            });
    };

    std::thread ([prompt, curAssembly, curHtml, maxFix, isSynth, genModel, genEffort, genThinking, genStandardUi,
                  genDesignName, genDesignPrinciples,
                  provider, genKey, ollamaUrl, glmUrl, cloudUrl, genToken, comp, finishOnUi, reportProgress, streamThinking]
    {
        LlmClient llm;   // stack-local: configured per provider from settings
        llm.setProvider (provider);
        llm.setModel    (genModel);
        llm.setEffort   (genEffort);
        // Full 128K output ceiling for builds AND edits, so a genuinely large
        // change (a whole new effect section, a GUI rework) has room to land.
        //
        // Edits were briefly capped at 32K while runaway replies were burning the
        // entire ceiling -- 128,000 tokens, 16 minutes, ~$3, truncated JSON. That
        // turned out to be the json_schema blocking the `edits` array (see
        // setStructuredOutput below); with the schema off the same edit needs
        // ~7K tokens. The cap treated the symptom, so it is lifted. The plumbing
        // stays: setMaxOutputTokens(n) re-caps if a runaway ever returns, and a
        // truncated reply now reports "hit its output limit" rather than
        // "invalid JSON".
        llm.setMaxOutputTokens (0);   // 0 = the model's own ceiling (128K on Opus)
        // Schema ON for a new build, OFF for an edit (it prevents the model from
        // emitting the `edits` array at all -- see callAnthropic).
        llm.setStructuredOutput (curAssembly.isEmpty());
        llm.setApiKey   (genKey);
        llm.setBaseUrl  (provider == LlmClient::Provider::cloud ? cloudUrl
                       : provider == LlmClient::Provider::glm   ? glmUrl
                                                                : ollamaUrl);
        llm.setToken    (genToken);
        llm.setSynth    (isSynth);
        llm.setThinking (genThinking);
        llm.setThinkingSink (streamThinking);

        if (provider == LlmClient::Provider::cloud && genToken.isEmpty())
        {
            finishOnUi (false, "Sign in to VibePlugin Cloud first — open the Account… dialog.", {}, {}, prompt);
            return;
        }
        if (llm.needsApiKey() && ! llm.hasApiKey())
        {
            finishOnUi (false,
                provider == LlmClient::Provider::glm
                    ? "GLM API key is not set. Open “Keys…”, paste your GLM key, or set GLM_API_KEY."
                    : "Anthropic API key is not set. Open “Keys…”, paste your key, or set "
                      "ANTHROPIC_API_KEY.",
                {}, {}, prompt);
            return;
        }
        if (! comp->isAvailable())
        {
            finishOnUi (false,
                "The bundled compiler (vstai-asc) was not found. Build it once with "
                "compiler/build.sh and set VSTAI_CONFIG_COMPILER in Config.h, $VSTAI_COMPILER, "
                "or ship it next to the plugin. See the README.", {}, {}, prompt);
            return;
        }

        juce::Array<juce::var> messages;
        auto addMsg = [&messages] (const char* role, const juce::String& content)
        {
            auto* m = new juce::DynamicObject();
            m->setProperty ("role", role);
            m->setProperty ("content", content);
            messages.add (juce::var (m));
        };
        // Split the user message: the stable preamble (design language + component
        // kit, ~80% of the prompt) goes to the LLM client as a cached block; only
        // the volatile task (current source + change request) rides in the message.
        // Providers without prompt caching get them joined back together.
        const auto preamble = vstai::buildUserPreamble (isSynth, genStandardUi,
                                                        genDesignName, genDesignPrinciples);
        const auto task     = vstai::buildUserTask (prompt, curAssembly, curHtml);

        if (provider == LlmClient::Provider::anthropic)
        {
            llm.setCachedPreamble (preamble);
            addMsg ("user", task);
        }
        else
        {
            addMsg ("user", preamble + task);
        }

        VSTAI_LOG ("calling " + LlmClient::providerToString (provider) + " (" + genModel + ")...");
        reportProgress ("Generating with AI...");
        juce::var    artifact;
        juce::String error;
        if (! llm.callMessages (messages, artifact, error))
        {
            VSTAI_LOG ("LLM call failed: " + error);
            finishOnUi (false, error, {}, {}, prompt);
            return;
        }

        // A reply may be an `edits` patch instead of full files. Resolve it against
        // the latest known full source into a full `assembly`/`html` artifact; if a
        // `find` snippet doesn't match exactly once, ask once for full files.
        juce::String fullAsm = curAssembly, fullHtml = curHtml;
        auto resolvePatch = [&] () -> bool
        {
            juce::String rerr;
            if (! vstai::resolveEdits (fullAsm, fullHtml, artifact, rerr))
            {
                VSTAI_LOG ("edit patch didn't apply: " + rerr + " — requesting full files");
                reportProgress ("Refining the edit...");
                streamThinking ("\n[build] edit patch did not apply (" + rerr
                                + ") - requesting full files...\n");
                addMsg ("assistant", juce::JSON::toString (artifact, true));
                addMsg ("user", vstai::buildEditFallbackMessage (rerr));
                if (! llm.callMessages (messages, artifact, error)) return false;
                if (! vstai::resolveEdits (fullAsm, fullHtml, artifact, rerr))
                    { error = "the AI's edit could not be applied: " + rerr; return false; }
            }
            // FIRST, before backfilling anything: did the model actually send a
            // change? A reply with no edits, no assembly and no html changed
            // nothing -- and the backfill below would then hand back the untouched
            // current source, which compiles fine and reports success, so the user
            // sees "done" while the DSP is byte-identical and their edit silently
            // vanished. Only "explanation" is required by the output schema, so
            // this happens in practice. (resolveEdits has already written the
            // patched sources in when it applied an edits array, so a real patch
            // still looks like a change here.)
            if (auto* ao = artifact.getDynamicObject())
            {
                auto* eds = ao->getProperty ("edits").getArray();
                const bool gotEdits = (eds != nullptr && ! eds->isEmpty());
                const bool gotFiles = ao->getProperty ("assembly").toString().isNotEmpty()
                                   || ao->getProperty ("html").toString().isNotEmpty();

                if (! gotEdits && ! gotFiles)
                {
                    const auto why = artifact.getProperty ("explanation", {}).toString();
                    error = "the AI replied without any code change"
                            + (why.isEmpty() ? juce::String()
                                             : juce::String (" — it said: \"") + why.trim() + "\"")
                            + ". Try rephrasing, or ask for the complete files.";
                    VSTAI_LOG ("no-op reply: neither edits nor assembly/html present");
                    streamThinking ("\n[build] the model returned no code change - stopping.\n");
                    return false;
                }
            }

            fullAsm  = artifact.getProperty ("assembly", fullAsm).toString();
            fullHtml = artifact.getProperty ("html",     fullHtml).toString();

            if (fullAsm.trim().isEmpty())
            {
                // `error` (not the lambda-local rerr) is what the caller reports.
                error = "the AI returned no AssemblyScript and there was no existing "
                        "source to patch.";
                return false;
            }

            // Backfill the resolved sources so everything downstream (the compile
            // loop, finishOnUi, the saved document) sees complete files even when
            // the reply only carried one of the two.
            if (auto* ao = artifact.getDynamicObject())
            {
                ao->setProperty ("assembly", fullAsm);
                ao->setProperty ("html",     fullHtml);
            }
            return true;
        };
        if (! resolvePatch()) { finishOnUi (false, error, {}, {}, prompt); return; }

        std::vector<uint8_t> wasm;
        juce::String diag;
        for (int attempt = 1; ; ++attempt)
        {
            const juce::String asmSrc = artifact.getProperty ("assembly", {}).toString();
            VSTAI_LOG ("compile attempt " + juce::String (attempt) + " ("
                       + juce::String (asmSrc.length()) + " chars of AssemblyScript)...");
            reportProgress (attempt == 1 ? juce::String ("Compiling...")
                                         : "Compiling (retry " + juce::String (attempt - 1) + ")...");

            // Mirror the compile pipeline into the "See reasoning" panel, so a long
            // build reads as a sequence of steps rather than a frozen status line.
            streamThinking (attempt == 1
                ? "\n\n[build] compiling AssemblyScript (" + juce::String (asmSrc.length()) + " chars)...\n"
                : "\n[build] RECOMPILING - attempt " + juce::String (attempt)
                      + " of " + juce::String (maxFix + 1) + " ("
                      + juce::String (asmSrc.length()) + " chars)...\n");

            if (comp->compile (asmSrc, wasm, diag))
            {
                VSTAI_LOG ("compiled OK -> " + juce::String ((int) wasm.size()) + " bytes of wasm");
                streamThinking ("[build] compiled OK -> " + juce::String ((int) wasm.size())
                                + " bytes of wasm\n");
                reportProgress ("Installing...");
                finishOnUi (true, {}, artifact, wasm, prompt);
                return;
            }

            VSTAI_LOG ("compile failed: " + diag.substring (0, 300));
            {
                // First diagnostic line only -- the full text goes to the error panel.
                auto first = juce::StringArray::fromLines (diag.trim());
                streamThinking ("[build] compile FAILED: "
                                + (first.isEmpty() ? juce::String ("(no diagnostic)") : first[0]) + "\n");
            }
            if (attempt > maxFix)
            {
                finishOnUi (false, "AssemblyScript failed to compile:\n" + diag, {}, {}, prompt);
                return;
            }

            addMsg ("assistant", juce::JSON::toString (artifact, true));
            addMsg ("user", vstai::buildFixMessage (asmSrc, diag));
            reportProgress ("Fixing errors with AI...");
            streamThinking ("[build] asking the model to fix the compile errors...\n");
            if (! llm.callMessages (messages, artifact, error))
            {
                finishOnUi (false, error, {}, {}, prompt);
                return;
            }
            // A fix reply may also be a patch — resolve it against the just-tried source.
            if (! resolvePatch()) { finishOnUi (false, error, {}, {}, prompt); return; }
        }
    }).detach();
}

void VstaiAudioProcessor::requestBuildFromArtifact (const juce::String& prompt, const juce::var& artifactIn,
                                                    BuildProgress progress, BuildDone done)
{
    // A pasted chatbot reply may be an `edits` patch instead of whole files. Apply
    // it to the current source here (message thread). Unlike the API path there is
    // no model to auto-retry, so a snippet that doesn't match is surfaced to the user.
    juce::var artifact = artifactIn;
    juce::String editErr;
    if (! vstai::resolveEdits (document.assembly, document.html, artifact, editErr))
    {
        if (done) done (false, "The pasted patch could not be applied: " + editErr
                               + ".\nMake each \"find\" match the current code exactly and uniquely, "
                                 "or paste the complete files instead.");
        return;
    }

    // Same trap as the API path: a reply carrying neither "edits" nor "assembly"
    // (an explanation-only paste) would otherwise compile an empty module -- which
    // asc accepts -- leaving a silent plugin and a blank source in the editor.
    if (auto* ao = artifact.getDynamicObject())
    {
        if (ao->getProperty ("assembly").toString().isEmpty()) ao->setProperty ("assembly", document.assembly);
        if (ao->getProperty ("html").toString().isEmpty())     ao->setProperty ("html",     document.html);
    }

    const juce::String asmSrc = artifact.getProperty ("assembly", {}).toString();
    if (asmSrc.trim().isEmpty())
    {
        if (done) done (false, "That reply contained no AssemblyScript (and there is no "
                               "existing source to patch). Paste the complete `assembly` "
                               "and `html`, or an `edits` patch.");
        return;
    }
    VSTAI_LOG ("manual build requested (" + juce::String (asmSrc.length()) + " chars of AssemblyScript)");

    auto aliveToken = alive;
    auto comp       = compiler;

    auto reportProgress = [aliveToken, progress] (juce::String stage)
    {
        juce::MessageManager::callAsync ([aliveToken, progress, stage]
        {
            if (aliveToken->load() && progress) progress (stage);
        });
    };

    auto finishOnUi = [this, aliveToken, done] (bool ok, juce::String message,
                                                juce::var art, std::vector<uint8_t> wasm,
                                                juce::String pr)
    {
        juce::MessageManager::callAsync (
            [this, aliveToken, done, ok, message, art, wasm, pr]() mutable
            {
                if (! aliveToken->load()) return;
                if (ok)
                {
                    document.applyBuildResult (art, wasm, pr);
                    document.isInstrument = kIsSynth;
                    loadDocumentIntoEngine();
                    notifyChanged();
                    if (done) done (true, document.lastExplanation);
                }
                else if (done)
                {
                    done (false, message);
                }
            });
    };

    std::thread ([prompt, artifact, asmSrc, comp, finishOnUi, reportProgress]
    {
        if (asmSrc.trim().isEmpty())
        {
            finishOnUi (false, "The pasted reply had no AssemblyScript to compile.", {}, {}, prompt);
            return;
        }
        if (! comp->isAvailable())
        {
            finishOnUi (false,
                "The bundled compiler (vstai-asc) was not found. Build it once with "
                "compiler/build.sh and set VSTAI_CONFIG_COMPILER in Config.h, $VSTAI_COMPILER, "
                "or ship it next to the plugin. See the README.", {}, {}, prompt);
            return;
        }

        reportProgress ("Compiling pasted code...");
        std::vector<uint8_t> wasm;
        juce::String diag;
        if (comp->compile (asmSrc, wasm, diag))
        {
            VSTAI_LOG ("manual build compiled OK -> " + juce::String ((int) wasm.size()) + " bytes");
            reportProgress ("Installing...");
            finishOnUi (true, {}, artifact, wasm, prompt);
        }
        else
        {
            VSTAI_LOG ("manual build failed: " + diag.substring (0, 300));
            finishOnUi (false, diag, {}, {}, prompt);
        }
    }).detach();
}

void VstaiAudioProcessor::applyEditedSource (const juce::String& assembly, const juce::String& html)
{
    document.assembly = assembly;
    document.html     = html;
}

void VstaiAudioProcessor::restoreRevision (int id)
{
    if (document.restoreRevision (id))
    {
        loadDocumentIntoEngine();
        notifyChanged();
    }
}

void VstaiAudioProcessor::requestRecompile (const juce::String& assembly, const juce::String& html,
                                            BuildProgress progress, RecompileDone done)
{
    VSTAI_LOG ("recompile requested (" + juce::String (assembly.length()) + " chars)");

    auto aliveToken = alive;
    auto comp       = compiler;

    auto reportProgress = [aliveToken, progress] (juce::String stage)
    {
        juce::MessageManager::callAsync ([aliveToken, progress, stage]
        {
            if (aliveToken->load() && progress) progress (stage);
        });
    };

    // Manual recompiles report into the same "See reasoning" panel as generated
    // builds, so hand-edited source and AI builds leave a consistent trail.
    auto thinkingCb    = onThinkingDelta;   // snapshot the UI sink on the message thread
    auto streamThinking = [aliveToken, thinkingCb] (const juce::String& delta)
    {
        if (thinkingCb == nullptr) return;
        juce::MessageManager::callAsync ([aliveToken, thinkingCb, delta]
        {
            if (aliveToken->load()) thinkingCb (delta);
        });
    };

    // On success, swap in the edited source on the message thread and reload.
    auto finishOnUi = [this, aliveToken, done] (bool ok, juce::String diag,
                                                juce::String asmSrc, juce::String htmlSrc,
                                                std::vector<uint8_t> wasm)
    {
        juce::MessageManager::callAsync (
            [this, aliveToken, done, ok, diag, asmSrc, htmlSrc, wasm]() mutable
            {
                if (! aliveToken->load()) return;
                if (ok)
                {
                    document.assembly = asmSrc;
                    document.html     = htmlSrc;
                    document.wasm     = wasm;
                    document.isInstrument = kIsSynth;
                    document.pushRevision ("Manual edit & compile");   // snapshot for the prompt browser
                    loadDocumentIntoEngine();   // re-applies persisted param values by index
                    notifyChanged();            // reload the GUI WebView + reseed the editors
                }
                if (done) done (ok, diag);
            });
    };

    std::thread ([assembly, html, comp, finishOnUi, reportProgress, streamThinking]
    {
        if (! comp->isAvailable())
        {
            finishOnUi (false,
                "The bundled compiler (vstai-asc) was not found. Build it once with "
                "compiler/build.sh. See the README.", {}, {}, {});
            return;
        }

        reportProgress ("Compiling...");
        streamThinking ("\n[manual] RECOMPILING edited source ("
                        + juce::String (assembly.length()) + " chars)...\n");

        std::vector<uint8_t> wasm;
        juce::String diag;
        if (comp->compile (assembly, wasm, diag))
        {
            VSTAI_LOG ("manual recompile OK -> " + juce::String ((int) wasm.size()) + " bytes");
            streamThinking ("[manual] compiled OK -> " + juce::String ((int) wasm.size())
                            + " bytes of wasm\n");
            reportProgress ("Installing...");
            finishOnUi (true, {}, assembly, html, wasm);
        }
        else
        {
            VSTAI_LOG ("manual recompile failed: " + diag.substring (0, 300));
            auto first = juce::StringArray::fromLines (diag.trim());
            streamThinking ("[manual] compile FAILED: "
                            + (first.isEmpty() ? juce::String ("(no diagnostic)") : first[0]) + "\n");
            finishOnUi (false, diag, {}, {}, {});
        }
    }).detach();
}

void VstaiAudioProcessor::setParamFromGui (int index, float value)
{
    engine.setParam (index, value);
    for (auto& p : document.params)
        if (p.index == index) p.value = value;

    // Mirror into the host parameter so moving a GUI control shows up in the DAW
    // (and is recordable as automation). Only for params with real metadata, so
    // we never mis-normalise a control whose range we don't know.
    if (index >= 0 && index < (int) hostParams.size() && hostActive[index])
        hostParams[index]->setValueNotifyingHost (actualToNorm (index, value));
}

void VstaiAudioProcessor::setupHostParameters()
{
    hostParams.reserve (vstai::kMaxParams);
    for (int i = 0; i < vstai::kMaxParams; ++i)
    {
        hostMin[i] = 0.0f; hostMax[i] = 1.0f; hostActive[i] = false;
        auto* p = new VstaiHostParameter (i);
        hostParams.push_back (p);
        addParameter (p);   // AudioProcessor takes ownership
    }
}

void VstaiAudioProcessor::syncHostParameters()
{
    // Plain data (ranges + names + active flags). Safe from any thread: the
    // audio-thread poll only reads an entry once its hostActive[i] flips true,
    // which we set last per param.
    for (int i = 0; i < vstai::kMaxParams; ++i)
    {
        hostActive[i] = false;
        hostParams[(size_t) i]->dynamicName = {};
    }
    for (const auto& p : document.params)
    {
        const int i = p.index;
        if (i < 0 || i >= vstai::kMaxParams) continue;
        hostMin[i] = (float) p.minVal;
        hostMax[i] = (float) p.maxVal;
        hostParams[(size_t) i]->dynamicName = p.name;
        hostActive[i] = true;
    }

    // Host-facing calls (show the plugin's values + refresh names) must run on the
    // message thread — loadDocumentIntoEngine can be reached from prepareToPlay.
    auto guard = alive;
    auto notify = [this, guard]
    {
        if (! guard->load()) return;
        for (const auto& p : document.params)
        {
            const int i = p.index;
            if (i < 0 || i >= vstai::kMaxParams || ! hostActive[i]) continue;
            hostParams[(size_t) i]->setValueNotifyingHost (actualToNorm (i, (float) p.value));
        }
        updateHostDisplay (juce::AudioProcessorListener::ChangeDetails{}.withParameterInfoChanged (true));
    };
    if (juce::MessageManager::existsAndIsCurrentThread()) notify();
    else juce::MessageManager::callAsync (notify);
}

void VstaiAudioProcessor::pushHostParamsToEngine()
{
    // Real-time safe: just float reads/writes. Drives the engine from whatever the
    // host (automation) currently holds, for params with known ranges.
    for (int i = 0; i < (int) hostParams.size(); ++i)
        if (hostActive[i])
            engine.setParam (i, normToActual (i, hostParams[(size_t) i]->get()));
}

juce::String VstaiAudioProcessor::getDisplayHtml() const
{
    if (document.html.isNotEmpty()) return document.html;
    // No plugin yet: show the (editable) standard component kit live, so the user
    // can see and play the house style. Falls back to kDefaultHtml only if empty.
    auto std = vstai::appsettings::standardUi();
    juce::String kit = std.isNotEmpty() ? std : juce::String (kDefaultHtml);

    // This kit is just the house style — there's no DSP behind it, so make clear it
    // isn't a working instrument (display only; the generation house-style seed and a
    // real generated/exported plugin never get this banner).
    const char* banner =
        R"HTML(<div style="position:sticky;top:0;z-index:99;font:600 12px/1.45 system-ui,-apple-system,sans-serif;)"
        R"HTML(color:#d3dcec;background:linear-gradient(180deg,#1b2435,#141a27);border-bottom:1px solid rgba(255,255,255,.1);)"
        R"HTML(padding:9px 14px;text-align:center">Style preview — a GUI example, not a real synth (no sound). )HTML"
        R"HTML(Type a prompt and press Generate, or Load a .vstai, to make a working plugin.</div>)HTML";
    const int b = kit.indexOfIgnoreCase ("<body>");
    return b >= 0 ? (kit.substring (0, b + 6) + banner + kit.substring (b + 6))
                  : (juce::String (banner) + kit);
}

void VstaiAudioProcessor::newPlugin()
{
    const auto provider = document.provider;   // keep the generation-settings choice
    const auto model    = document.model;
    const auto effort   = document.effort;
    const auto thinking = document.thinking;
    document = VstaiDocument{};
    document.provider    = provider;
    document.model       = model;
    document.effort      = effort;
    document.thinking    = thinking;
    document.isInstrument = kIsSynth;
    engine.unload();                      // back to passthrough / silence
    notifyChanged();                      // editor reloads the blank starter GUI
}

bool VstaiAudioProcessor::saveDocument (const juce::File& file, juce::String& errorOut)
{
    return document.saveToFile (file, errorOut);
}

bool VstaiAudioProcessor::loadDocument (const juce::File& file, juce::String& errorOut)
{
    VstaiDocument loaded;
    if (! VstaiDocument::loadFromFile (file, loaded, errorOut))
        return false;
    document = std::move (loaded);
    // Older files (or those saved before the prompt browser) have no timeline —
    // seed one entry so there's a baseline to branch from.
    if (document.revisions.empty() && document.hasPlugin())
        document.pushRevision ("Loaded " + file.getFileNameWithoutExtension());
    loadDocumentIntoEngine();
    notifyChanged();
    return true;
}

bool VstaiAudioProcessor::loadDocumentFromJson (const juce::String& json, juce::String& errorOut)
{
    if (json.trim().isEmpty()) { errorOut = "Empty document."; return false; }
    auto loaded = VstaiDocument::fromJsonString (json);
    if (! loaded.hasPlugin()) { errorOut = "Not a valid .vstai plugin (no DSP/GUI)."; return false; }
    document = std::move (loaded);
    if (document.revisions.empty() && document.hasPlugin())
        document.pushRevision ("Loaded from gallery");
    loadDocumentIntoEngine();
    notifyChanged();
    return true;
}

void VstaiAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto json = document.toJsonString();
    destData.replaceAll (json.toRawUTF8(), json.getNumBytesAsUTF8());
}

void VstaiAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    auto json = juce::String::fromUTF8 (static_cast<const char*> (data), sizeInBytes);
    if (json.trim().isEmpty()) return;
    document = VstaiDocument::fromJsonString (json);
    loadDocumentIntoEngine();
    notifyChanged();
}

juce::AudioProcessorEditor* VstaiAudioProcessor::createEditor()
{
    // Exported / whitelabel build: only the product GUI, no authoring chrome, no exit.
    if (isLocked())
        return new LockedEditor (*this);
    if (vstai::appsettings::useWebShell())
        return new WebEditor (*this);
    return new VstaiAudioProcessorEditor (*this);
}

// JUCE plugin entry point
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new VstaiAudioProcessor();
}
