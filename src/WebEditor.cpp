// WebEditor.cpp  — see WebEditor.h for the design overview.
#include "WebEditor.h"
#include "DevLog.h"
#include "BridgeProtocol.h"
#include "AppSettings.h"
#include "WebAssets.h"
#include "Prompt.h"
#include "LlmClient.h"
#include "LicenseClient.h"
#include "AccountPanel.h"
#include "LicensePanel.h"

using juce::var;
using VarArray = juce::Array<juce::var>;
using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

namespace
{
    // ---- the param/note bridge injected into the /preview iframe -------------
    // (same shim the legacy editor uses; keep them byte-identical so generated
    // GUIs behave the same in both editors).
    const char* kCharsetMeta =
        R"HTML(<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">)HTML";

    const char* kBridgeShim = R"JS(<script>
(function(){
  var vals = {};
  function send(path){
    try { fetch(path + '?_=' + Date.now() + '_' + Math.random(), { cache: 'no-store' }); } catch(e){}
  }
  var paramCbs = [];
  var held = {};   // note numbers currently sounding from the on-screen GUI
  // base64url-encode a byte chunk (no '+' '/' '=' so it is safe in a URL path).
  function b64url(u8){
    var s = '';
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Decode an audio file (File/Blob) to f32 PCM and stream it to the host's WASM
  // sample buffer. Returns a Promise resolving { frames, channels, sampleRate }.
  async function loadSample(file, onProgress){
    if (!file) throw new Error('No file given.');
    var bytes = await file.arrayBuffer();
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('No AudioContext to decode audio.');
    var ac = new AC();
    var audio = await ac.decodeAudioData(bytes);
    try { ac.close(); } catch(e){}
    var channels = Math.min(2, audio.numberOfChannels);
    var frames = audio.length;
    var rate = Math.round(audio.sampleRate);
    // begin -> host replies with the module's per-channel capacity; clamp to it.
    var capResp = await fetch('/__vstai/sample/begin/' + channels + '/' + frames + '/' + rate + '?_=' + Date.now(), { cache: 'no-store' });
    var cap = parseInt(await capResp.text(), 10) || 0;
    if (cap <= 0) throw new Error('This plugin has no sample buffer.');
    if (frames > cap) frames = cap;
    // Build one planar f32 byte blob: all of channel 0, then channel 1.
    var bytesPerCh = frames * 4;
    var blob = new Uint8Array(channels * bytesPerCh);
    for (var c = 0; c < channels; c++){
      var ch = audio.getChannelData(c);
      blob.set(new Uint8Array(ch.buffer, ch.byteOffset, frames * 4), c * bytesPerCh);
    }
    // Ship in chunks, awaited so they arrive (and are appended) in order.
    var CHUNK = 32768;
    for (var off = 0; off < blob.length; off += CHUNK){
      var part = blob.subarray(off, Math.min(off + CHUNK, blob.length));
      await fetch('/__vstai/sample/data/' + b64url(part) + '?_=' + Date.now(), { cache: 'no-store' });
      if (onProgress) { try { onProgress(Math.min(1, (off + CHUNK) / blob.length)); } catch(e){} }
    }
    var endTxt = await (await fetch('/__vstai/sample/end?_=' + Date.now(), { cache: 'no-store' })).text();
    if (endTxt.indexOf('ERR:') === 0) throw new Error(endTxt.substring(4));
    return { frames: frames, channels: channels, sampleRate: rate };
  }
  window.vstai = {
    setParam: function(i, v){ vals[i] = +v; send('/__vstai/param/' + (i|0) + '/' + encodeURIComponent(v)); },
    getParam: function(i){ return (i in vals) ? vals[i] : 0; },
    onReady: function(cb){ try { cb(); } catch(e){} },
    // Register cb(index, value) to be called when a param changes from OUTSIDE the
    // GUI (host automation, another controller). Controls use this to follow along.
    onParam: function(cb){ if (typeof cb === 'function') paramCbs.push(cb); },
    noteOn: function(n, v){ n = n|0; held[n] = 1; send('/__vstai/note/' + n + '/' + (v == null ? 1 : v) + '/1'); },
    noteOff: function(n){ n = n|0; delete held[n]; send('/__vstai/note/' + n + '/0/0'); },
    loadSample: function(file, onProgress){ return loadSample(file, onProgress); }
  };
  // Safety net for stuck notes: some WebViews (notably WKWebView) don't reliably
  // deliver pointerup/pointerleave to the element that captured the pointer, so an
  // on-screen key's noteOff can be missed and the note hangs. Whenever a press
  // ends ANYWHERE — or focus is lost — flush note-off for everything still held.
  function allNotesOff(){
    for (var k in held) send('/__vstai/note/' + (k|0) + '/0/0');
    held = {};
  }
  var off = function(){ if (Object.keys(held).length) allNotesOff(); };
  window.addEventListener('pointerup',   off, true);
  window.addEventListener('mouseup',     off, true);
  window.addEventListener('pointercancel', off, true);
  window.addEventListener('blur',        allNotesOff);
  document.addEventListener('visibilitychange', function(){ if (document.hidden) allNotesOff(); });
  // The host pushes param updates via the editor shell, which postMessages them in.
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.type !== 'vstai:params' || !d.values) return;
    for (var k in d.values){ var idx = +k, val = +d.values[k]; vals[idx] = val;
      for (var j = 0; j < paramCbs.length; j++){ try { paramCbs[j](idx, val); } catch(_){} } }
  });
})();
</script>)JS";

    std::vector<std::byte> toBytes (const juce::String& s)
    {
        auto utf8 = s.toRawUTF8();
        auto len  = s.getNumBytesAsUTF8();
        std::vector<std::byte> out (len);
        std::memcpy (out.data(), utf8, len);
        return out;
    }

    std::vector<std::byte> toBytes (const juce::MemoryBlock& m)
    {
        std::vector<std::byte> out (m.getSize());
        std::memcpy (out.data(), m.getData(), m.getSize());
        return out;
    }

    juce::String withBridge (const juce::String& html)
    {
        const juce::String inject = juce::String (kCharsetMeta) + kBridgeShim;
        int head = html.indexOfIgnoreCase ("<head>");
        if (head >= 0)
            return html.substring (0, head + 6) + inject + html.substring (head + 6);
        int body = html.indexOfIgnoreCase ("<body>");
        if (body >= 0)
            return html.substring (0, body + 6) + inject + html.substring (body + 6);
        return inject + html;
    }

    // {ok, message} result object returned to a JS promise.
    var result (bool ok, const juce::String& message)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("ok", ok);
        o->setProperty ("message", message);
        return var (o);
    }

    var modelEntry (const char* provider, const char* id, const char* label, const char* group)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("provider", juce::String::fromUTF8 (provider));
        o->setProperty ("id",       juce::String::fromUTF8 (id));
        o->setProperty ("label",    juce::String::fromUTF8 (label));   // labels contain "·"
        o->setProperty ("group",    juce::String::fromUTF8 (group));
        return var (o);
    }

    // The selectable model catalogue (mirrors the legacy rebuildModelBox), plus any
    // locally-discovered Ollama models appended at the end.
    var modelCatalog (const juce::StringArray& ollama)
    {
        juce::Array<var> a;
        a.add (modelEntry ("anthropic", "claude-opus-4-8",   "Opus 4.8 (best)",      "Anthropic (your key)"));
        a.add (modelEntry ("anthropic", "claude-sonnet-4-6", "Sonnet 4.6 (cheaper)", "Anthropic (your key)"));
        // GLM / Z.ai and local Ollama models are temporarily hidden from the dropdown
        // (Anthropic-only for now). The backend still supports them — re-add to restore.
        // a.add (modelEntry ("glm", "glm-5.2", "GLM-5.2", "GLM / Z.ai (your key)"));
        // a.add (modelEntry ("glm", "glm-4.6", "GLM-4.6", "GLM / Z.ai (your key)"));
        // a.add (modelEntry ("cloud", "glm-5.2",           "Cloud · GLM-5.2 (cheapest)", "VibePlugin Cloud (credits)"));
        a.add (modelEntry ("cloud", "claude-haiku-4-5",  "Cloud · Haiku 4.5",          "VibePlugin Cloud (credits)"));
        a.add (modelEntry ("cloud", "claude-sonnet-4-6", "Cloud · Sonnet 4.6",         "VibePlugin Cloud (credits)"));
        a.add (modelEntry ("cloud", "claude-opus-4-8",   "Cloud · Opus 4.8 (best)",    "VibePlugin Cloud (credits)"));
        // for (const auto& m : ollama)
        // {
        //     auto* o = new juce::DynamicObject();
        //     o->setProperty ("provider", "ollama");
        //     o->setProperty ("id", m);
        //     o->setProperty ("label", m);
        //     o->setProperty ("group", "Ollama (local, no key)");
        //     a.add (var (o));
        // }
        juce::ignoreUnused (ollama);
        return a;
    }

    juce::String argStr (const VarArray& args, int i)
    {
        return i < args.size() ? args[i].toString() : juce::String();
    }
}

