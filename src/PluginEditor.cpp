// PluginEditor.cpp
#include "PluginEditor.h"
#include "DevLog.h"
#include "BridgeProtocol.h"
#include "LlmClient.h"
#include "AppSettings.h"
#include "AccountPanel.h"
#include "LicensePanel.h"
#include "ManualPanel.h"
#include <thread>

namespace
{
    // Injected before the generated page's own script. Defines window.vstai,
    // which forwards control events to C++ via fetch() that the resource provider
    // intercepts. The values are encoded in the URL *path* (not the query string):
    // some WebView backends hand the resource provider only the path and drop the
    // query, which would silently break every knob and key. cache:'no-store' plus
    // a nonce stop the WebView from caching repeated events (e.g. note-off).
    // A UTF-8 <meta> goes in first so the WebView never guesses the encoding
    // (the Content-Type below also pins it); otherwise multibyte text from Claude
    // renders as mojibake. The viewport <meta> is essential: without it WKWebView
    // lays the page out at a 980px default width and scales it down, which scrolls
    // the top of the GUI out of view inside the small plug-in window.
    const char* kCharsetMeta =
        R"HTML(<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">)HTML";

    const char* kBridgeShim = R"JS(<script>
(function(){
  var vals = {};
  function send(path){
    try { fetch(path + '?_=' + Date.now() + '_' + Math.random(), { cache: 'no-store' }); } catch(e){}
  }
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
    noteOn: function(n, v){ send('/__vstai/note/' + (n|0) + '/' + (v == null ? 1 : v) + '/1'); },
    noteOff: function(n){ send('/__vstai/note/' + (n|0) + '/0/0'); },
    loadSample: function(file, onProgress){ return loadSample(file, onProgress); }
  };
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

    // Inject the charset meta + bridge shim as early as possible in the document.
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

    // ---- shared theme tokens (mirror StandardUi.h's :root variables) --------
    namespace theme
    {
        const juce::Colour bg      { 0xff0c0f16 };
        const juce::Colour panel   { 0xff141a24 };
        const juce::Colour panel2  { 0xff0f141d };
        const juce::Colour bezel   { 0xff243049 };
        const juce::Colour ink     { 0xffe7ecf4 };
        const juce::Colour muted   { 0xff8aa0c8 };
        const juce::Colour accent  { 0xff5b8cff };
        const juce::Colour accent2 { 0xff8a6cff };
    }

    // Height of the top control strip (also where paint() draws the divider).
    constexpr int kTopBarHeight = 188;

    // A compact dark/accent LookAndFeel so the native chrome matches the
    // generated GUI: rounded buttons with hover/press states, themed combo
    // boxes, popups and text fields. Applied to the whole editor tree.
    class VstaiLookAndFeel : public juce::LookAndFeel_V4
    {
    public:
        VstaiLookAndFeel()
        {
            setColour (juce::ResizableWindow::backgroundColourId, theme::bg);
            setColour (juce::TextButton::buttonColourId,    theme::panel);
            setColour (juce::TextButton::textColourOffId,   theme::ink);
            setColour (juce::TextButton::textColourOnId,    juce::Colours::white);
            setColour (juce::ComboBox::backgroundColourId,  theme::panel);
            setColour (juce::ComboBox::textColourId,        theme::ink);
            setColour (juce::ComboBox::outlineColourId,     theme::bezel);
            setColour (juce::ComboBox::arrowColourId,       theme::muted);
            setColour (juce::PopupMenu::backgroundColourId,            theme::panel2);
            setColour (juce::PopupMenu::textColourId,                  theme::ink);
            setColour (juce::PopupMenu::headerTextColourId,            theme::muted);
            setColour (juce::PopupMenu::highlightedBackgroundColourId, theme::accent);
            setColour (juce::PopupMenu::highlightedTextColourId,       juce::Colours::white);
            setColour (juce::Label::textColourId,           theme::ink);
            setColour (juce::TextEditor::backgroundColourId,        theme::panel);
            setColour (juce::TextEditor::outlineColourId,           theme::bezel);
            setColour (juce::TextEditor::focusedOutlineColourId,    theme::accent);
            setColour (juce::TextEditor::textColourId,              theme::ink);
            setColour (juce::TextEditor::highlightColourId,         theme::accent.withAlpha (0.30f));
            setColour (juce::ToggleButton::textColourId,    theme::ink);
            setColour (juce::ToggleButton::tickColourId,    theme::accent);
            setColour (juce::ScrollBar::thumbColourId,      theme::bezel);
        }

        void drawButtonBackground (juce::Graphics& g, juce::Button& b,
                                   const juce::Colour& /*backgroundColour*/,
                                   bool over, bool down) override
        {
            auto r    = b.getLocalBounds().toFloat().reduced (0.5f);
            auto base = b.findColour (juce::TextButton::buttonColourId);
            if (! b.isEnabled())     base = base.withMultipliedAlpha (0.45f);
            else if (down)           base = base.darker (0.18f);
            else if (over)           base = base.brighter (0.14f);

            g.setColour (base);
            g.fillRoundedRectangle (r, 8.0f);
            g.setColour (theme::bezel.withAlpha (b.isEnabled() ? 1.0f : 0.4f));
            g.drawRoundedRectangle (r, 8.0f, 1.0f);
        }

        juce::Font getTextButtonFont (juce::TextButton&, int h) override
        {
            return juce::Font (juce::FontOptions ((float) juce::jmin (15, h - 12)).withStyle ("Semibold"));
        }
    };
}

