// RuntimeIdentity.h
// =====================================================================
//  The VST3 vendor + plugin name a DAW lists a VibePlugin bundle under.
//
//  JUCE compiles both into the binary. For an exported (whitelabel) plugin we
//  would have to overwrite same-length bytes in the Mach-O/DLL, which caps a name
//  at the length of "VibePlugin Synth". Instead cmake/PatchJuce.cmake makes JUCE's
//  VST3 factory ask vstaiIdentityVendor()/vstaiIdentityName() (defined in
//  PluginProcessor.cpp), which read
//
//      <bundle>/Contents/Resources/identity.json     {"vendor": "...", "name": "..."}
//
//  and fall back to the compiled-in values when the file is absent (a normal
//  VibePlugin install). "Export plugin..." writes the file, so an export can carry
//  any vendor/name up to the VST3 field size, on every platform, and the
//  bundle stays valid because only a Resources file changed (it is sealed by the
//  signing step that already runs last).
// =====================================================================
#pragma once

#include <juce_core/juce_core.h>

namespace vstai::identity
{
    inline constexpr const char* kFileName = "identity.json";

    // PFactoryInfo::vendor and PClassInfo2::name are char[64] (NUL included).
    inline constexpr int kMaxBytes = 63;

    struct Identity
    {
        juce::String vendor;   // empty = keep the compiled-in vendor
        juce::String name;     // empty = keep the compiled-in name
    };

    inline juce::File fileIn (const juce::File& bundle)
    {
        return bundle.getChildFile ("Contents").getChildFile ("Resources").getChildFile (kFileName);
    }

    // Longest prefix of `s` that fits in `maxBytes` of UTF-8 (whole characters only).
    inline juce::String clampBytes (juce::String s, int maxBytes = kMaxBytes)
    {
        while (s.isNotEmpty() && (int) s.getNumBytesAsUTF8() > maxBytes)
            s = s.dropLastCharacters (1);
        return s;
    }

    inline Identity parse (const juce::String& json)
    {
        Identity id;
        const auto v = juce::JSON::parse (json);
        if (auto* o = v.getDynamicObject())
        {
            id.vendor = clampBytes (o->getProperty ("vendor").toString().trim());
            id.name   = clampBytes (o->getProperty ("name").toString().trim());
        }
        return id;
    }

    inline juce::String serialise (const Identity& id)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("vendor", id.vendor);
        o->setProperty ("name",   id.name);
        return juce::JSON::toString (juce::var (o));
    }
}