WebEditor::WebEditor (VstaiAudioProcessor& p)
    : AudioProcessorEditor (&p), processor (p)
{
    cacheToken = juce::String ((juce::int64) juce::Time::currentTimeMillis());
    juce::Component::SafePointer<WebEditor> safe (this);

    auto options = juce::WebBrowserComponent::Options{}
        .withNativeIntegrationEnabled()
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withResourceProvider ([safe] (const auto& url) -> std::optional<juce::WebBrowserComponent::Resource>
        {
            if (safe == nullptr) return std::nullopt;
            return safe->provideResource (url);
        })
        // ---- read-only / quick state ------------------------------------
        .withNativeFunction ("getState", [safe] (const VarArray&, Completion complete)
        {
            complete (safe != nullptr ? safe->currentState() : var());
        })
        // The SPA calls this once its JUCE bridge (window.__JUCE__.backend) is up;
        // until then C++ must not emit events (they'd hit an undefined backend).
        .withNativeFunction ("ready", [safe] (const VarArray&, Completion complete)
        {
            // Logged because it's the last line of the SPA's init(): seeing it
            // confirms the whole shell.js ran (imports + Monaco + bridge are OK).
            VSTAI_LOG ("WebEditor: SPA bridge ready");
            if (safe != nullptr) safe->pageReady = true;
            complete (safe != nullptr ? safe->currentState() : var());
        })
        .withNativeFunction ("setModel", [safe] (const VarArray& a, Completion complete)
        {
            if (safe != nullptr)
            {
                safe->processor.setGenerationProvider (argStr (a, 0));
                safe->processor.setGenerationModel    (argStr (a, 1));
            }
            complete (safe != nullptr ? safe->currentState() : var());
        })
        .withNativeFunction ("setEffort", [safe] (const VarArray& a, Completion complete)
        {
            if (safe != nullptr) safe->processor.setGenerationEffort (argStr (a, 0));
            complete (var());
        })
        .withNativeFunction ("setThinking", [safe] (const VarArray& a, Completion complete)
        {
            if (safe != nullptr) safe->processor.setGenerationThinking (a.size() > 0 && (bool) a[0]);
            complete (var());
        })
        // ---- generation -------------------------------------------------
        .withNativeFunction ("generate", [safe] (const VarArray& a, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            const auto prompt = argStr (a, 0).trim();
            if (prompt.isEmpty()) { complete (result (false, "Type a prompt first.")); return; }

            safe->processor.requestBuild (prompt,
                [safe] (const juce::String& stage) { if (safe) safe->emitEvent ("stage", stage); },
                [safe, complete] (bool ok, juce::String message) { complete (result (ok, message)); });
        })
        .withNativeFunction ("buildManualPrompt", [safe] (const VarArray& a, Completion complete)
        {
            if (safe == nullptr) { complete (var()); return; }
            const auto& d = safe->processor.getDocument();
            complete (vstai::buildManualPrompt (argStr (a, 0), d.assembly, d.html,
                                                safe->processor.isInstrument(),
                                                vstai::appsettings::selectedDesignName(),
                                                vstai::appsettings::selectedDesignPrinciples()));
        })
        // Short follow-up prompt for iterating in the SAME chat (no re-paste of the
        // system rules or current code — the chat already holds them).
        .withNativeFunction ("buildManualUpdatePrompt", [] (const VarArray& a, Completion complete)
        {
            complete (vstai::buildManualUpdatePrompt (argStr (a, 0)));
        })
        // Publish the compiled plugin to the configured web catalogue. POSTs the
        // .vstai JSON (html + wasm + params) to <publishUrl>/api/publish; the server
        // serves a browser player that runs the WASM DSP live.
        .withNativeFunction ("publish", [safe] (const VarArray&, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            const auto base = vstai::appsettings::publishUrl().trim();
            if (base.isEmpty()) { complete (result (false, "Set a Publish server URL first — open Keys…")); return; }
            const auto& d = safe->processor.getDocument();
            if (! d.hasPlugin()) { complete (result (false, "Generate or compile a plugin first.")); return; }

            const juce::String payload = d.toJsonString();
            const juce::String name    = d.name;
            juce::Component::SafePointer<WebEditor> s2 (safe);
            std::thread ([s2, base, payload, name, complete]() mutable
            {
                juce::String endpoint = base;
                while (endpoint.endsWithChar ('/')) endpoint = endpoint.dropLastCharacters (1);
                endpoint += "/api/publish";

                int status = 0; juce::String resp;
                auto opts = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
                                .withExtraHeaders ("Content-Type: application/json")
                                .withConnectionTimeoutMs (15000)
                                .withStatusCode (&status);
                if (auto in = juce::URL (endpoint).withPOSTData (payload).createInputStream (opts))
                    resp = in->readEntireStreamAsString();

                const bool ok = (status >= 200 && status < 300);
                juce::String link;
                if (auto* o = juce::JSON::parse (resp).getDynamicObject()) link = o->getProperty ("url").toString();

                juce::MessageManager::callAsync ([s2, complete, ok, name, status, link, base]() mutable
                {
                    if (s2 == nullptr) return;
                    complete (result (ok,
                        ok ? ("Published “" + name + "”"
                              + (link.isNotEmpty() ? "  —  " + link : juce::String()))
                           : ("Publish failed (HTTP " + juce::String (status)
                              + "). Is the catalogue server running at " + base + "?")));
                });
            }).detach();
        })
        .withNativeFunction ("manualFixPrompt", [] (const VarArray& a, Completion complete)
        {
            // Fix request to paste back into the chatbot: failed AssemblyScript + the
            // compiler diagnostics, in the same fenced-block reply format.
            complete (vstai::buildManualFixPrompt (argStr (a, 0), argStr (a, 1)));
        })
        .withNativeFunction ("applyManualReply", [safe] (const VarArray& a, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            juce::var artifact; juce::String err;
            if (! vstai::parseManualReply (argStr (a, 0), artifact, err)) { complete (result (false, err)); return; }

            safe->processor.requestBuildFromArtifact (argStr (a, 1), artifact,
                [safe] (const juce::String& stage) { if (safe) safe->emitEvent ("stage", stage); },
                [safe, complete] (bool ok, juce::String message) { complete (result (ok, message)); });
        })
        .withNativeFunction ("applyManualParts", [safe] (const VarArray& a, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            const auto asmSrc  = argStr (a, 0).trim();
            const auto htmlSrc = argStr (a, 1).trim();
            const auto jsonSrc = argStr (a, 2).trim();
            const auto prompt  = argStr (a, 3);
            if (asmSrc.isEmpty()) { complete (result (false, "Paste the AssemblyScript first.")); return; }

            // Optional params/explanation from the pasted JSON block (either the
            // {params,explanation} object or a bare params array).
            juce::var params; juce::String explanation;
            if (jsonSrc.isNotEmpty())
            {
                const auto meta = juce::JSON::parse (jsonSrc);
                if (auto* mo = meta.getDynamicObject())
                {
                    params      = mo->getProperty ("params");
                    explanation = mo->getProperty ("explanation").toString();
                }
                else if (meta.isArray()) { params = meta; }
            }

            auto* o = new juce::DynamicObject();
            o->setProperty ("assembly", asmSrc);
            o->setProperty ("html", htmlSrc);
            o->setProperty ("params", params.isArray() ? params : juce::var (juce::Array<juce::var>()));
            o->setProperty ("explanation", explanation.isNotEmpty() ? explanation
                                                                    : juce::String ("Built from pasted parts."));
            safe->processor.requestBuildFromArtifact (prompt, juce::var (o),
                [safe] (const juce::String& stage) { if (safe) safe->emitEvent ("stage", stage); },
                [safe, complete] (bool ok, juce::String message) { complete (result (ok, message)); });
        })
        .withNativeFunction ("newDoc", [safe] (const VarArray&, Completion complete)
        {
            if (safe != nullptr) safe->processor.newPlugin();
            complete (safe != nullptr ? safe->currentState() : var());
        })
        // ---- code tabs --------------------------------------------------
        .withNativeFunction ("compile", [safe] (const VarArray& a, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            const auto asmSrc = argStr (a, 0), htmlSrc = argStr (a, 1);
            if (asmSrc.trim().isEmpty()) { complete (result (false, "The DSP (AssemblyScript) tab is empty.")); return; }

            safe->processor.requestRecompile (asmSrc, htmlSrc,
                [safe] (const juce::String& stage) { if (safe) safe->emitEvent ("stage", stage); },
                [safe, complete] (bool ok, juce::String diagnostics)
                {
                    complete (result (ok, ok ? juce::String ("Compiled successfully.") : diagnostics));
                });
        })
        .withNativeFunction ("fixWithAI", [safe] (const VarArray& a, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            const auto asmSrc = argStr (a, 0), htmlSrc = argStr (a, 1);
            if (asmSrc.trim().isEmpty()) { complete (result (false, "Write or generate some DSP first.")); return; }

            safe->processor.applyEditedSource (asmSrc, htmlSrc);
            const bool hasDiag = a.size() > 2 && argStr (a, 2).isNotEmpty();
            juce::String prompt = hasDiag
                ? ("The current DSP does not compile. Fix the AssemblyScript so it compiles cleanly; keep the "
                   "behaviour, the HTML GUI and the parameter indices stable unless the fix requires changing "
                   "them.\n\n=== COMPILER OUTPUT ===\n" + argStr (a, 2))
                : juce::String ("Review the current DSP and GUI for bugs and fix any issues you find, keeping "
                                "the plugin's behaviour and parameter layout stable.");

            safe->processor.requestBuild (prompt,
                [safe] (const juce::String& stage) { if (safe) safe->emitEvent ("stage", stage); },
                [safe, complete] (bool ok, juce::String message) { complete (result (ok, message)); });
        })
        // ---- native file dialogs ---------------------------------------
        .withNativeFunction ("save", [safe] (const VarArray&, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            safe->chooser = std::make_unique<juce::FileChooser> (
                "Save plugin as .vstai",
                juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                    .getChildFile (safe->processor.getDocument().name + ".vstai"),
                "*.vstai");
            safe->chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles,
                [safe, complete] (const juce::FileChooser& fc)
                {
                    auto file = fc.getResult();
                    if (file == juce::File() || safe == nullptr) { complete (result (false, "Cancelled.")); return; }
                    if (file.getFileExtension().isEmpty()) file = file.withFileExtension ("vstai");
                    juce::String err;
                    const bool ok = safe->processor.saveDocument (file, err);
                    complete (result (ok, ok ? ("Saved " + file.getFileName()) : ("Save failed: " + err)));
                });
        })
        .withNativeFunction ("load", [safe] (const VarArray&, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            safe->chooser = std::make_unique<juce::FileChooser> (
                "Open a .vstai plugin",
                juce::File::getSpecialLocation (juce::File::userDocumentsDirectory), "*.vstai");
            safe->chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                [safe, complete] (const juce::FileChooser& fc)
                {
                    auto file = fc.getResult();
                    if (file == juce::File() || safe == nullptr) { complete (result (false, "Cancelled.")); return; }
                    juce::String err;
                    const bool ok = safe->processor.loadDocument (file, err);
                    complete (result (ok, ok ? ("Loaded " + file.getFileName()) : ("Load failed: " + err)));
                });
        })
        // ---- standard UI editor ----------------------------------------
        .withNativeFunction ("getStandardUi", [] (const VarArray&, Completion complete)
        {
            complete (vstai::appsettings::standardUi());
        })
        .withNativeFunction ("saveStandardUi", [safe] (const VarArray& a, Completion complete)
        {
            vstai::appsettings::setStandardUi (argStr (a, 0));
            // If no plugin is generated yet, the preview shows the standard kit —
            // refresh it so the edit is visible immediately.
            if (safe != nullptr && ! safe->processor.getDocument().hasPlugin())
                safe->emitEvent ("documentChanged", safe->currentState());
            complete (result (true, "Standard UI saved — it's now the house style for new generations."));
        })
        .withNativeFunction ("resetStandardUi", [] (const VarArray&, Completion complete)
        {
            vstai::appsettings::resetStandardUi();
            complete (vstai::appsettings::standardUi());
        })
        // ---- settings + design schools ---------------------------------
        .withNativeFunction ("getSettings", [] (const VarArray&, Completion complete)
        {
            auto* o = new juce::DynamicObject();
            o->setProperty ("anthropicKey", vstai::appsettings::rawAnthropicKey());
            o->setProperty ("publishUrl",   vstai::appsettings::publishUrl());
            o->setProperty ("designId",     vstai::appsettings::selectedDesignId());
            o->setProperty ("designTheme",
                            vstai::appsettings::designMeta (vstai::appsettings::selectedDesignId()).theme);
            complete (var (o));
        })
        .withNativeFunction ("saveSettings", [] (const VarArray& a, Completion complete)
        {
            auto parsed = juce::JSON::parse (argStr (a, 0));
            if (auto* o = parsed.getDynamicObject())
            {
                vstai::appsettings::setAnthropicKey (o->getProperty ("anthropicKey").toString().trim());
                vstai::appsettings::setPublishUrl   (o->getProperty ("publishUrl").toString().trim());
            }
            complete (result (true, "Settings saved."));
        })
        .withNativeFunction ("getDesigns", [] (const VarArray&, Completion complete)
        {
            const auto sel = vstai::appsettings::selectedDesignId();
            juce::Array<var> rows;
            auto add = [&rows, &sel] (const vstai::designs::DesignMeta& m)
            {
                auto* o = new juce::DynamicObject();
                o->setProperty ("id",       m.id);
                o->setProperty ("name",     m.name);
                o->setProperty ("blurb",    m.blurb);
                o->setProperty ("builtin",  m.builtin);
                o->setProperty ("selected", m.id == sel);
                o->setProperty ("theme",    m.theme);
                rows.add (var (o));
            };
            for (auto& id : vstai::designs::builtinIds())
                add (vstai::appsettings::designMeta (id));
            for (auto& v : vstai::appsettings::customDesignArray())
                if (auto* o = v.getDynamicObject())
                    add (vstai::appsettings::designMeta (o->getProperty ("id").toString()));
            complete (rows);
        })
        .withNativeFunction ("setDesign", [safe] (const VarArray& a, Completion complete)
        {
            const auto id = argStr (a, 0);
            if (id.isNotEmpty()) vstai::appsettings::setSelectedDesignId (id);
            // No plugin yet? The preview shows the standard kit — reseed it so the
            // newly-selected design is visible immediately.
            if (safe != nullptr && ! safe->processor.getDocument().hasPlugin())
                safe->emitEvent ("documentChanged", safe->currentState());
            complete (result (true, "Design: " + vstai::appsettings::selectedDesignName()));
        })
        .withNativeFunction ("removeDesign", [safe] (const VarArray& a, Completion complete)
        {
            const auto id = argStr (a, 0);
            if (id.isNotEmpty()) vstai::appsettings::removeCustomDesign (id);
            if (safe != nullptr && ! safe->processor.getDocument().hasPlugin())
                safe->emitEvent ("documentChanged", safe->currentState());
            complete (result (true, "Removed."));
        })
        .withNativeFunction ("exportDesign", [safe] (const VarArray& a, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            const auto id   = argStr (a, 0).isNotEmpty() ? argStr (a, 0)
                                                         : vstai::appsettings::selectedDesignId();
            const auto html = vstai::appsettings::designKitHtml (id);
            safe->chooser = std::make_unique<juce::FileChooser> (
                "Export design",
                juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                    .getChildFile (id + ".vibedesign.html"),
                "*.html");
            safe->chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles,
                [html, complete] (const juce::FileChooser& fc)
                {
                    auto file = fc.getResult();
                    if (file == juce::File()) { complete (result (false, "Cancelled.")); return; }
                    if (file.getFileExtension().isEmpty()) file = file.withFileExtension ("html");
                    const bool ok = file.replaceWithText (html);
                    complete (result (ok, ok ? ("Exported " + file.getFileName()) : juce::String ("Export failed.")));
                });
        })
        .withNativeFunction ("importDesign", [safe] (const VarArray&, Completion complete)
        {
            if (safe == nullptr) { complete (result (false, "Editor closed.")); return; }
            safe->chooser = std::make_unique<juce::FileChooser> (
                "Import a design (.html)",
                juce::File::getSpecialLocation (juce::File::userDocumentsDirectory), "*.html");
            safe->chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                [safe, complete] (const juce::FileChooser& fc)
                {
                    auto file = fc.getResult();
                    if (file == juce::File() || safe == nullptr) { complete (result (false, "Cancelled.")); return; }
                    const auto html = file.loadFileAsString();
                    if (html.isEmpty()) { complete (result (false, "Empty or unreadable file.")); return; }
                    auto meta = vstai::designs::parseMeta (html, file.getFileNameWithoutExtension());
                    // Never clobber a built-in id; give imports their own namespace.
                    if (meta.id.isEmpty() || vstai::designs::isBuiltin (meta.id))
                        meta.id = "custom-" + juce::Uuid().toString().substring (0, 8);
                    meta.builtin = false;
                    vstai::appsettings::upsertCustomDesign (meta, html);
                    vstai::appsettings::setSelectedDesignId (meta.id);
                    if (! safe->processor.getDocument().hasPlugin())
                        safe->emitEvent ("documentChanged", safe->currentState());
                    complete (result (true, "Imported \"" + meta.name + "\"."));
                });
        })
        // ---- prompt history --------------------------------------------
        .withNativeFunction ("getHistory", [safe] (const VarArray&, Completion complete)
        {
            juce::Array<var> rows;
            if (safe != nullptr)
            {
                const auto& d = safe->processor.getDocument();
                // newest first
                for (auto it = d.revisions.rbegin(); it != d.revisions.rend(); ++it)
                {
                    auto* o = new juce::DynamicObject();
                    o->setProperty ("id", it->id);
                    o->setProperty ("prompt", it->prompt.isNotEmpty() ? it->prompt : juce::String ("(no label)"));
                    o->setProperty ("model", it->model);
                    o->setProperty ("active", it->id == d.activeRevision);
                    o->setProperty ("timestamp", (juce::int64) it->timestamp);
                    rows.add (var (o));
                }
            }
            complete (rows);
        })
        .withNativeFunction ("restoreRevision", [safe] (const VarArray& a, Completion complete)
        {
            if (safe != nullptr && a.size() > 0) safe->processor.restoreRevision ((int) a[0]);
            complete (safe != nullptr ? safe->currentState() : var());
        })
        // ---- native dialogs (reused) -----------------------------------
        .withNativeFunction ("openAccount", [safe] (const VarArray&, Completion complete)
        {
            if (safe != nullptr)
            {
                auto panel = std::make_unique<AccountPanel>();
                panel->onChanged = [safe] { if (safe) safe->updateLicenseState(); };
                juce::DialogWindow::LaunchOptions o;
                o.content.setOwned (panel.release());
                o.dialogTitle = "VibePlugin Cloud credits";
                o.dialogBackgroundColour = juce::Colour (0xff141a24);
                o.escapeKeyTriggersCloseButton = true;
                o.useNativeTitleBar = true;
                safe->trackDialog (o.launchAsync());
            }
            complete (var());
        })
        .withNativeFunction ("openLicense", [safe] (const VarArray&, Completion complete)
        {
            if (safe != nullptr)
            {
                auto panel = std::make_unique<LicensePanel>();
                panel->onChanged = [safe] { if (safe) safe->updateLicenseState(); };
                juce::DialogWindow::LaunchOptions o;
                o.content.setOwned (panel.release());
                o.dialogTitle = "VibePlugin license";
                o.dialogBackgroundColour = juce::Colour (0xff141a24);
                o.escapeKeyTriggersCloseButton = true;
                o.useNativeTitleBar = true;
                safe->trackDialog (o.launchAsync());
            }
            complete (var());
        })
        .withNativeFunction ("openKeys", [safe] (const VarArray&, Completion complete)
        {
            if (safe == nullptr) { complete (var()); return; }
            auto* aw = new juce::AlertWindow ("API keys",
                "Leave a field blank to fall back to the compiled-in / environment value.",
                juce::MessageBoxIconType::NoIcon);
            aw->addTextEditor ("anthropic", vstai::appsettings::rawAnthropicKey(), "Anthropic API key", true);
            // GLM / Z.ai and Ollama fields are temporarily hidden (Anthropic-only for now).
            // The backend still supports them — re-add these editors and their setters to restore.
            // aw->addTextEditor ("glm",       vstai::appsettings::rawGlmKey(),       "GLM (Z.ai) API key", true);
            // aw->addTextEditor ("glmurl",    vstai::appsettings::rawGlmUrl(),       "GLM URL (blank = Z.ai)");
            // aw->addTextEditor ("ollama",    vstai::appsettings::ollamaBaseUrl(),   "Ollama URL");
            aw->addTextEditor ("publish",   vstai::appsettings::publishUrl(),      "Publish server URL (e.g. http://localhost:8787)");
            aw->addButton ("Save",   1, juce::KeyPress (juce::KeyPress::returnKey));
            aw->addButton ("Cancel", 0, juce::KeyPress (juce::KeyPress::escapeKey));
            aw->enterModalState (true, juce::ModalCallbackFunction::create ([safe, aw, complete] (int r)
            {
                // If the editor is gone the WebView bridge behind `complete` is dead too —
                // invoking it (or reading `aw`, which we're being torn down with) would crash.
                if (safe == nullptr) return;
                if (r == 1)
                {
                    vstai::appsettings::setAnthropicKey (aw->getTextEditorContents ("anthropic").trim());
                    // GLM / Ollama fields hidden — leave their stored values untouched.
                    // vstai::appsettings::setGlmKey       (aw->getTextEditorContents ("glm").trim());
                    // vstai::appsettings::setGlmUrl       (aw->getTextEditorContents ("glmurl").trim());
                    // vstai::appsettings::setOllamaUrl    (aw->getTextEditorContents ("ollama").trim());
                    vstai::appsettings::setPublishUrl   (aw->getTextEditorContents ("publish").trim());
                }
                complete (result (r == 1, r == 1 ? "Settings saved." : "Cancelled."));
            }), true);
            safe->trackDialog (aw);
        });

    web = std::make_unique<juce::WebBrowserComponent> (options);
    addAndMakeVisible (*web);

    resetParamReflection();

    // Stream document / build / reasoning changes into the SPA.
    processor.onDocumentChanged = [safe]
    {
        if (safe == nullptr) return;
        safe->resetParamReflection();   // new plugin: re-send all param positions
        safe->emitEvent ("documentChanged", safe->currentState());
    };
    processor.onBuildStateChanged = [safe]
    {
        if (safe == nullptr) return;
        auto* o = new juce::DynamicObject();
        o->setProperty ("building", safe->processor.isBuilding());
        o->setProperty ("stage", safe->processor.getBuildStage());
        safe->emitEvent ("buildState", var (o));
    };
    processor.onThinkingDelta = [safe] (const juce::String& delta)
    {
        if (safe == nullptr) return;
        auto& buf = safe->thinkingBuffer;
        buf += delta;
        constexpr int kMax = 16000;
        if (buf.length() > kMax) buf = buf.substring (buf.length() - kMax);
        safe->thinkingDirty = true;
    };

    startTimerHz (30);   // reasoning repaint throttle + param reflection
    setResizable (true, true);
    setSize (980, 720);
    web->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    refreshOllamaModelsAsync();

    // Shareware: once the editor is on screen, either re-validate a license in the
    // background (fail-open) or pop the friendly nag once per DAW process.
    static std::atomic<bool> nagShownThisSession { false };
    juce::MessageManager::callAsync ([safe]
    {
        if (safe == nullptr) return;
        if (vstai::appsettings::isLicensed())          safe->revalidateLicenseAsync();
        else if (! nagShownThisSession.exchange (true)) safe->showNag();
    });
}

