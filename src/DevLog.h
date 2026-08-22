// DevLog.h
// =====================================================================
//  Logging for the generate / compile / network pipeline.
//
//  Two sinks, deliberately different:
//
//    * An ALWAYS-ON in-memory ring buffer (the last kRingLines lines). This
//      exists in release builds too, and is what the Settings ▸ Diagnostics
//      panel shows. A DAW gives you no stdout, and asking a user to find a
//      log file on disk is a dead end, so the plugin has to be able to show
//      its own log.
//    * A file logger, dev builds only (-DVSTAI_DEV_MODE=ON, scripts/dev.sh):
//          macOS : ~/Library/Logs/VibePlugin/<plugin>.log
//          Linux : ~/.config/VibePlugin/<plugin>.log
//      Useful for `tail -f` while working on the pipeline.
//
//  NOT realtime-safe (it locks and allocates) — never call VSTAI_LOG from
//  processBlock or anything else on the audio thread.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <memory>

#ifndef VSTAI_DEV_MODE
 #define VSTAI_DEV_MODE 0
#endif

namespace vstai::dev
{
    static constexpr int kRingLines = 600;   // ~ a few full builds' worth

    // Process-wide ring buffer. Shared by every plugin instance, which is what
    // you want: one timeline of everything that happened.
    struct Ring
    {
        juce::CriticalSection lock;
        juce::StringArray     lines;

        void add (const juce::String& msg)
        {
            const juce::ScopedLock sl (lock);
            lines.add (juce::Time::getCurrentTime().toString (false, true, true, true) + "  " + msg);
            while (lines.size() > kRingLines) lines.remove (0);
        }

        juce::String text() const
        {
            const juce::ScopedLock sl (lock);
            return lines.joinIntoString ("\n");
        }

        void clear()
        {
            const juce::ScopedLock sl (lock);
            lines.clear();
        }
    };

    inline Ring& ring() { static Ring r; return r; }

    inline void log (const juce::String& msg)
    {
        ring().add (msg);
       #if VSTAI_DEV_MODE
        juce::Logger::writeToLog (juce::String ("[VibePlugin] ") + msg);
       #endif
    }

   #if VSTAI_DEV_MODE
    // Install the file logger once per process; only the first call wins.
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

    inline juce::String logFilePath()
    {
        return juce::FileLogger::getSystemLogFileFolder().getFullPathName();
    }
   #else
    inline void initLog (const juce::String&) {}
    constexpr bool enabled = false;
    inline juce::String logFilePath() { return "(dev builds only)"; }
   #endif
}

#define VSTAI_LOG(msg) vstai::dev::log (msg)
