// MacKeyUpMonitor.h
// =====================================================================
//  macOS-only stuck-note fix: some hosts (FL Studio) receive the keyUp NSEvent
//  but never forward it to the plugin's WKWebView, so a GUI that saw the
//  keydown never sees the keyup and its note latches. Because the plugin lives
//  inside the host's process, an NSEvent *local monitor* observes every keyUp
//  the host app dispatches — before the host decides where (not) to route it.
//  The editor forwards each one into the WebView as a synthetic JS 'keyup'
//  KeyboardEvent, so the page's existing listeners fire as if the event had
//  arrived normally. The NSEvent is passed through to the host untouched.
//
//  Implementation in MacKeyUpMonitor.mm (compiled on APPLE only); this header
//  is safe to include everywhere.
// =====================================================================

#pragma once

#include <functional>
#include <memory>
#include <string>

class MacKeyUpMonitor
{
public:
    // key/code arrive pre-translated to the JS KeyboardEvent vocabulary
    // ("a" / "KeyA"). code is "" for keys outside the translation table.
    // Fired on the message thread (NSEvent monitors run during event dispatch).
    using Callback = std::function<void (const std::string& key, const std::string& code)>;

    // Returns the editor's native NSView* (or nullptr), resolved per event so
    // reparenting is handled. Used for the host-forwarding path below.
    using ViewProvider = std::function<void* ()>;

    // Besides the page re-injection callback, the monitor fixes the mirror-image
    // bug: WKWebView passes *unhandled keyDowns* up the responder chain (so FL's
    // typing-piano sees them and sends MIDI note-on) but SWALLOWS keyUps — the
    // host never sees the release and its MIDI note-off never comes, so the note
    // drones no matter what the GUI does. When a keyUp lands in our editor's
    // window, the monitor hands it straight to that window's keyUp: (the host
    // subclasses the plugin window and handles typing-piano keys there),
    // restoring the note-off. Hosts that DO see the keyup just get a duplicate
    // release, which is a no-op.
    //
    // Returns nullptr off-macOS or if the monitor could not be installed.
    static std::unique_ptr<MacKeyUpMonitor> install (Callback cb, ViewProvider viewProvider);

    ~MacKeyUpMonitor();

private:
    MacKeyUpMonitor() = default;
    void* monitor = nullptr;   // retained NSEvent monitor token
};