WebEditor::~WebEditor()
{
    stopTimer();
    processor.onDocumentChanged   = nullptr;
    processor.onThinkingDelta     = nullptr;
    processor.onBuildStateChanged = nullptr;

    // Close any still-open native dialog before `web` and this editor are gone.
    // Deleting a modal AlertWindow fires its callback asynchronously with a 0
    // ("cancelled") result; those callbacks guard on this editor's SafePointer
    // (null by then) so they never touch the destroyed WebBrowser bridge.
    for (auto& d : openDialogs)
        if (auto* c = d.getComponent())
            delete c;
    openDialogs.clear();
}

void WebEditor::trackDialog (juce::Component* c)
{
    if (c != nullptr)
        openDialogs.add (c);
}

void WebEditor::resized()
{
    if (web != nullptr) web->setBounds (getLocalBounds());
}

void WebEditor::timerCallback()
{
    reflectParamsToGui();

    if (! thinkingDirty) return;
    thinkingDirty = false;

    // Send only the tail so the SPA stays light.
    auto lines = juce::StringArray::fromLines (thinkingBuffer);
    while (lines.size() > 60) lines.remove (0);
    emitEvent ("thinking", lines.joinIntoString ("\n"));
}

void WebEditor::resetParamReflection()
{
    // Sentinel so the next poll re-sends every current value (GUI matches state).
    for (auto& v : lastSentParam) v = -1.0e30f;
}

