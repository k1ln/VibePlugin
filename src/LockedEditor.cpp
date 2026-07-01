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

    juce::Component::SafePointer<LockedEditor> safe (this);

    auto options = juce::WebBrowserComponent::Options{}
        .withKeepPageLoadedWhenBrowserIsHidden()
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
    };
    web = std::move (browser);
    addAndMakeVisible (*web);

    setResizable (true, true);
    setSize (900, 600);
    web->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    startTimerHz (30);   // host-automation -> GUI reflection
}

LockedEditor::~LockedEditor()
{
    stopTimer();
}

void LockedEditor::resized()
{
    if (web != nullptr) web->setBounds (getLocalBounds());
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

void LockedEditor::timerCallback()
{
    reflectParamsToGui();
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