VstaiAudioProcessorEditor::VstaiAudioProcessorEditor (VstaiAudioProcessor& p)
    : AudioProcessorEditor (&p), processor (p)
{
    // Dark/accent theme matching the generated GUIs. Applied to the whole tree;
    // cleared in the destructor (must outlive every child — see lnf's lifetime).
    lnf = std::make_unique<VstaiLookAndFeel>();
    setLookAndFeel (lnf.get());

    // Header brand strip.
    titleLabel.setText ("\xE2\x97\x88  VibePlugin", juce::dontSendNotification);
    titleLabel.setFont (juce::Font (juce::FontOptions (17.0f).withStyle ("Semibold")));
    titleLabel.setColour (juce::Label::textColourId, theme::accent);
    titleLabel.setTooltip ("Describe a plugin in plain language; the AI builds and installs it.");
    addAndMakeVisible (titleLabel);

    // Bigger, multi-line prompt box. Enter still triggers Generate (so it
    // doubles as a comfortable multi-line field for longer descriptions).
    promptBox.setMultiLine (true, true);
    promptBox.setReturnKeyStartsNewLine (false);
    promptBox.setScrollbarsShown (true);
    promptBox.setFont (juce::Font (juce::FontOptions (16.0f)));
    promptBox.setTextToShowWhenEmpty ("Describe the plugin you want, or a change to make"
                                      "  (Enter to generate)", juce::Colours::grey);
    promptBox.setColour (juce::TextEditor::backgroundColourId, juce::Colour (0xff141a24));
    promptBox.setColour (juce::TextEditor::outlineColourId,    juce::Colour (0xff2a3344));
    promptBox.setColour (juce::TextEditor::focusedOutlineColourId, juce::Colour (0xff4d7cc7));
    promptBox.onReturnKey = [this] { doGenerate(); };
    addAndMakeVisible (promptBox);

    generateButton.onClick = [this] { doGenerate(); };
    generateButton.setColour (juce::TextButton::buttonColourId, theme::accent);
    generateButton.setColour (juce::TextButton::textColourOffId, juce::Colours::white);

    // Free, no-key path: copy the prompt into any chatbot, paste the reply back.
    chatbotButton.onClick = [this] { doGenerateManual(); };
    chatbotButton.setColour (juce::TextButton::buttonColourId, theme::accent2);
    chatbotButton.setColour (juce::TextButton::textColourOffId, juce::Colours::white);
    chatbotButton.setTooltip ("No API key needed \xE2\x80\x94 copies a ready-made prompt to your clipboard "
                              "for ChatGPT / Claude / Gemini, then paste the reply back to build it.");
    addAndMakeVisible (chatbotButton);

    newButton.onClick      = [this] { doNew(); };
    saveButton.onClick     = [this] { doSave(); };
    loadButton.onClick     = [this] { doLoad(); };
    keysButton.onClick     = [this] { openSettings(); };
    accountButton.onClick  = [this] { openAccount(); };
    licenseButton.onClick  = [this] { openLicense(); };
    addAndMakeVisible (generateButton);
    addAndMakeVisible (newButton);
    addAndMakeVisible (saveButton);
    addAndMakeVisible (loadButton);
    addAndMakeVisible (keysButton);
    addAndMakeVisible (accountButton);
    addAndMakeVisible (licenseButton);
    updateLicenseButton();

    // Cost controls: model + thinking effort. IDs map to API strings.
    modelLabel.setText ("Model", juce::dontSendNotification);
    modelLabel.setColour (juce::Label::textColourId, juce::Colours::grey);
    modelLabel.setJustificationType (juce::Justification::centredRight);
    effortLabel.setText ("Thinking", juce::dontSendNotification);
    effortLabel.setColour (juce::Label::textColourId, juce::Colours::grey);
    effortLabel.setJustificationType (juce::Justification::centredRight);
    addAndMakeVisible (modelLabel);
    addAndMakeVisible (effortLabel);

    effortBox.addItem ("Low (cheapest)", 1);
    effortBox.addItem ("Medium",         2);
    effortBox.addItem ("High",           3);
    effortBox.addItem ("Max",            4);
    const auto e = processor.getGenerationEffort();
    effortBox.setSelectedId (e == "low" ? 1 : e == "high" ? 3 : e == "max" ? 4 : 2,
                             juce::dontSendNotification);
    effortBox.onChange = [this] { onEffortChanged(); };

    // GLM exposes thinking as on/off rather than a depth; it shares the effort
    // slot and is shown only when a GLM model is selected (see updateEffortEnablement).
    thinkButton.setToggleState (processor.getGenerationThinking(), juce::dontSendNotification);
    thinkButton.onClick = [this]
    {
        processor.setGenerationThinking (thinkButton.getToggleState());
        updateEffortEnablement (false);   // refresh the reasoning panel's gating
    };
    addChildComponent (thinkButton);

    // Collapsible live-reasoning panel: a read-only view fed by the streaming sink,
    // hidden behind a disclosure toggle so it's there only if you "clap it open".
    thinkingView.setMultiLine (true);
    thinkingView.setReadOnly (true);
    thinkingView.setCaretVisible (false);
    thinkingView.setScrollbarsShown (true);
    thinkingView.setFont (juce::Font (juce::FontOptions()
                                          .withName (juce::Font::getDefaultMonospacedFontName())
                                          .withHeight (12.0f)));
    thinkingView.setColour (juce::TextEditor::backgroundColourId, juce::Colour (0xff0c0f16));
    thinkingView.setColour (juce::TextEditor::outlineColourId,    juce::Colour (0xff2a3344));
    thinkingView.setColour (juce::TextEditor::textColourId,       juce::Colour (0xff8aa0c8));
    addChildComponent (thinkingView);

    thinkingToggle.onClick = [this] { thinkingExpanded = ! thinkingExpanded; applyThinkingLayout(); };
    addChildComponent (thinkingToggle);

    // Stream GLM's reasoning into the view. The processor marshals this onto the
    // message thread, so it's safe to touch the component directly here.
    juce::Component::SafePointer<VstaiAudioProcessorEditor> safeThink (this);
    processor.onThinkingDelta = [safeThink] (const juce::String& delta)
    {
        if (safeThink == nullptr) return;
        // Keep this cheap: just accumulate (bounded). A timer repaints at a fixed
        // rate, so a fast token stream can't flood the message thread — which was
        // lagging the view and freezing the spinner.
        auto& buf = safeThink->thinkingBuffer;
        buf += delta;
        constexpr int kMaxThinkingChars = 16000;
        if (buf.length() > kMaxThinkingChars)
            buf = buf.substring (buf.length() - kMaxThinkingChars);
        safeThink->thinkingDirty = true;
    };

    // A build runs on the processor, not the editor — so if the window is closed
    // and reopened mid-build, resync the busy/spinner state from the processor.
    processor.onBuildStateChanged = [safeThink] { if (safeThink) safeThink->syncBuildState(); };

    // Model list: Anthropic + GLM, plus any local Ollama models (fetched
    // off-thread so a missing/slow Ollama server never stalls the editor).
    modelBox.onChange  = [this] { onModelChanged(); };
    rebuildModelBox();
    refreshOllamaModelsAsync();
    addAndMakeVisible (modelBox);
    addAndMakeVisible (effortBox);
    updateEffortEnablement (false);

    statusLabel.setJustificationType (juce::Justification::centredLeft);
    statusLabel.setColour (juce::Label::textColourId, juce::Colours::lightgrey);
    statusLabel.setText ("Ready.", juce::dontSendNotification);
    addAndMakeVisible (statusLabel);

    addChildComponent (spinner);   // shown only while a build is running

    // Live GUI WebView (becomes the first tab).
    auto options = juce::WebBrowserComponent::Options{}
        .withResourceProvider ([this] (const auto& url) { return provideResource (url); });
    web = std::make_unique<juce::WebBrowserComponent> (options);

    // Code editors for the DSP + GUI source.
    asmEditor  = std::make_unique<SourceEditor> (&asmTokeniser);
    htmlEditor = std::make_unique<SourceEditor> (&htmlTokeniser);
    asmEditor->onSave  = [this] { doSaveCompile(); };
    htmlEditor->onSave = [this] { doSaveCompile(); };

    // "Problems" tab: read-only compiler output (the in-plugin debugger).
    problemsView.setMultiLine (true);
    problemsView.setReadOnly (true);
    problemsView.setCaretVisible (false);
    problemsView.setScrollbarsShown (true);
    problemsView.setFont (juce::Font (juce::FontOptions()
                                          .withName (juce::Font::getDefaultMonospacedFontName())
                                          .withHeight (13.0f)));
    problemsView.setColour (juce::TextEditor::backgroundColourId, juce::Colour (0xff0c0f16));
    problemsView.setColour (juce::TextEditor::outlineColourId,    juce::Colour (0xff2a3344));
    problemsView.setColour (juce::TextEditor::textColourId,       juce::Colour (0xff9fb4d8));
    setProblems ("Edit the DSP or GUI, then Save & Compile (Cmd/Ctrl+S). "
                 "Compiler output and errors show up here.", false);

    // Prompt browser: step back to any earlier version without losing work.
    historyPanel = std::make_unique<HistoryPanel> (processor);
    historyPanel->onRestore = [this] (int id)
    {
        processor.restoreRevision (id);   // reloads engine + GUI; fires onDocumentChanged
        setProblems ("Restored an earlier version from History.", false);
    };

    // Standard UI: the editable house-style kit, fed to the model on every build.
    standardPanel = std::make_unique<StandardUiPanel>();
    standardPanel->setText (vstai::appsettings::standardUi());
    standardPanel->onSave = [this]
    {
        vstai::appsettings::setStandardUi (standardPanel->getText());
        statusLabel.setText ("Standard UI saved \xE2\x80\x94 it's now the house style for new generations.",
                             juce::dontSendNotification);
        if (! processor.getDocument().hasPlugin()) refreshWebView();   // update the live preview
    };
    standardPanel->onReset = [this]
    {
        vstai::appsettings::resetStandardUi();
        standardPanel->setText (vstai::appsettings::standardUi());      // = baked-in default
        statusLabel.setText ("Standard UI reset to the built-in default.", juce::dontSendNotification);
        if (! processor.getDocument().hasPlugin()) refreshWebView();
    };

    auto tabBg = juce::Colour (0xff0c0f16);
    tabs.setOutline (0);
    tabs.setTabBarDepth (28);
    tabs.setColour (juce::TabbedComponent::backgroundColourId, tabBg);
    tabs.addTab ("GUI",                  tabBg, web.get(),          false);
    tabs.addTab ("DSP (AssemblyScript)", tabBg, asmEditor.get(),    false);
    tabs.addTab ("GUI HTML",             tabBg, htmlEditor.get(),   false);
    tabs.addTab ("Notes",                tabBg, &problemsView,      false);  // index 3: AI explanation + compiler output
    tabs.addTab ("History",              tabBg, historyPanel.get(), false);
    tabs.addTab ("Standard UI",          tabBg, standardPanel.get(), false);
    addAndMakeVisible (tabs);

    compileButton.onClick = [this] { doSaveCompile(); };
    fixButton.onClick     = [this] { doFixWithAI(); };
    revertButton.onClick  = [this]
    {
        reseedEditors();
        setProblems ("Reverted to the last compiled source.", false);
    };
    addAndMakeVisible (compileButton);
    addAndMakeVisible (fixButton);
    addAndMakeVisible (revertButton);

    processor.onDocumentChanged = [this]
    {
        refreshWebView();
        reseedEditors();
        if (historyPanel != nullptr) historyPanel->refresh();
    };

    reseedEditors();
    refreshWebView();
    setResizable (true, true);
    setSize (900, 680);

    // If a build is still running (window was closed and reopened mid-generation),
    // restore the spinner + status so it doesn't look like the generation vanished.
    syncBuildState();

    // Shareware: pop the friendly warning once the editor is on screen (unless
    // licensed). A licensed install quietly re-validates in the background.
    // The nag fires once per DAW process (static flag), not on every plugin/window
    // open — re-opening or adding more instances won't re-trigger it.
    static std::atomic<bool> nagShownThisSession { false };
    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    juce::MessageManager::callAsync ([safe]
    {
        if (safe == nullptr) return;
        if (vstai::appsettings::isLicensed())
            safe->revalidateLicenseAsync();
        else if (! nagShownThisSession.exchange (true))
            safe->showNag();
    });
}

