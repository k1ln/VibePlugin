// MacKeyUpMonitor.mm — see MacKeyUpMonitor.h for why this exists.
#include "MacKeyUpMonitor.h"

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

#if __has_feature(objc_arc)
 #error "MacKeyUpMonitor.mm is written for manual retain/release — compile without -fobjc-arc"
#endif

namespace
{
    // ANSI virtual keycode -> JS KeyboardEvent {code, key} (US layout for `key`;
    // GUIs mostly match on e.key.toLowerCase() against a US key row, and `code`
    // is layout-independent). Covers the typing keys GUIs use for on-screen
    // keyboards; anything else is left untranslated.
    struct KeyMap { unsigned short kc; const char* code; const char* key; };

    const KeyMap kKeyMap[] =
    {
        { 0,  "KeyA", "a" },  { 1,  "KeyS", "s" },  { 2,  "KeyD", "d" },
        { 3,  "KeyF", "f" },  { 4,  "KeyH", "h" },  { 5,  "KeyG", "g" },
        { 6,  "KeyZ", "z" },  { 7,  "KeyX", "x" },  { 8,  "KeyC", "c" },
        { 9,  "KeyV", "v" },  { 11, "KeyB", "b" },  { 12, "KeyQ", "q" },
        { 13, "KeyW", "w" },  { 14, "KeyE", "e" },  { 15, "KeyR", "r" },
        { 16, "KeyY", "y" },  { 17, "KeyT", "t" },  { 18, "Digit1", "1" },
        { 19, "Digit2", "2" },{ 20, "Digit3", "3" },{ 21, "Digit4", "4" },
        { 22, "Digit6", "6" },{ 23, "Digit5", "5" },{ 24, "Equal", "=" },
        { 25, "Digit9", "9" },{ 26, "Digit7", "7" },{ 27, "Minus", "-" },
        { 28, "Digit8", "8" },{ 29, "Digit0", "0" },{ 30, "BracketRight", "]" },
        { 31, "KeyO", "o" },  { 32, "KeyU", "u" },  { 33, "BracketLeft", "[" },
        { 34, "KeyI", "i" },  { 35, "KeyP", "p" },  { 37, "KeyL", "l" },
        { 38, "KeyJ", "j" },  { 39, "Quote", "'" }, { 40, "KeyK", "k" },
        { 41, "Semicolon", ";" }, { 42, "Backslash", "\\" }, { 43, "Comma", "," },
        { 44, "Slash", "/" }, { 45, "KeyN", "n" },  { 46, "KeyM", "m" },
        { 47, "Period", "." },{ 49, "Space", " " }, { 50, "Backquote", "`" },
    };

    const char* jsCodeFor (unsigned short kc)
    {
        for (const auto& m : kKeyMap)
            if (m.kc == kc)
                return m.code;
        return "";
    }
}

std::unique_ptr<MacKeyUpMonitor> MacKeyUpMonitor::install (Callback cb, ViewProvider viewProvider)
{
    auto shared     = std::make_shared<Callback> (std::move (cb));
    auto viewShared = std::make_shared<ViewProvider> (std::move (viewProvider));

    id token = [NSEvent addLocalMonitorForEventsMatchingMask: NSEventMaskKeyUp
                                                     handler: ^NSEvent* (NSEvent* e)
    {
        // 1) Re-inject into the page so GUI-side key handlers see the release.
        NSString* chars = [e charactersIgnoringModifiers];
        std::string key = (chars != nil && [chars length] > 0) ? std::string ([chars UTF8String]) : std::string();
        (*shared) (key, jsCodeFor ([e keyCode]));

        // 2) Hand the host the release the WKWebView is about to swallow (see
        //    the header): if this keyUp is headed for our editor's window, call
        //    that window's keyUp: directly — the host (FL) handles typing-piano
        //    keys at the window level and sends the missing MIDI note-off.
        if (*viewShared != nullptr)
        {
            NSView*   v = (NSView*) (*viewShared)();
            NSWindow* w = [e window];
            if (v != nil && w != nil && w == [v window])
                [w keyUp: e];
        }

        return e;   // pass through to normal dispatch untouched
    }];

    if (token == nil)
        return nullptr;

    std::unique_ptr<MacKeyUpMonitor> m (new MacKeyUpMonitor());
    m->monitor = (void*) [token retain];
    return m;
}

MacKeyUpMonitor::~MacKeyUpMonitor()
{
    if (monitor != nullptr)
    {
        id token = (id) monitor;
        [NSEvent removeMonitor: token];
        [token release];
        monitor = nullptr;
    }
}

std::vector<MacKeyStatePoller::Release> MacKeyStatePoller::pollReleases()
{
    std::vector<Release> released;

    for (const auto& m : kKeyMap)
    {
        // Physical key state from the HID system — bypasses all event routing,
        // so it works even when the host swallows the keyUp NSEvent entirely.
        const bool down = CGEventSourceKeyState (kCGEventSourceStateCombinedSessionState,
                                                 (CGKeyCode) m.kc);

        if (primed && wasDown[m.kc] && ! down)
            released.push_back ({ m.key, m.code });

        wasDown[m.kc] = down;
    }

    primed = true;
    return released;
}