void WebEditor::reflectParamsToGui()
{
    if (web == nullptr || ! pageReady) return;

    juce::var values (new juce::DynamicObject());
    auto* vo = values.getDynamicObject();
    bool any = false;

    for (const auto& p : processor.getDocument().params)
    {
        const int i = p.index;
        if (i < 0 || i >= vstai::kMaxParams) continue;
        const float v = processor.getParamValue (i);
        // Relative epsilon so tiny float noise doesn't spam the GUI.
        if (std::abs (v - lastSentParam[i]) > 1.0e-5f * (1.0f + std::abs (v)))
        {
            lastSentParam[i] = v;
            vo->setProperty (juce::String (i), v);
            any = true;
        }
    }

    if (any)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("values", values);
        emitEvent ("paramUpdate", juce::var (o));
    }
}

void WebEditor::emitEvent (const juce::Identifier& id, const var& payload)
{
    if (web != nullptr && pageReady) web->emitEventIfBrowserIsVisible (id, payload);
}

void WebEditor::updateLicenseState()
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("licensed", vstai::appsettings::isLicensed());
    o->setProperty ("signedIn", vstai::appsettings::isSignedIn());
    o->setProperty ("email",    vstai::appsettings::isLicensed() ? vstai::appsettings::licenseEmail()
                                                                 : vstai::appsettings::cloudEmail());
    emitEvent ("licenseChanged", var (o));
}