VstaiAudioProcessorEditor::~VstaiAudioProcessorEditor()
{
    stopTimer();
    processor.onDocumentChanged  = nullptr;
    processor.onThinkingDelta    = nullptr;
    processor.onBuildStateChanged = nullptr;

    // Close any native dialog still open, so it doesn't orphan past this editor.
    for (auto& d : openDialogs)
        if (auto* c = d.getComponent())
            delete c;
    openDialogs.clear();

    setLookAndFeel (nullptr);   // detach before lnf (and children) are destroyed
}

void VstaiAudioProcessorEditor::trackDialog (juce::Component* c)
{
    if (c != nullptr)
        openDialogs.add (c);
}

void VstaiAudioProcessorEditor::syncBuildState()
{
    if (processor.isBuilding())
    {
        const auto stage = processor.getBuildStage();
        setBusy (true, stage.isNotEmpty() ? stage : juce::String ("Generating with AI..."));
    }
    else if (spinner.isVisible())   // was building, just finished — clear the busy UI
    {
        setBusy (false, "Done.");
    }
}

void VstaiAudioProcessorEditor::refreshThinkingView()
{
    // Show only the tail so the text box stays small (and fast to lay out).
    auto lines = juce::StringArray::fromLines (thinkingBuffer);
    while (lines.size() > 50) lines.remove (0);
    thinkingView.setText (lines.joinIntoString ("\n"), false);
    thinkingView.moveCaretToEnd();
}

