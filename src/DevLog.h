// DevLog.h
// =====================================================================
//  Development-mode logging. Compiled out completely in release builds.
//  Enable with the CMake option  -DVSTAI_DEV_MODE=ON  (scripts/dev.sh),
//  which defines VSTAI_DEV_MODE=1.
//
//  In a DAW you can't see stdout, so dev builds write to a file logger:
//      macOS : ~/Library/Logs/VibePlugin/<plugin>.log
//      Linux : ~/.config/VibePlugin/<plugin>.log
//  Tail it with:  scripts/dev.sh --tail   (or `tail -f` the path above).
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <memory>

#ifndef VSTAI_DEV_MODE
 #define VSTAI_DEV_MODE 0
#endif

namespace vstai::dev
{
   #if VSTAI_DEV_MODE
    // Install a file logger once per process. Safe to call from every plugin
    // instance; only the first call wins.
    inline void initLog (const juce::String& pluginName)
    {
        static std::unique_ptr<juce::FileLogger> logger;
        if (logger != nullptr)
            return;
        logger.reset (juce::FileLogger::createDefaultAppLogger (
            "VibePlugin", pluginName + ".log", "VibePlugin dev log " + pluginName));
        juce::Logger::setCurrentLogger (logger.get());
    }
    constexpr bool enabled = true;
   #else
    inline void initLog (const juce::String&) {}
    constexpr bool enabled = false;
   #endif
}

#if VSTAI_DEV_MODE
 #define VSTAI_LOG(msg) juce::Logger::writeToLog (juce::String ("[VibePlugin] ") + (msg))
#else
 #define VSTAI_LOG(msg) juce::ignoreUnused (msg)
#endif