void WebEditor::refreshOllamaModelsAsync()
{
    const juce::String baseUrl = vstai::appsettings::ollamaBaseUrl();
    juce::Component::SafePointer<WebEditor> safe (this);
    std::thread ([safe, baseUrl]
    {
        juce::String err;
        auto models = LlmClient::listOllamaModels (baseUrl, err);
        juce::MessageManager::callAsync ([safe, models]
        {
            if (safe == nullptr || safe->ollamaModels == models) return;
            safe->ollamaModels = models;
            safe->emitEvent ("modelsChanged", safe->currentState());   // SPA rebuilds the select
        });
    }).detach();
}

void WebEditor::revalidateLicenseAsync()
{
    const auto base    = vstai::appsettings::licenseServerUrl();
    const auto key     = vstai::appsettings::licenseKey();
    const auto machine = vstai::appsettings::machineId();
    if (key.isEmpty()) return;

    juce::Component::SafePointer<WebEditor> safe (this);
    std::thread ([safe, base, key, machine]
    {
        auto resp = vstai::license::validate (base, key, machine);
        const bool reachable = resp.transportOk && resp.status >= 200 && resp.status < 300 && resp.json.isObject();
        const bool invalid   = reachable && ! (bool) resp.json.getProperty ("valid", true);
        if (! invalid) return;

        juce::MessageManager::callAsync ([safe]
        {
            vstai::appsettings::clearLicense();
            if (safe != nullptr) safe->updateLicenseState();
        });
    }).detach();
}