void VstaiAudioProcessorEditor::timerCallback()
{
    if (! thinkingDirty) return;
    thinkingDirty = false;
    refreshThinkingView();
}

std::optional<juce::WebBrowserComponent::Resource>
VstaiAudioProcessorEditor::provideResource (const juce::String& rawUrl)
{
    // Normalise: some backends pass the path without a leading slash.
    const juce::String url = rawUrl.startsWith ("/") ? rawUrl : ("/" + rawUrl);

    // Parameter bridge endpoint:  /__vstai/param/<index>/<value>
    if (url.startsWith ("/__vstai/param/"))
    {
        const auto m = vstai::bridge::parseParam (url);
        VSTAI_LOG ("GUI param[" + juce::String (m.index) + "] = " + juce::String (m.value)
                   + (m.valid ? "" : "  (ignored)"));
        if (m.valid)
            processor.setParamFromGui (m.index, m.value);
        return juce::WebBrowserComponent::Resource { toBytes ("ok"), "text/plain;charset=UTF-8" };
    }

    // Synth on-screen keyboard endpoint:  /__vstai/note/<note>/<velocity>/<on>
    if (url.startsWith ("/__vstai/note/"))
    {
        const auto m = vstai::bridge::parseNote (url);
        VSTAI_LOG ("GUI note " + juce::String (m.note) + (m.on ? " ON v" + juce::String (m.vel) : " OFF")
                   + (m.valid ? "" : "  (ignored)"));
        if (m.valid)
            processor.noteFromGui (m.note, m.vel, m.on);
        return juce::WebBrowserComponent::Resource { toBytes ("ok"), "text/plain;charset=UTF-8" };
    }

    // Sample upload endpoint:  /__vstai/sample/{begin|data|end}/...
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

    // Everything else serves the current GUI document.
    if (url == "/" || url.endsWithIgnoreCase ("index.html") || ! url.startsWith ("/__vstai"))
        return juce::WebBrowserComponent::Resource {
            toBytes (withBridge (processor.getDisplayHtml())), "text/html;charset=UTF-8" };

    return std::nullopt;
}

void VstaiAudioProcessorEditor::refreshWebView()
{
    if (web != nullptr)
        web->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
}

void VstaiAudioProcessorEditor::setBusy (bool busy, const juce::String& status)
{
    if (busy)
    {
        thinkingBuffer.clear();       // fresh reasoning for each run
        thinkingDirty = false;
        thinkingView.clear();
        startTimerHz (12);            // throttle live-reasoning repaints
    }
    else
    {
        stopTimer();
        refreshThinkingView();        // final flush of whatever streamed
    }
    generateButton.setEnabled (! busy);
    chatbotButton.setEnabled (! busy);
    newButton.setEnabled  (! busy);
    saveButton.setEnabled (! busy);
    loadButton.setEnabled (! busy);
    keysButton.setEnabled (! busy);
    accountButton.setEnabled (! busy);
    licenseButton.setEnabled (! busy);
    compileButton.setEnabled (! busy);
    fixButton.setEnabled     (! busy);
    revertButton.setEnabled  (! busy);
    if (asmEditor    != nullptr) asmEditor->setReadOnly  (busy);
    if (htmlEditor   != nullptr) htmlEditor->setReadOnly (busy);
    if (historyPanel != nullptr) historyPanel->setEnabled (! busy);
    promptBox.setEnabled  (! busy);
    modelBox.setEnabled   (! busy);
    updateEffortEnablement (busy);     // thinking depth is Anthropic-only
    spinner.setActive (busy);
    statusLabel.setText (status, juce::dontSendNotification);
    resized();   // status label width depends on whether the spinner is showing
}

void VstaiAudioProcessorEditor::setStage (const juce::String& stage)
{
    statusLabel.setText (stage, juce::dontSendNotification);
}

void VstaiAudioProcessorEditor::doGenerateManual()
{
    auto prompt = promptBox.getText().trim();
    if (prompt.isEmpty()) { statusLabel.setText ("Type a prompt first.", juce::dontSendNotification); return; }

    auto panel = std::make_unique<ManualPanel> (processor, prompt);
    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned (panel.release());
    o.dialogTitle = "Generate with any chatbot";
    o.dialogBackgroundColour = juce::Colour (0xff141a24);
    o.escapeKeyTriggersCloseButton = true;
    o.useNativeTitleBar = true;
    o.resizable = true;
    trackDialog (o.launchAsync());
    statusLabel.setText ("Prompt copied — paste it into a chatbot, then paste the reply back.",
                         juce::dontSendNotification);
}

