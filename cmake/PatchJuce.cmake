# PatchJuce.cmake
# ---------------------------------------------------------------------------
# VibePlugin reads the VST3 vendor and plugin name from
#   <bundle>/Contents/Resources/identity.json
# at load time (falling back to the compiled-in values), so "Export plugin..."
# can give a product ANY name/vendor instead of overwriting same-length bytes in
# the binary. JUCE bakes both into its VST3 factory; this makes three one-line
# substitutions in juce_VST3ModuleInfo.h, all guarded by VSTAI_RUNTIME_IDENTITY
# (set for our plugin targets; JUCE's build-time vst3_helper, which also includes
# that header but only writes moduleinfo.json, opts out and keeps the compiled-in names).
#
# Idempotent: safe to include on every configure, including a build dir whose
# juce-src was fetched before this patch existed. Fails loudly if JUCE moved the
# lines (e.g. after bumping GIT_TAG) rather than silently shipping without it.
# JUCE is AGPL-3.0 (or its commercial licence); this is a local source change.
# ---------------------------------------------------------------------------
set(_hdr "${juce_SOURCE_DIR}/modules/juce_audio_plugin_client/VST3/juce_VST3ModuleInfo.h")
if(NOT EXISTS "${_hdr}")
    message(FATAL_ERROR "PatchJuce: ${_hdr} not found")
endif()

file(READ "${_hdr}" _src)
string(FIND "${_src}" "VSTAI_RUNTIME_IDENTITY" _already)
if(_already EQUAL -1)
    set(_new "${_src}")

    string(REPLACE
"#pragma once

#ifndef DOXYGEN

namespace juce
{"
"#pragma once

#ifndef DOXYGEN

#if defined(VSTAI_RUNTIME_IDENTITY) && ! defined(VSTAI_RUNTIME_IDENTITY_OFF)
 // VibePlugin: vendor + name come from Contents/Resources/identity.json (src/RuntimeIdentity.h).
 const char* vstaiIdentityName();
 const char* vstaiIdentityVendor();
 #define VSTAI_ID_NAME()   vstaiIdentityName()
 #define VSTAI_ID_VENDOR() vstaiIdentityVendor()
#else
 #define VSTAI_ID_NAME()   JucePlugin_Name
 #define VSTAI_ID_VENDOR() JucePlugin_Manufacturer
#endif

namespace juce
{"
        _new "${_new}")

    string(REPLACE
"                     JucePlugin_Name,
                     includeFlagsAndCategory ? JucePlugin_Vst3ComponentFlags : 0,"
"                     VSTAI_ID_NAME(),
                     includeFlagsAndCategory ? JucePlugin_Vst3ComponentFlags : 0,"
        _new "${_new}")

    string(REPLACE
"                     JucePlugin_Manufacturer,
                     JucePlugin_VersionString,"
"                     VSTAI_ID_VENDOR(),
                     JucePlugin_VersionString,"
        _new "${_new}")

    string(REPLACE
"    {
        JucePlugin_Manufacturer,
        JucePlugin_ManufacturerWebsite,"
"    {
        VSTAI_ID_VENDOR(),
        JucePlugin_ManufacturerWebsite,"
        _new "${_new}")

    string(FIND "${_new}" "VSTAI_ID_NAME()," _a)
    string(FIND "${_new}" "VSTAI_ID_VENDOR()," _b)
    string(FIND "${_new}" "VSTAI_ID_VENDOR(),\n        JucePlugin_ManufacturerWebsite" _c)
    if(_a EQUAL -1 OR _b EQUAL -1 OR _c EQUAL -1)
        message(FATAL_ERROR "PatchJuce: juce_VST3ModuleInfo.h does not look as expected (JUCE version changed?). "
                            "Update cmake/PatchJuce.cmake, or the export vendor/name feature will not work.")
    endif()

    file(WRITE "${_hdr}" "${_new}")
    message(STATUS "PatchJuce: juce_VST3ModuleInfo.h now reads vendor/name from identity.json")
endif()

# The build-time vst3_helper (writes moduleinfo.json) shares the header but not our hook
# functions; make it opt out so it links and keeps reporting the compiled-in names.
set(_helper "${juce_SOURCE_DIR}/modules/juce_audio_plugin_client/VST3/juce_VST3ManifestHelper.cpp")
if(NOT EXISTS "${_helper}")
    message(FATAL_ERROR "PatchJuce: ${_helper} not found")
endif()
file(READ "${_helper}" _hsrc)
string(FIND "${_hsrc}" "VSTAI_RUNTIME_IDENTITY_OFF" _hdone)
if(_hdone EQUAL -1)
    string(REPLACE
"#include \"juce_VST3ModuleInfo.h\""
"#define VSTAI_RUNTIME_IDENTITY_OFF 1   // VibePlugin: see cmake/PatchJuce.cmake
#include \"juce_VST3ModuleInfo.h\""
        _hnew "${_hsrc}")
    string(FIND "${_hnew}" "VSTAI_RUNTIME_IDENTITY_OFF" _hok)
    if(_hok EQUAL -1)
        message(FATAL_ERROR "PatchJuce: juce_VST3ManifestHelper.cpp does not look as expected (JUCE version changed?).")
    endif()
    file(WRITE "${_helper}" "${_hnew}")
    message(STATUS "PatchJuce: vst3_helper keeps the compiled-in names")
endif()
