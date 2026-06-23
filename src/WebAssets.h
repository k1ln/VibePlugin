// WebAssets.h
// =====================================================================
//  Locates the bundle's Resources/ui directory (shipped beside the binary)
//  and reads UI asset files at runtime. Used by the WebView editor shell and
//  by the Standard Kit loader. Mirrors Settings.h's resource-dir probing.
//
//  Dev hot-reload: set VSTAI_UI_DIR to the repo's ui/ folder to serve assets
//  straight from source (edit shell.css / standard.html and just reopen the
//  editor — no rebuild). The shipped Resources/ui copy is the fallback.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>

namespace vstai::webassets
{
    // Candidate ui/ directories, nearest first: an explicit env override, then
    // the locations Settings.h also probes for the bundled compiler.
    inline juce::Array<juce::File> uiDirs()
    {
        juce::Array<juce::File> out;

        const auto env = juce::SystemStats::getEnvironmentVariable ("VSTAI_UI_DIR", {});
        if (env.isNotEmpty())
            out.add (juce::File::getCurrentWorkingDirectory().getChildFile (env));

        auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
        for (auto base : { exe.getParentDirectory(),
                           exe.getParentDirectory().getChildFile ("Resources"),
                           exe.getParentDirectory().getParentDirectory().getChildFile ("Resources") })
            out.add (base.getChildFile ("ui"));

        return out;
    }

    // Resolve a relative path under ui/ (e.g. "shell.html",
    // "vendor/monaco/vs/loader.js"). Returns an invalid File if not found.
    inline juce::File resolve (const juce::String& relPath)
    {
        for (auto& d : uiDirs())
        {
            auto f = d.getChildFile (relPath);
            if (f.existsAsFile()) return f;
        }
        return {};
    }

    inline juce::String readText (const juce::String& relPath)
    {
        auto f = resolve (relPath);
        return f.existsAsFile() ? f.loadFileAsString() : juce::String();
    }

    // MIME type for the WebView resource provider, keyed off the extension.
    inline juce::String mimeFor (const juce::String& path)
    {
        const auto ext = path.fromLastOccurrenceOf (".", false, true).toLowerCase();
        if (ext == "html" || ext == "htm") return "text/html;charset=UTF-8";
        if (ext == "js"   || ext == "mjs") return "text/javascript;charset=UTF-8";
        if (ext == "css")  return "text/css;charset=UTF-8";
        if (ext == "json") return "application/json;charset=UTF-8";
        if (ext == "svg")  return "image/svg+xml";
        if (ext == "png")  return "image/png";
        if (ext == "woff2")return "font/woff2";
        if (ext == "woff") return "font/woff";
        if (ext == "ttf")  return "font/ttf";
        if (ext == "map")  return "application/json";
        return "application/octet-stream";
    }
}