void VstaiAudioProcessorEditor::doGenerate()
{
    if (currentProvider == "manual") { doGenerateManual(); return; }

    auto prompt = promptBox.getText().trim();
    if (prompt.isEmpty()) { statusLabel.setText ("Type a prompt first.", juce::dontSendNotification); return; }

    setBusy (true, "Generating with AI...");
    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    processor.requestBuild (prompt,
        [safe] (const juce::String& stage)         // progress: stage labels
        {
            if (safe != nullptr) safe->setStage (stage);
        },
        [safe] (bool ok, juce::String message)     // done; on success message = the AI's explanation
        {
            if (safe == nullptr) return; // editor was closed mid-build
            if (ok)
            {
                safe->promptBox.clear();
                const bool hasNotes = message.trim().isNotEmpty();
                if (hasNotes) safe->setProblems (message, false);   // full explanation in the Notes tab
                safe->setBusy (false, hasNotes ? "Done \xE2\x80\x94 the AI's notes are in the Notes tab."
                                               : juce::String ("Done."));
            }
            else
            {
                safe->setBusy (false, "Error: " + message);
            }
        });
}

void VstaiAudioProcessorEditor::doNew()
{
    processor.newPlugin();
    promptBox.clear();
    setBusy (false, "New blank plugin. Describe one above.");
}

void VstaiAudioProcessorEditor::reseedEditors()
{
    const auto& d = processor.getDocument();
    if (asmEditor != nullptr && asmEditor->getText() != d.assembly)
        asmEditor->setText (d.assembly);

    // Before any GUI is generated, seed the HTML tab with the effective starter
    // page so there's something to edit instead of a blank tab.
    const juce::String html = d.html.isNotEmpty() ? d.html : processor.getDisplayHtml();
    if (htmlEditor != nullptr && htmlEditor->getText() != html)
        htmlEditor->setText (html);
}

void VstaiAudioProcessorEditor::setProblems (const juce::String& text, bool isError)
{
    lastDiagnostics = isError ? text : juce::String();
    problemsView.setColour (juce::TextEditor::textColourId,
                            isError ? juce::Colour (0xffff8888) : juce::Colour (0xff9fdca0));
    problemsView.setText (text, juce::dontSendNotification);
}

void VstaiAudioProcessorEditor::doSaveCompile()
{
    const auto asmSrc  = asmEditor  != nullptr ? asmEditor->getText()  : juce::String();
    const auto htmlSrc = htmlEditor != nullptr ? htmlEditor->getText() : juce::String();

    if (asmSrc.trim().isEmpty())
    {
        setProblems ("Nothing to compile — the DSP (AssemblyScript) tab is empty.", true);
        tabs.setCurrentTabIndex (3);
        return;
    }

    setBusy (true, "Compiling edited code...");
    setProblems ("Compiling...", false);

    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    processor.requestRecompile (asmSrc, htmlSrc,
        [safe] (const juce::String& stage) { if (safe != nullptr) safe->setStage (stage); },
        [safe] (bool ok, juce::String diagnostics)
        {
            if (safe == nullptr) return;
            if (ok)
            {
                safe->setBusy (false, "Compiled OK.");
                safe->setProblems ("Compiled successfully — the plugin has been updated.", false);
            }
            else
            {
                safe->setBusy (false, "Compile failed.");
                safe->setProblems (diagnostics.isNotEmpty() ? diagnostics
                                                            : juce::String ("Compile failed."), true);
                safe->tabs.setCurrentTabIndex (3);   // jump to Problems
            }
        });
}

void VstaiAudioProcessorEditor::doFixWithAI()
{
    const auto asmSrc  = asmEditor  != nullptr ? asmEditor->getText()  : juce::String();
    const auto htmlSrc = htmlEditor != nullptr ? htmlEditor->getText() : juce::String();

    if (asmSrc.trim().isEmpty())
    {
        setProblems ("Nothing for the AI to fix — write or generate some DSP first.", true);
        tabs.setCurrentTabIndex (3);
        return;
    }

    // Make the model see exactly what's in the editors right now.
    processor.applyEditedSource (asmSrc, htmlSrc);

    juce::String prompt;
    if (lastDiagnostics.isNotEmpty())
        prompt = "The current DSP does not compile. Fix the AssemblyScript so it compiles cleanly; "
                 "keep the behaviour, the HTML GUI and the parameter indices stable unless the fix "
                 "requires changing them.\n\n=== COMPILER OUTPUT ===\n" + lastDiagnostics;
    else
        prompt = "Review the current DSP and GUI for bugs and fix any issues you find, keeping the "
                 "plugin's behaviour and parameter layout stable.";

    // In manual mode there's no model to call — route the fix through the same
    // copy-prompt/paste-reply dialog (it sees the just-applied source as context).
    if (currentProvider == "manual")
    {
        auto panel = std::make_unique<ManualPanel> (processor, prompt);
        juce::DialogWindow::LaunchOptions o;
        o.content.setOwned (panel.release());
        o.dialogTitle = "Fix with any chatbot";
        o.dialogBackgroundColour = juce::Colour (0xff141a24);
        o.escapeKeyTriggersCloseButton = true;
        o.useNativeTitleBar = true;
        o.resizable = true;
        trackDialog (o.launchAsync());
        setProblems ("Fix prompt copied — paste it into a chatbot, then paste the reply back.", false);
        return;
    }

    setBusy (true, "Fixing with AI...");
    setProblems ("Asking the AI to fix the code...", false);

    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    processor.requestBuild (prompt,
        [safe] (const juce::String& stage) { if (safe != nullptr) safe->setStage (stage); },
        [safe] (bool ok, juce::String message)
        {
            if (safe == nullptr) return;
            safe->setBusy (false, ok ? ("AI fix: " + message) : ("Error: " + message));
            if (ok)
                safe->setProblems ("The AI updated the code and it compiled.\n\n" + message, false);
            else
            {
                safe->setProblems (message, true);
                safe->tabs.setCurrentTabIndex (3);
            }
        });
}

void VstaiAudioProcessorEditor::onModelChanged()
{
    const int id = modelBox.getSelectedId();
    if (id < 1 || id > (int) modelOptions.size()) return;

    const auto& opt = modelOptions[(size_t) (id - 1)];
    currentProvider = opt.provider;
    processor.setGenerationProvider (opt.provider);
    processor.setGenerationModel    (opt.id);
    updateEffortEnablement (false);
}