void WebEditor::showNag()
{
    if (vstai::appsettings::isLicensed()) return;

    auto* aw = new juce::AlertWindow (
        "A friendly warning (this is a joke, mostly)",
        juce::String::fromUTF8 (
        "Some people pay good money \xE2\x80\x94 actual dollars \xE2\x80\x94 for a plugin that writes "
        "plugins.\n\nYou? You're running it for free. We're not mad. Honestly, a little impressed.\n\n"
        "A one-time lifetime license makes this warning vanish forever \xE2\x80\x94 and buying any pack of "
        "cloud credits includes that license for free. Open the Account\xE2\x80\xA6 dialog to buy credits."
        "\n\nNo pressure \xE2\x80\x94 every feature works either way."),
        juce::MessageBoxIconType::NoIcon);

    aw->addButton ("Buy lifetime license", 1);
    aw->addButton ("I already have one",   2);
    aw->addButton ("Maybe later",          0, juce::KeyPress (juce::KeyPress::escapeKey));

    juce::Component::SafePointer<WebEditor> safe (this);
    aw->enterModalState (true, juce::ModalCallbackFunction::create ([safe] (int r)
    {
        if (r == 1)
        {
            juce::String url = vstai::appsettings::licenseCheckoutUrl();
            if (url.isEmpty()) url = vstai::appsettings::licenseServerUrl();
            juce::URL (url).launchInDefaultBrowser();
        }
        else if (r == 2 && safe != nullptr)
        {
            // "I already have one" — open the native License dialog directly.
            auto panel = std::make_unique<LicensePanel>();
            panel->onChanged = [safe] { if (safe) safe->updateLicenseState(); };
            juce::DialogWindow::LaunchOptions o;
            o.content.setOwned (panel.release());
            o.dialogTitle = "VibePlugin license";
            o.dialogBackgroundColour = juce::Colour (0xff141a24);
            o.escapeKeyTriggersCloseButton = true;
            o.useNativeTitleBar = true;
            safe->trackDialog (o.launchAsync());
        }
    }), true);
    trackDialog (aw);
}

