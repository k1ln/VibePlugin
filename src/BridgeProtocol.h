// BridgeProtocol.h
// =====================================================================
//  The single source of truth for the WebView <-> host control protocol.
//  The injected window.vstai shim (PluginEditor) builds these URLs; the
//  resource provider parses them here. Data is carried in the URL *path*
//  (not the query string, which some WebView backends drop) and a leading
//  slash is optional. Kept header-only so the unit test can verify it.
//
//    setParam(i, v)   ->  /__vstai/param/<index>/<value>
//    noteOn(n, v)     ->  /__vstai/note/<note>/<velocity>/1
//    noteOff(n)       ->  /__vstai/note/<note>/0/0
//
//  Sample upload is too big for one URL, so loadSample() streams it as a
//  begin / many-data / end sequence of awaited GETs. PCM bytes ride in the path
//  as base64url (A-Za-z0-9-_, no '/' so path-splitting is safe):
//    begin ->  /__vstai/sample/begin/<channels>/<frames>/<sampleRate>
//    data  ->  /__vstai/sample/data/<base64url planar-f32 chunk>
//    end   ->  /__vstai/sample/end
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>

namespace vstai::bridge
{
    struct ParamMsg { int index = -1;  float value = 0.0f; bool valid = false; };
    struct NoteMsg  { int note  = -1;  float vel   = 1.0f; bool on = false; bool valid = false; };

    // Split the path segments after `prefix`, ignoring any "?query" and an
    // optional missing leading slash. Returns {} if the prefix doesn't match.
    inline juce::StringArray segmentsAfter (const juce::String& url, const juce::String& prefix)
    {
        const juce::String u = url.startsWith ("/") ? url : ("/" + url);
        if (! u.startsWith (prefix)) return {};
        auto rest = u.fromFirstOccurrenceOf (prefix, false, false)
                     .upToFirstOccurrenceOf ("?", false, false);
        return juce::StringArray::fromTokens (rest, "/", "");
    }

    inline ParamMsg parseParam (const juce::String& url)
    {
        ParamMsg m;
        auto a = segmentsAfter (url, "/__vstai/param/");
        if (a.size() >= 2)
        {
            m.index = a[0].getIntValue();
            m.value = (float) juce::URL::removeEscapeChars (a[1]).getDoubleValue();
            m.valid = (m.index >= 0);
        }
        return m;
    }

    inline NoteMsg parseNote (const juce::String& url)
    {
        NoteMsg m;
        auto a = segmentsAfter (url, "/__vstai/note/");
        if (a.size() >= 3)
        {
            m.note = a[0].getIntValue();
            m.vel  = (float) a[1].getDoubleValue();
            m.on   = a[2].getIntValue() != 0;
            m.valid = (m.note >= 0 && m.note < 128);
        }
        return m;
    }

    struct SampleMsg
    {
        enum class Kind { none, begin, data, end };
        Kind  kind       = Kind::none;
        int   channels   = 0;        // begin
        int   frames     = 0;        // begin
        float sampleRate = 0.0f;     // begin
        juce::MemoryBlock bytes;     // data (decoded planar f32)
        bool  valid      = false;
    };

    // base64url ('-' '_' , no padding) -> raw bytes. JUCE's decoder wants the
    // standard alphabet, so translate back and re-pad before decoding.
    inline juce::MemoryBlock decodeBase64Url (const juce::String& in)
    {
        juce::String s = in.replaceCharacter ('-', '+').replaceCharacter ('_', '/');
        while ((s.length() % 4) != 0) s += "=";
        juce::MemoryOutputStream os;
        juce::Base64::convertFromBase64 (os, s);
        return os.getMemoryBlock();
    }

    inline SampleMsg parseSample (const juce::String& url)
    {
        SampleMsg m;
        auto a = segmentsAfter (url, "/__vstai/sample/");
        if (a.isEmpty()) return m;

        if (a[0] == "begin" && a.size() >= 4)
        {
            m.kind       = SampleMsg::Kind::begin;
            m.channels   = a[1].getIntValue();
            m.frames     = a[2].getIntValue();
            m.sampleRate = (float) a[3].getDoubleValue();
            m.valid      = (m.channels > 0 && m.frames > 0);
        }
        else if (a[0] == "data" && a.size() >= 2)
        {
            m.kind  = SampleMsg::Kind::data;
            m.bytes = decodeBase64Url (a[1]);
            m.valid = (m.bytes.getSize() > 0);
        }
        else if (a[0] == "end")
        {
            m.kind  = SampleMsg::Kind::end;
            m.valid = true;
        }
        return m;
    }
}