void VstaiAudioProcessorEditor::updateEffortEnablement (bool busy)
{
    // Two cost controls share one slot under the "Thinking" label: Claude exposes
    // thinking *depth* (the effort dropdown), GLM exposes thinking *on/off* (the
    // toggle). Show whichever fits the selected model; grey the label when neither
    // (manual / Ollama) applies.
    const auto model    = processor.getGenerationModel();
    const bool isClaude = model.startsWithIgnoreCase ("claude");
    const bool isGlm    = model.startsWithIgnoreCase ("glm");

    effortBox.setVisible   (! isGlm);
    effortBox.setEnabled   (isClaude && ! busy);
    thinkButton.setVisible (isGlm);
    thinkButton.setEnabled (isGlm && ! busy);
    thinkButton.setToggleState (processor.getGenerationThinking(), juce::dontSendNotification);

    const bool any = (isClaude || isGlm) && ! busy;
    effortLabel.setColour (juce::Label::textColourId,
                           any ? juce::Colours::grey : juce::Colours::darkgrey);

    // The live-reasoning panel applies to the direct, streaming providers: GLM when
    // its thinking toggle is on, and Anthropic (Claude always reasons via adaptive
    // thinking). Cloud is buffered server-side, so there are no deltas to stream.
    const auto prov = processor.getGenerationProvider();
    const bool canStreamThinking = (prov == "anthropic")
                                || (prov == "glm" && processor.getGenerationThinking());
    thinkingToggle.setVisible (canStreamThinking);
    if (! canStreamThinking) thinkingExpanded = false;
    applyThinkingLayout();
}

void VstaiAudioProcessorEditor::applyThinkingLayout()
{
    thinkingToggle.setButtonText (juce::String (juce::CharPointer_UTF8 (
                                      thinkingExpanded ? "\xe2\x96\xbe" : "\xe2\x96\xb8"))
                                  + " See UI progress");
    thinkingView.setVisible (thinkingToggle.isVisible() && thinkingExpanded);
    resized();
}

void VstaiAudioProcessorEditor::rebuildModelBox()
{
    modelBox.clear (juce::dontSendNotification);
    modelOptions.clear();

    // 'manual' used to live in this list; it's now the dedicated "Copy to chatbot"
    // button. If an earlier session persisted it as the provider, fall back to a
    // real model so generation has something valid to call.
    if (processor.getGenerationProvider() == "manual")
    {
        processor.setGenerationProvider ("anthropic");
        processor.setGenerationModel    ("claude-opus-4-8");
        currentProvider = "anthropic";
    }

    auto add = [this] (const char* provider, juce::String modelId, juce::String label)
    {
        modelOptions.push_back ({ provider, modelId, label });
        modelBox.addItem (label, (int) modelOptions.size());   // ids are 1-based, no gaps
    };

    modelBox.addSectionHeading ("Anthropic (your key)");
    add ("anthropic", "claude-opus-4-8",   "Opus 4.8 (best)");
    add ("anthropic", "claude-sonnet-4-6", "Sonnet 4.6 (cheaper)");

    // GLM / Zhipu (Z.ai) — OpenAI-compatible. The exact model id must match what
    // your plan exposes; glm-4.6 is the known-good fallback if glm-5.2 isn't live yet.
    modelBox.addSectionHeading ("GLM / Z.ai (your key)");
    add ("glm", "glm-5.2", "GLM-5.2");
    add ("glm", "glm-4.6", "GLM-4.6");

    // VibePlugin Cloud: no key needed — buy credits + sign in (Account…). Generation
    // runs on our keys and is metered against your balance.
    modelBox.addSectionHeading ("VibePlugin Cloud (credits)");
    add ("cloud", "glm-5.2",           "Cloud · GLM-5.2 (cheapest)");
    add ("cloud", "claude-haiku-4-5",  "Cloud · Haiku 4.5");
    add ("cloud", "claude-sonnet-4-6", "Cloud · Sonnet 4.6");
    add ("cloud", "claude-opus-4-8",   "Cloud · Opus 4.8 (best)");

    if (! ollamaModels.isEmpty())
    {
        modelBox.addSectionHeading ("Ollama (local, no key)");
        for (const auto& m : ollamaModels)
            add ("ollama", m, m);
    }

    // Select the processor's current provider + model; if it isn't in the list
    // (e.g. a saved Ollama model that isn't pulled right now), add it.
    const auto curModel = processor.getGenerationModel();
    const auto curProv  = processor.getGenerationProvider();
    int sel = 0;
    for (size_t i = 0; i < modelOptions.size(); ++i)
        if (modelOptions[i].id == curModel && modelOptions[i].provider == curProv) { sel = (int) i + 1; break; }
    if (sel == 0)   // provider not set / not matched — fall back to model-only match
        for (size_t i = 0; i < modelOptions.size(); ++i)
            if (modelOptions[i].id == curModel) { sel = (int) i + 1; break; }

    if (sel == 0 && curModel.isNotEmpty())
    {
        auto prov = curProv;
        if (prov.isEmpty())
            prov = LlmClient::providerToString (LlmClient::providerForModel (curModel));
        modelBox.addSectionHeading ("Saved");
        add (prov.toRawUTF8(), curModel, curModel);
        sel = (int) modelOptions.size();
    }

    modelBox.setSelectedId (sel, juce::dontSendNotification);
    if (sel >= 1 && sel <= (int) modelOptions.size())
        currentProvider = modelOptions[(size_t) (sel - 1)].provider;
    updateEffortEnablement (false);
}

void VstaiAudioProcessorEditor::refreshOllamaModelsAsync()
{
    const juce::String baseUrl = vstai::appsettings::ollamaBaseUrl();
    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);

    std::thread ([safe, baseUrl]
    {
        juce::String err;
        auto models = LlmClient::listOllamaModels (baseUrl, err);

        juce::MessageManager::callAsync ([safe, models]
        {
            if (safe == nullptr) return;
            if (safe->ollamaModels != models)
            {
                safe->ollamaModels = models;
                safe->rebuildModelBox();
            }
        });
    }).detach();
}

