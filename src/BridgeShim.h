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

    inline juce::String withBridge (const juce::String& html)
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

    // Resolve a GUI->host fetch call (/__vstai/param|note|sample/*) into the matching
    // processor action. Returns a plain-text Resource when `url` is a bridge call,
    // else std::nullopt (so the caller keeps matching other routes).
    inline std::optional<Resource> handleBridgeFetch (VstaiAudioProcessor& processor,
                                                      const juce::String& url)
    {
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
