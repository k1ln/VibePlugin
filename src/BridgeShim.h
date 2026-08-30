// BridgeShim.h
// =====================================================================
//  The bridge between a generated plugin GUI and the host:
//    * kBridgeShim  — the JS shim injected into every generated GUI document.
//      It exposes window.vstai.{setParam,getParam,onParam,noteOn,noteOff,
//      loadSample} which talk to C++ over plain fetch() calls (no native
//      integration needed), and listens for "vstai:params" postMessages so host
//      automation can drive the on-screen controls.
//    * withBridge   — splice the shim into a GUI document's <head>/<body>.
//    * handleBridgeFetch — the resource-provider side: turn a "/__vstai/param|
//      note|sample/*" fetch into the matching processor call.
//
//  Shared by the full authoring editor (WebEditor — GUI sandboxed in a /preview
//  iframe) and the locked product editor (LockedEditor — GUI served full-window).
//  The shim text MUST stay byte-identical across both so generated GUIs behave
//  the same everywhere; keeping it here is what guarantees that.
// =====================================================================

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <optional>
#include <vector>
#include <cstddef>
#include <cstring>
#include "BridgeProtocol.h"
#include "PluginProcessor.h"

namespace vstai::shim
{
    using Resource = juce::WebBrowserComponent::Resource;

    inline const char* kCharsetMeta =
        R"HTML(<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">)HTML";

    inline const char* kBridgeShim = R"JS(<script>