void VstaiAudioProcessorEditor::openSettings()
{
    auto* aw = new juce::AlertWindow (
        "API keys & local models",
        "Leave a field blank to fall back to the compiled-in / environment value.\n"
        "Anthropic and GLM need a key; Ollama runs local open models with no key.",
        juce::MessageBoxIconType::NoIcon);

    aw->addTextEditor ("anthropic", vstai::appsettings::rawAnthropicKey(), "Anthropic API key", true);
    aw->addTextEditor ("glm",       vstai::appsettings::rawGlmKey(),       "GLM (Z.ai) API key", true);
    aw->addTextEditor ("glmurl",    vstai::appsettings::rawGlmUrl(),       "GLM URL (blank = Z.ai)");
    aw->addTextEditor ("ollama",    vstai::appsettings::ollamaBaseUrl(),   "Ollama URL");

    aw->addButton ("Save",   1, juce::KeyPress (juce::KeyPress::returnKey));
    aw->addButton ("Cancel", 0, juce::KeyPress (juce::KeyPress::escapeKey));

    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    aw->enterModalState (true,
        juce::ModalCallbackFunction::create ([safe, aw] (int result)
        {
            if (result == 1)
            {
                vstai::appsettings::setAnthropicKey (aw->getTextEditorContents ("anthropic").trim());
                vstai::appsettings::setGlmKey       (aw->getTextEditorContents ("glm").trim());
                vstai::appsettings::setGlmUrl       (aw->getTextEditorContents ("glmurl").trim());
                vstai::appsettings::setOllamaUrl    (aw->getTextEditorContents ("ollama").trim());

                if (safe != nullptr)
                {
                    safe->statusLabel.setText ("Settings saved.", juce::dontSendNotification);
                    safe->refreshOllamaModelsAsync();   // re-scan with the (possibly new) URL
                }
            }
        }),
        true);   // delete the AlertWindow when dismissed (after this callback runs)
    trackDialog (aw);
}

void VstaiAudioProcessorEditor::openAccount()
{
    auto panel = std::make_unique<AccountPanel>();
    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    panel->onChanged = [safe]
    {
        if (safe == nullptr) return;
        safe->updateLicenseButton();   // claiming the bundled license flips the toolbar
        safe->statusLabel.setText (vstai::appsettings::isSignedIn()
                                       ? ("Cloud: signed in as " + vstai::appsettings::cloudEmail())
                                       : juce::String ("Cloud: signed out"),
                                   juce::dontSendNotification);
    };

    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned (panel.release());
    o.dialogTitle = "VibePlugin Cloud credits";
    o.dialogBackgroundColour = juce::Colour (0xff141a24);
    o.escapeKeyTriggersCloseButton = true;
    o.useNativeTitleBar = true;
    o.resizable = false;
    trackDialog (o.launchAsync());
}

void VstaiAudioProcessorEditor::openLicense()
{
    auto panel = std::make_unique<LicensePanel>();
    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    panel->onChanged = [safe]
    {
        if (safe == nullptr) return;
        safe->updateLicenseButton();
        safe->statusLabel.setText (vstai::appsettings::isLicensed()
                                       ? ("Licensed to " + vstai::appsettings::licenseEmail())
                                       : juce::String ("Unlicensed (shareware)"),
                                   juce::dontSendNotification);
    };

    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned (panel.release());
    o.dialogTitle = "VibePlugin license";
    o.dialogBackgroundColour = juce::Colour (0xff141a24);
    o.escapeKeyTriggersCloseButton = true;
    o.useNativeTitleBar = true;
    o.resizable = false;
    trackDialog (o.launchAsync());
}

void VstaiAudioProcessorEditor::updateLicenseButton()
{
    const bool licensed = vstai::appsettings::isLicensed();
    licenseButton.setButtonText (licensed ? "Licensed \xE2\x9C\x93" : "Unlicensed");
    licenseButton.setColour (juce::TextButton::textColourOffId,
                             licensed ? juce::Colour (0xff9fdca0) : juce::Colour (0xffe0b050));
}

void VstaiAudioProcessorEditor::showNag()
{
    if (vstai::appsettings::isLicensed()) return;

    auto* aw = new juce::AlertWindow (
        "A friendly warning (this is a joke, mostly)",
        "Some people pay good money \xE2\x80\x94 actual dollars \xE2\x80\x94 for a plugin that writes "
        "plugins.\n\nYou? You're running it for free. We're not mad. Honestly, a little impressed.\n\n"
        "If this warning ever starts to feel like it's judging you (it isn't, it's just a label), a "
        "one-time lifetime license makes it vanish forever and funds roughly half a coffee for the "
        "developer. \xE2\x98\x95\n\n"
        "And here's the deal: buying any pack of cloud credits includes that lifetime license for "
        "free \xE2\x80\x94 the warning disappears the moment you sign in. Open the Account\xE2\x80\xA6 dialog to buy credits."
        "\n\nNo pressure \xE2\x80\x94 every feature works either way.",
        juce::MessageBoxIconType::NoIcon);

    aw->addButton ("Buy lifetime license", 1);
    aw->addButton ("I already have one",   2);
    aw->addButton ("Maybe later",          0, juce::KeyPress (juce::KeyPress::escapeKey));

    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    aw->enterModalState (true,
        juce::ModalCallbackFunction::create ([safe, aw] (int result)
        {
            if (result == 1)
            {
                juce::String url = vstai::appsettings::licenseCheckoutUrl();
                if (url.isEmpty()) url = vstai::appsettings::licenseServerUrl();
                juce::URL (url).launchInDefaultBrowser();
            }
            else if (result == 2 && safe != nullptr)
            {
                safe->openLicense();
            }
        }),
        true);
    trackDialog (aw);
}

void VstaiAudioProcessorEditor::revalidateLicenseAsync()
{
    const auto base    = vstai::appsettings::licenseServerUrl();
    const auto key     = vstai::appsettings::licenseKey();
    const auto machine = vstai::appsettings::machineId();
    if (key.isEmpty()) return;

    juce::Component::SafePointer<VstaiAudioProcessorEditor> safe (this);
    std::thread ([safe, base, key, machine]
    {
        auto resp = vstai::license::validate (base, key, machine);
        // Fail-open: only clear when the server is reachable AND says invalid.
        const bool reachable = resp.transportOk && resp.status >= 200 && resp.status < 300
                            && resp.json.isObject();
        const bool invalid   = reachable && ! (bool) resp.json.getProperty ("valid", true);
        if (! invalid) return;

        juce::MessageManager::callAsync ([safe]
        {
            vstai::appsettings::clearLicense();
            if (safe == nullptr) return;
            safe->updateLicenseButton();
            safe->statusLabel.setText ("Your license is no longer valid on this machine.",
                                       juce::dontSendNotification);
        });
    }).detach();
}

