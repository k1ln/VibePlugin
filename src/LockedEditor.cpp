// LockedEditor.cpp — see LockedEditor.h for the design overview.
#include "LockedEditor.h"
#include "BridgeShim.h"

using juce::var;

namespace
{
    // A WebBrowserComponent that reports when its page has finished loading, so we
    // only start pushing param updates once the GUI (and its bridge shim) is live.
    class LockedBrowser : public juce::WebBrowserComponent
    {
    public:
        explicit LockedBrowser (const Options& o) : juce::WebBrowserComponent (o) {}
        std::function<void()> onLoaded;
        void pageFinishedLoading (const juce::String&) override { if (onLoaded) onLoaded(); }
    };
}

LockedEditor::LockedEditor (VstaiAudioProcessor& p)
    : AudioProcessorEditor (&p), processor (p)
{
    for (auto& v : lastSentParam) v = -1.0e30f;
    for (auto& v : lastSentDisplay) v = -1.0e30f;

    juce::Component::SafePointer<LockedEditor> safe (this);

    auto options = juce::WebBrowserComponent::Options{}
        .withKeepPageLoadedWhenBrowserIsHidden()
        // See WebEditor.cpp: on Windows the backend must be requested explicitly
        // (defaultBackend is IE, which can't serve a resource provider), and
        // WebView2 needs a writable user-data folder outside C:\Program Files.
       #if JUCE_WINDOWS
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2{}
            .withUserDataFolder (juce::File::getSpecialLocation (juce::File::tempDirectory)))
       #endif
        .withResourceProvider ([safe] (const auto& url) -> std::optional<juce::WebBrowserComponent::Resource>
        {
            if (safe == nullptr) return std::nullopt;
            return safe->provideResource (url);
        });

    auto browser = std::make_unique<LockedBrowser> (options);
    browser->onLoaded = [safe]
    {
        if (safe == nullptr) return;
        safe->pageReady = true;
        for (auto& v : safe->lastSentParam) v = -1.0e30f;   // force a full resync
        for (auto& v : safe->lastSentDisplay) v = -1.0e30f;
    };
    web = std::move (browser);
    addAndMakeVisible (*web);

    // Sound bar: ‹ name › — the name opens the browser drawer. Product surface (like a
    // hardware synth's preset knob), not an authoring escape hatch.
    auto styleButton = [] (juce::TextButton& b)
    {
        b.setColour (juce::TextButton::buttonColourId,  juce::Colour (0xff141a24));
        b.setColour (juce::TextButton::buttonOnColourId, juce::Colour (0xff1d2a3a));
        b.setColour (juce::TextButton::textColourOffId, juce::Colour (0xffe7ecf4));
        b.setColour (juce::TextButton::textColourOnId,  juce::Colour (0xffe7ecf4));
    };
    prevButton.setButtonText (juce::CharPointer_UTF8 ("\xE2\x80\xB9"));
    nextButton.setButtonText (juce::CharPointer_UTF8 ("\xE2\x80\xBA"));
    nameButton.setButtonText ("Sounds");
    saveButton.setButtonText ("Save");
    for (auto* b : { &prevButton, &nameButton, &nextButton, &saveButton }) { styleButton (*b); addAndMakeVisible (*b); }
    saveButton.setTooltip ("Save the current knob positions as a sound (kept on disk)");
    saveButton.onClick = [safe] { if (safe != nullptr) safe->sendBrowserAction ("save"); };
    prevButton.setTooltip ("Previous sound");
    nextButton.setTooltip ("Next sound");
    nameButton.setTooltip ("Browse sounds: types, tags, favorites");
    prevButton.onClick = [safe] { if (safe != nullptr) safe->sendBrowserAction ("prev"); };
    nextButton.onClick = [safe] { if (safe != nullptr) safe->sendBrowserAction ("next"); };
    nameButton.onClick = [safe] { if (safe != nullptr) safe->sendBrowserAction ("toggle"); };

#if JUCE_MAC
    // Keyups the WKWebView swallows: re-inject into the page (GUI key handlers)
    // and hand them back to the host window (FL typing-piano note-off) — see
    // MacKeyUpMonitor.h.
    keyUpMonitor = MacKeyUpMonitor::install (
        [safe] (const std::string& key, const std::string& code)
        {
            if (safe != nullptr && safe->web != nullptr)
                safe->web->evaluateJavascript (vstai::shim::syntheticKeyUpJs (key, code));
        },
        [safe]() -> void*
        {
            if (safe == nullptr) return nullptr;
            if (auto* peer = safe->getPeer()) return peer->getNativeHandle();
            return nullptr;
        });
#endif

    processor.onParamContextMenu = [safe] (int index)
    {
        if (safe != nullptr) vstai::shim::showHostParamMenu (*safe, safe->processor, index);
    };

    setResizable (true, true);
    setSize (900, 600);
    web->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    startTimerHz (30);   // host-automation -> GUI reflection

    // Watch app-wide focus so we can release stuck GUI notes when the product UI
    // loses focus (removed in the destructor).
    juce::Desktop::getInstance().addFocusChangeListener (this);
}