juce::var WebEditor::currentState() const
{
    const auto& d = processor.getDocument();
    auto* o = new juce::DynamicObject();
    o->setProperty ("provider",  processor.getGenerationProvider());
    o->setProperty ("model",     processor.getGenerationModel());
    o->setProperty ("effort",    processor.getGenerationEffort());
    o->setProperty ("thinking",  processor.getGenerationThinking());
    o->setProperty ("models",    modelCatalog (ollamaModels));
    o->setProperty ("isInstrument", processor.isInstrument());
    o->setProperty ("hasPlugin", d.hasPlugin());
    o->setProperty ("name",      d.name);
    o->setProperty ("assembly",  d.assembly);
    o->setProperty ("html",      d.html.isNotEmpty() ? d.html : processor.getDisplayHtml());
    o->setProperty ("licensed",  vstai::appsettings::isLicensed());
    o->setProperty ("signedIn",  vstai::appsettings::isSignedIn());
    o->setProperty ("email",     vstai::appsettings::isLicensed() ? vstai::appsettings::licenseEmail()
                                                                  : vstai::appsettings::cloudEmail());
    o->setProperty ("building",  processor.isBuilding());
    o->setProperty ("stage",     processor.getBuildStage());
    o->setProperty ("designId",  vstai::appsettings::selectedDesignId());
    // The selected design's chrome palette, so the shell re-skins to match the
    // generated GUI on every state refresh (incl. live design switches).
    o->setProperty ("designTheme",
                    vstai::appsettings::designMeta (vstai::appsettings::selectedDesignId()).theme);
    return var (o);
}