void VstaiAudioProcessorEditor::onEffortChanged()
{
    const char* e[] = { "low", "medium", "high", "max" };
    const int id = juce::jlimit (1, 4, effortBox.getSelectedId());
    processor.setGenerationEffort (e[id - 1]);
}

void VstaiAudioProcessorEditor::doSave()
{
    chooser = std::make_unique<juce::FileChooser> (
        "Save plugin as .vstai",
        juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
            .getChildFile (processor.getDocument().name + ".vstai"),
        "*.vstai");

    chooser->launchAsync (juce::FileBrowserComponent::saveMode
                        | juce::FileBrowserComponent::canSelectFiles,
        [this] (const juce::FileChooser& fc)
        {
            auto file = fc.getResult();
            if (file == juce::File()) return;
            if (file.getFileExtension().isEmpty()) file = file.withFileExtension ("vstai");
            juce::String err;
            setBusy (false, processor.saveDocument (file, err)
                                ? ("Saved " + file.getFileName())
                                : ("Save failed: " + err));
        });
}

void VstaiAudioProcessorEditor::doLoad()
{
    chooser = std::make_unique<juce::FileChooser> (
        "Open a .vstai plugin",
        juce::File::getSpecialLocation (juce::File::userDocumentsDirectory),
        "*.vstai");

    chooser->launchAsync (juce::FileBrowserComponent::openMode
                        | juce::FileBrowserComponent::canSelectFiles,
        [this] (const juce::FileChooser& fc)
        {
            auto file = fc.getResult();
            if (file == juce::File()) return;
            juce::String err;
            setBusy (false, processor.loadDocument (file, err)
                                ? ("Loaded " + file.getFileName())
                                : ("Load failed: " + err));
        });
}

void VstaiAudioProcessorEditor::paint (juce::Graphics& g)
{
    // Subtle top-lit radial wash (mirrors the generated GUI's body gradient),
    // with a darker base for the code/tab area below the control strip.
    auto b = getLocalBounds().toFloat();
    juce::ColourGradient grad (theme::panel2, b.getCentreX(), 0.0f,
                               theme::bg,     b.getCentreX(), b.getHeight(), false);
    g.setGradientFill (grad);
    g.fillRect (b);

    // Divider under the control strip.
    g.setColour (theme::bezel.withAlpha (0.6f));
    g.fillRect (0.0f, (float) kTopBarHeight, b.getWidth(), 1.0f);

    // The code/tabs region sits on the flat base colour.
    g.setColour (theme::bg);
    g.fillRect (0, kTopBarHeight + 1, getWidth(), getHeight() - kTopBarHeight - 1);
}

void VstaiAudioProcessorEditor::resized()
{
    auto r = getLocalBounds();
    auto bar = r.removeFromTop (kTopBarHeight).reduced (12, 10);

    // Header: brand strip.
    titleLabel.setBounds (bar.removeFromTop (24));
    bar.removeFromTop (8);

    // Row 1: big multi-line prompt box + Generate + Copy-to-chatbot.
    auto row1 = bar.removeFromTop (58);
    generateButton.setBounds (row1.removeFromRight (118));
    row1.removeFromRight (8);
    chatbotButton.setBounds  (row1.removeFromRight (150));
    row1.removeFromRight (10);
    promptBox.setBounds (row1);

    bar.removeFromTop (10);

    // Row 2: New / Save / Load / Keys / Account / License  +  Model & Thinking.
    auto row2 = bar.removeFromTop (28);
    newButton.setBounds  (row2.removeFromLeft (60));
    row2.removeFromLeft (6);
    saveButton.setBounds (row2.removeFromLeft (60));
    row2.removeFromLeft (6);
    loadButton.setBounds (row2.removeFromLeft (60));
    row2.removeFromLeft (6);
    keysButton.setBounds (row2.removeFromLeft (66));
    row2.removeFromLeft (6);
    accountButton.setBounds (row2.removeFromLeft (84));
    row2.removeFromLeft (6);
    licenseButton.setBounds (row2.removeFromLeft (96));

    effortBox.setBounds   (row2.removeFromRight (130));
    thinkButton.setBounds (effortBox.getBounds());   // same slot; only one is visible
    effortLabel.setBounds (row2.removeFromRight (62));
    row2.removeFromRight (8);
    modelBox.setBounds    (row2.removeFromRight (160));
    modelLabel.setBounds  (row2.removeFromRight (46));

    bar.removeFromTop (8);

    // Row 3: spinner + status (+ the "Thinking" disclosure on the right for GLM).
    auto row3 = bar.removeFromTop (22);
    if (thinkingToggle.isVisible())
    {
        thinkingToggle.setBounds (row3.removeFromRight (150));
        row3.removeFromRight (8);
    }
    if (spinner.isVisible())
    {
        auto sz = juce::jmin (row3.getHeight(), 18);
        spinner.setBounds (row3.removeFromLeft (sz).withSizeKeepingCentre (sz, sz));
        row3.removeFromLeft (8);
    }
    statusLabel.setBounds (row3);

    // Bottom action bar (applies to the code tabs); tabs fill the rest.
    auto actions = r.removeFromBottom (40).reduced (10, 6);
    compileButton.setBounds (actions.removeFromLeft (130));
    actions.removeFromLeft (6);
    fixButton.setBounds (actions.removeFromLeft (110));
    actions.removeFromLeft (6);
    revertButton.setBounds (actions.removeFromLeft (80));

    // Expanded reasoning panel takes a strip above the tabs; otherwise tabs fill all.
    if (thinkingView.isVisible())
        thinkingView.setBounds (r.removeFromTop (juce::jmin (180, r.getHeight() / 2))
                                    .reduced (10, 4));

    tabs.setBounds (r);
}