LockedEditor::~LockedEditor()
{
    stopTimer();
    processor.onParamContextMenu = nullptr;
#if JUCE_MAC
    keyUpMonitor.reset();   // stop forwarding before `web` goes away
#endif
    juce::Desktop::getInstance().removeFocusChangeListener (this);
    releaseGuiNotes();   // window closing: don't leave a note droning
}

void LockedEditor::resized()
{
    auto bounds = getLocalBounds();
    {
        auto bar = bounds.removeFromTop (kPresetBarHeight).reduced (4, 2);
        prevButton.setBounds (bar.removeFromLeft (30));
        saveButton.setBounds (bar.removeFromRight (56));
        nextButton.setBounds (bar.removeFromRight (30));
        nameButton.setBounds (bar.reduced (4, 0));
    }
    if (web != nullptr) web->setBounds (bounds);
}

void LockedEditor::releaseGuiNotes()
{
    if (processor.isInstrument())
        processor.allNotesOffFromGui();
}

void LockedEditor::globalFocusChanged (juce::Component* focused)
{
    // Focus left the product UI (into the DAW, another plugin, or the app lost key
    // focus -> focused == nullptr). If the WebView swallowed the matching keyup, the
    // note is still held GUI-side, so flush it. Focus moves that stay within us (e.g.
    // into our own WebView child) are ignored so live playing isn't cut off.
    if (focused != this && ! isParentOf (focused))
        releaseGuiNotes();
}

void LockedEditor::visibilityChanged()
{
    if (! isShowing())
        releaseGuiNotes();   // window hidden/minimised: release held notes
}

std::optional<juce::WebBrowserComponent::Resource>
LockedEditor::provideResource (const juce::String& rawUrl)
{
    const juce::String url = rawUrl.startsWith ("/") ? rawUrl : ("/" + rawUrl);

    // GUI -> host bridge (params / notes / sample upload) — identical to WebEditor.
    if (auto r = vstai::shim::handleBridgeFetch (processor, url))
        return r;

    // The product GUI itself, served full-window as the whole document (no iframe;
    // there is no shell to sandbox it from). /preview is accepted too so GUIs that
    // happen to reference it still resolve.
    if (url == "/" || url.endsWithIgnoreCase ("/index.html")
        || url == "/preview" || url.endsWithIgnoreCase ("/preview"))
        return juce::WebBrowserComponent::Resource {
            vstai::shim::toBytes (vstai::shim::withBridge (processor.getDisplayHtml(),
                                                           vstai::shim::restoredValuesJson (processor))),
            "text/html;charset=UTF-8" };

    return std::nullopt;
}

void LockedEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff0e1319));
}

void LockedEditor::sendBrowserAction (const char* action)
{
    if (web != nullptr && pageReady)
        web->evaluateJavascript ("window.postMessage({type:'vstai:browser',action:'" + juce::String (action) + "'},'*');");
}

void LockedEditor::timerCallback()
{
    reflectParamsToGui();
    reflectDisplayToGui();

    // The sound name only changes when a sound is loaded: poll a few times a second.
    if (++nameTick >= 8)
    {
        nameTick = 0;
        const auto n = processor.presetController().currentName();
        if (n != shownPresetName)
        {
            shownPresetName = n;
            nameButton.setButtonText (n.isNotEmpty() ? n : juce::String ("Sounds"));
        }
    }
}

void LockedEditor::reflectDisplayToGui()
{
    if (web == nullptr || ! pageReady || ! processor.hasDisplay()) return;

    juce::Array<var> values;
    bool changed = false;
    for (int i = 0; i < vstai::kDisplaySlots; ++i)
    {
        const float v = processor.getDisplayValue (i);
        if (v != lastSentDisplay[i]) { lastSentDisplay[i] = v; changed = true; }
        values.add (v);
    }
    if (! changed) return;

    auto* o = new juce::DynamicObject();
    o->setProperty ("type", "vstai:display");
    o->setProperty ("values", values);
    web->evaluateJavascript ("window.postMessage(" + juce::JSON::toString (var (o), true) + ", '*');");
}

void LockedEditor::reflectParamsToGui()
{
    if (web == nullptr || ! pageReady) return;

    var values (new juce::DynamicObject());
    auto* vo = values.getDynamicObject();
    bool any = false;

    for (const auto& prm : processor.getDocument().params)
    {
        const int i = prm.index;
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

    if (! any) return;

    // Hand the GUI the same { type:'vstai:params', values:{…} } message the bridge
    // shim's window 'message' listener already understands (the authoring editor
    // delivers it via postMessage from the shell; here we post it into the window).
    auto* o = new juce::DynamicObject();
    o->setProperty ("type", "vstai:params");
    o->setProperty ("values", values);
    const auto json = juce::JSON::toString (var (o), true);
    web->evaluateJavascript ("window.postMessage(" + json + ", '*');");
}
