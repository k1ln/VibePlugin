// Utf8.h
// =====================================================================
//  vstai::u8() — build a juce::String from a UTF-8 literal.
//
//  juce::String's const char* constructor decodes through CharPointer_ASCII,
//  i.e. one byte -> one codepoint, so any literal above U+007F is mangled:
//  an em dash ("\xe2\x80\x94") surfaces in the UI as "a€". Every literal in
//  this codebase carrying typographic punctuation (— … · “ ” ★ →) must go
//  through here so the bytes are decoded as UTF-8 instead.
//
//  Source files are UTF-8; MSVC needs /utf-8 to agree (set in CMakeLists.txt).
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>

namespace vstai
{
    inline juce::String u8 (const char* utf8Literal)
    {
        return juce::String (juce::CharPointer_UTF8 (utf8Literal));
    }
}