(function(){
  var vals = {};
  // Values the host restored from the saved DAW session (these equal the plugin's
  // built-in defaults for a fresh or gallery load). Injected as window.__vstaiRestored
  // just before this shim. The generated GUI re-pushes its OWN defaults when it boots;
  // during that short boot window we redirect those pushes back to the restored value
  // so reopening a saved project keeps your exact sound instead of snapping to defaults.
  var restored = (window.__vstaiRestored && typeof window.__vstaiRestored === 'object') ? window.__vstaiRestored : {};
  for (var _rk in restored) vals[_rk] = +restored[_rk];
  var booting = true;
  function endBoot(){ booting = false; }
  // Any genuine user interaction ends the boot window; a timer covers plugins the
  // user never touches. Capture phase so it runs before a knob's own drag handler.
  window.addEventListener('pointerdown', endBoot, true);
  window.addEventListener('keydown',     endBoot, true);
  setTimeout(endBoot, 6000);
  // ---- host transport --------------------------------------------------
  // Normally the GUI reaches C++ with a plain fetch() on its own origin, which the
  // WebView's resource provider answers. That fails on WebViews that refuse to serve
  // a custom URL scheme inside a SUBFRAME (notably WKWebView before macOS 12), and
  // the authoring editor shows this document in a /preview iframe — the fetch never
  // arrives, so knobs and keys go dead while the page itself looks fine. So: probe
  // once, and if the direct path can't reach the host, relay every call through the
  // parent editor shell over postMessage. The shell lives in the top frame, where
  // the scheme always works. The locked product editor serves this document
  // full-window, so it is never framed and always takes the direct path.
  var inFrame = false;
  try { inFrame = !!(window.parent && window.parent !== window); } catch(e){ inFrame = true; }
  var relay  = false;       // true once direct fetch is known not to reach the host
  var probed = !inFrame;    // a top-level document needs no probe
  var queued = [];          // calls made while the probe was still in flight
  var relayN = 0, relayCbs = {};

  function direct(path){
    return fetch(path + (path.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now() + '_' + Math.random(),
                 { cache: 'no-store' }).then(function(r){ return r.text(); });
  }
  function viaParent(path){
    return new Promise(function(resolve, reject){
      var id = ++relayN;
      var t = setTimeout(function(){ delete relayCbs[id]; reject(new Error('bridge relay timed out')); }, 20000);
      relayCbs[id] = function(m){ clearTimeout(t); m.ok ? resolve(m.text || '') : reject(new Error(m.error || 'bridge relay failed')); };
      try { window.parent.postMessage({ type: 'vstai:bridge', id: id, path: path }, '*'); }
      catch(e){ clearTimeout(t); delete relayCbs[id]; reject(e); }
    });
  }
  // Every GUI->host call goes through here; resolves with the reply body.
  function call(path){
    if (probed) return (relay ? viaParent : direct)(path);
    return new Promise(function(resolve, reject){ queued.push({ path: path, resolve: resolve, reject: reject }); });
  }
  // Fire-and-forget (params, notes): a transport error must never reach the GUI.
  function send(path){ try { call(path).catch(function(){}); } catch(e){} }

  if (!probed){
    // Anything other than a prompt "ok" — a rejection, a WebView error page, or
    // silence — means this frame cannot see the resource provider. Falling back
    // when we didn't have to is harmless (the relay works everywhere), so the
    // probe is deliberately quick to give up.
    var settle = function(useRelay){
      if (probed) return;
      probed = true; relay = useRelay;
      var q = queued; queued = [];
      for (var i = 0; i < q.length; i++)
        (function(j){ (relay ? viaParent : direct)(j.path).then(j.resolve, j.reject); })(q[i]);
    };
    var probeTimer = setTimeout(function(){ settle(true); }, 1500);
    direct('/__vstai/ping').then(
      function(txt){ clearTimeout(probeTimer); settle(txt.indexOf('ok') !== 0); },
      function(){    clearTimeout(probeTimer); settle(true); });
  }

  // Liveness beacon. The editor shell watches for this after (re)loading the
  // preview frame; silence means the frame never loaded at all (a blocked scheme
  // shows the WebView's own "couldn't be reached" page), and the shell re-renders
  // this GUI inline instead. Repeated because the shell may still be booting when
  // this script first runs; it acks to stop the beacon, and we stop regardless
  // after a few seconds so a locked/unframed GUI never keeps a timer alive.
  var helloTimer = null;
  function hello(){ if (inFrame) { try { window.parent.postMessage({ type: 'vstai:hello' }, '*'); } catch(e){} } }
  function stopHello(){ if (helloTimer){ clearInterval(helloTimer); helloTimer = null; } }
  if (inFrame){
    hello();
    helloTimer = setInterval(hello, 250);
    setTimeout(stopHello, 4000);
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
    var cap = parseInt(await call('/__vstai/sample/begin/' + channels + '/' + frames + '/' + rate), 10) || 0;
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
      await call('/__vstai/sample/data/' + b64url(part));
      if (onProgress) { try { onProgress(Math.min(1, (off + CHUNK) / blob.length)); } catch(e){} }
    }
    var endTxt = await call('/__vstai/sample/end');
    if (endTxt.indexOf('ERR:') === 0) throw new Error(endTxt.substring(4));
    return { frames: frames, channels: channels, sampleRate: rate };
  }
  window.vstai = {
    setParam: function(i, v){
      v = +v;
      // Boot echo: the GUI is pushing its default while the host restored a different
      // value for this param -> keep the restored value. Once the user interacts
      // (booting=false) every write is honored verbatim.
      if (booting && (i in restored) && Math.abs(v - restored[i]) > 1e-6) v = restored[i];
      vals[i] = v; send('/__vstai/param/' + (i|0) + '/' + encodeURIComponent(v));
    },
    getParam: function(i){ return (i in vals) ? vals[i] : 0; },
    onReady: function(cb){ try { cb(); } catch(e){} },
    // Register cb(index, value) to be called when a param changes from OUTSIDE the
    // GUI (host automation, another controller). Controls use this to follow along.
    onParam: function(cb){
      if (typeof cb !== 'function') return;
      paramCbs.push(cb);
      // Hand the fresh listener the values we hold right now. A control is built
      // from the plugin's built-in default, so after a session restore it DRAWS the
      // default while the engine plays the saved sound. Replaying the state through
      // the same path host automation uses repaints it to what you actually saved.
      // Deferred a tick so the GUI's own init finishes first, and skipped once the
      // user has started interacting so we never fight a live drag.
      setTimeout(function(){
        if (!booting) return;
        for (var k in vals){ try { cb(+k, vals[k]); } catch(_){} }
      }, 0);
    },
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
  // The shell also answers relayed bridge calls and acks the liveness beacon here.
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d) return;
    if (d.type === 'vstai:hello:ack'){ stopHello(); return; }
    if (d.type === 'vstai:bridge:result'){
      var cb = relayCbs[d.id];
      if (cb){ delete relayCbs[d.id]; cb(d); }
      return;
    }
    if (d.type !== 'vstai:params' || !d.values) return;
    for (var k in d.values){ var idx = +k, val = +d.values[k]; vals[idx] = val;
      for (var j = 0; j < paramCbs.length; j++){ try { paramCbs[j](idx, val); } catch(_){} } }
  });
})();
</script>)JS";

    // Build the JS that re-injects a keyup the host swallowed (see MacKeyUpMonitor.h:
    // FL Studio receives the NSEvent but never forwards it to the WKWebView, so the
    // page saw the keydown but the note latches). Dispatching on the document bubbles
    // to window — both listener styles GUIs use — and the same event is fired into
    // every same-origin iframe because WebEditor serves the GUI in a /preview iframe.
    // A keyup the page never saw the keydown for is a no-op, so double delivery in
    // hosts that DO forward keyups is harmless.
    inline juce::String syntheticKeyUpJs (const std::string& key, const std::string& code)
    {
        const auto k = juce::JSON::toString (juce::var (juce::String (juce::CharPointer_UTF8 (key.c_str()))));
        const auto c = juce::JSON::toString (juce::var (juce::String (juce::CharPointer_UTF8 (code.c_str()))));
        return "(function(k,c){"
               "function fire(d){if(!d)return;try{d.dispatchEvent(new KeyboardEvent('keyup',{key:k,code:c,bubbles:true,cancelable:true}));}catch(e){}}"
               "fire(document);"
               "var fr=document.getElementsByTagName('iframe');"
               "for(var i=0;i<fr.length;i++){try{fire(fr[i].contentDocument);}catch(e){}}"
               "})(" + k + "," + c + ");";
    }

    inline std::vector<std::byte> toBytes (const juce::String& s)
    {
        auto utf8 = s.toRawUTF8();
        auto len  = s.getNumBytesAsUTF8();
        std::vector<std::byte> out (len);
        std::memcpy (out.data(), utf8, len);
        return out;
    }

    inline std::vector<std::byte> toBytes (const juce::MemoryBlock& m)
    {
        std::vector<std::byte> out (m.getSize());
        std::memcpy (out.data(), m.getData(), m.getSize());
        return out;
    }

    // Snapshot the current param values (0..1 knob space) as a JSON object keyed by
    // index. After the host restores a saved session these are the user's values;
    // for a fresh/gallery load they are the plugin's defaults. Injected as
    // window.__vstaiRestored so the bridge can keep the GUI's boot from resetting them.
    inline juce::String restoredValuesJson (VstaiAudioProcessor& processor)
    {
        juce::String s = "{";
        bool first = true;
        for (const auto& p : processor.getDocument().params)
        {
            if (p.index < 0 || p.index >= vstai::kMaxParams) continue;
            s << (first ? "" : ",") << "\"" << p.index << "\":"
              << juce::String (processor.getParamValue (p.index), 6);
            first = false;
        }
        s << "}";
        return s;
    }

    inline juce::String withBridge (const juce::String& html, const juce::String& initialValuesJson = "{}")
    {
        const juce::String initScript = "<script>window.__vstaiRestored=" + initialValuesJson + ";</script>";
        const juce::String inject = juce::String (kCharsetMeta) + initScript + kBridgeShim;
        int head = html.indexOfIgnoreCase ("<head>");
        if (head >= 0)
            return html.substring (0, head + 6) + inject + html.substring (head + 6);
        int body = html.indexOfIgnoreCase ("<body>");
        if (body >= 0)
            return html.substring (0, body + 6) + inject + html.substring (body + 6);
        return inject + html;
    }

    // Resolve a GUI->host fetch call (/__vstai/param|note|sample/*) into the matching
    // processor action. Returns a plain-text Resource when `url` is a bridge call,
    // else std::nullopt (so the caller keeps matching other routes).
    inline std::optional<Resource> handleBridgeFetch (VstaiAudioProcessor& processor,
                                                      const juce::String& url)
    {
        // Reachability probe. The shim calls this once from a framed GUI to find out
        // whether a direct fetch actually lands here; a reply of anything but "ok"
        // (including the WebView's own error page) makes it relay through the shell.
        if (url.startsWith ("/__vstai/ping"))
            return Resource { toBytes (juce::String ("ok")), "text/plain;charset=UTF-8" };
        if (url.startsWith ("/__vstai/param/"))
        {
            const auto m = vstai::bridge::parseParam (url);
            if (m.valid) processor.setParamFromGui (m.index, m.value);
            return Resource { toBytes (juce::String ("ok")), "text/plain;charset=UTF-8" };
        }
        if (url.startsWith ("/__vstai/note/"))
        {
            const auto m = vstai::bridge::parseNote (url);
            if (m.valid) processor.noteFromGui (m.note, m.vel, m.on);
            return Resource { toBytes (juce::String ("ok")), "text/plain;charset=UTF-8" };
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
            return Resource { toBytes (body), "text/plain;charset=UTF-8" };
        }
        return std::nullopt;
    }
}