std::optional<juce::WebBrowserComponent::Resource>
WebEditor::provideResource (const juce::String& rawUrl)
{
    const juce::String url = rawUrl.startsWith ("/") ? rawUrl : ("/" + rawUrl);

    // ---- param / note bridge from the /preview iframe ----------------------
    if (url.startsWith ("/__vstai/param/"))
    {
        const auto m = vstai::bridge::parseParam (url);
        if (m.valid) processor.setParamFromGui (m.index, m.value);
        return juce::WebBrowserComponent::Resource { toBytes (juce::String ("ok")), "text/plain;charset=UTF-8" };
    }
    if (url.startsWith ("/__vstai/note/"))
    {
        const auto m = vstai::bridge::parseNote (url);
        if (m.valid) processor.noteFromGui (m.note, m.vel, m.on);
        return juce::WebBrowserComponent::Resource { toBytes (juce::String ("ok")), "text/plain;charset=UTF-8" };
    }
    if (url.startsWith ("/__vstai/sample/"))
    {
        const auto m = vstai::bridge::parseSample (url);
        juce::String body = "ok";
        if (m.kind == vstai::bridge::SampleMsg::Kind::begin && m.valid)
            body = juce::String (processor.beginSampleUpload (m.channels, m.frames, m.sampleRate));
        else if (m.kind == vstai::bridge::SampleMsg::Kind::data && m.valid)
            processor.appendSampleData (m.bytes.getData(), m.bytes.getSize());
        else if (m.kind == vstai::bridge::SampleMsg::Kind::end)
        {
            const auto err = processor.endSampleUpload();
            body = err.isEmpty() ? juce::String ("ok") : ("ERR:" + err);
        }
        return juce::WebBrowserComponent::Resource { toBytes (body), "text/plain;charset=UTF-8" };
    }

    // ---- the sandboxed generated GUI ---------------------------------------
    if (url == "/preview" || url.endsWithIgnoreCase ("/preview"))
        return juce::WebBrowserComponent::Resource {
            toBytes (withBridge (processor.getDisplayHtml())), "text/html;charset=UTF-8" };

    // ---- the SPA shell -----------------------------------------------------
    if (url == "/" || url.endsWithIgnoreCase ("/index.html"))
    {
        auto html = vstai::webassets::readText ("shell.html");
        if (html.isEmpty()) html = "<!doctype html><meta charset=utf-8><body style='font:14px sans-serif;color:#fff;background:#0c0f16;padding:24px'>"
                                   "shell.html not found in Resources/ui. Rebuild to ship the UI assets.</body>";
        // Cache-bust the shell's own resources so a host WebView can never serve a
        // stale shell.js/css from a previous (possibly broken) load.
        const juce::String v = "?v=" + cacheToken;
        html = html.replace ("\"shell.css\"",                       "\"shell.css" + v + "\"")
                   .replace ("\"shell.js\"",                        "\"shell.js" + v + "\"")
                   .replace ("\"vendor/monaco/vs/loader.js\"",      "\"vendor/monaco/vs/loader.js" + v + "\"");
        return juce::WebBrowserComponent::Resource { toBytes (html), "text/html;charset=UTF-8" };
    }

    // ---- any other ui/ asset (css, js, Monaco, fonts) ----------------------
    // Strip any ?v=… cache-buster (and other query) before hitting the disk.
    const auto rel = url.substring (1).upToFirstOccurrenceOf ("?", false, false);
    auto file = vstai::webassets::resolve (rel);
    if (file.existsAsFile())
    {
        juce::MemoryBlock mb;
        if (file.loadFileAsData (mb))
            return juce::WebBrowserComponent::Resource { toBytes (mb), vstai::webassets::mimeFor (rel) };
    }

    return std::nullopt;
}
