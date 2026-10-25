// WebClapExport.h
// =====================================================================
//  "Export WebCLAP" — turn the loaded creation into a WebCLAP bundle: the
//  plugin format hosts such as openDAW run in the browser. A bundle is
//
//      <name>.wclap/module.wasm     the DSP as a CLAP plugin
//      <name>.wclap/ui/index.html   the GUI page (the plugin's own HTML + a shim)
//
//  packed as <name>.wclap.tar.gz, which openDAW imports with
//  "Load Plugin -> Import WebCLAP…".
//
//  module.wasm is the plugin's AssemblyScript compiled together with
//  ui/webclap/clap-adapter.ts (CLAP entry, parameters, notes, state, webview) and
//  a generated meta.ts, by the bundled compiler in --clap mode. The GUI page gets
//  ui/webclap/shim.js in place of the desktop bridge: window.vstai talks to the
//  module over the clap.webview message channel.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <functional>
#include <set>
#include "AssemblyScriptCompiler.h"
#include "VstaiDocument.h"
#include "WebAssets.h"
#include "Utf8.h"
#include "PresetBrowserUi.h"

namespace vstai::webclap
{
    // Same default window as the locked product editor.
    inline constexpr int kUiWidth  = 900;
    inline constexpr int kUiHeight = 600;

    inline juce::String slugOf (const juce::String& name)
    {
        juce::String out;
        bool dash = false;
        for (auto c : name.toLowerCase())
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) { if (dash && out.isNotEmpty()) out << '-'; out << juce::String::charToString (c); dash = false; }
            else dash = true;
        }
        return out.isEmpty() ? juce::String ("plugin") : out.substring (0, 48);
    }

    inline juce::String q (const juce::String& s) { return juce::JSON::toString (juce::var (s)); }

    // AssemblyScript `meta.ts` the adapter imports: identity and the parameter table.
    // `liveValue(index)` gives the sound the user left the plugin on.
    inline juce::String metaSource (const VstaiDocument& doc, const std::function<double (int)>& liveValue)
    {
        std::vector<const VstaiParam*> ps;
        std::set<int> seen;
        for (const auto& p : doc.params)
            if (p.index >= 0 && p.index < 63 && seen.insert (p.index).second)
                ps.push_back (&p);
        std::sort (ps.begin(), ps.end(), [] (auto* a, auto* b) { return a->index < b->index; });

        auto list = [&] (auto&& f)
        {
            juce::StringArray items;
            for (auto* p : ps) items.add (f (*p));
            return "[" + items.joinIntoString (",") + "]";
        };
        auto num = [] (double v) { return juce::String (v, 9); };
        const auto name = doc.name.isNotEmpty() ? doc.name : juce::String ("VibePlugin");

        juce::String s;
        s << "export const NAME: string = " << q (name) << ";\n"
          << "export const ID: string = " << q ("de.1ln.vibeplugin." + slugOf (name)) << ";\n"
          << "export const VENDOR: string = \"VibePlugin\";\n"
          << "export const VERSION: string = \"1.0.0\";\n"
          << "export const IS_SYNTH: bool = " << (doc.isInstrument ? "true" : "false") << ";\n"
          << "export const NUM_PARAMS: i32 = " << (int) ps.size() << ";\n"
          << "export const UI_W: u32 = " << kUiWidth << ";\n"
          << "export const UI_H: u32 = " << kUiHeight << ";\n"
          << "export const PARAM_NAMES: StaticArray<string> = " << list ([] (const VstaiParam& p) { return q (p.name); }) << ";\n"
          << "export const PARAM_INDEX: StaticArray<i32> = " << list ([] (const VstaiParam& p) { return juce::String (p.index); }) << ";\n"
          << "export const PARAM_MIN: StaticArray<f64> = " << list ([&] (const VstaiParam& p) { return num (p.minVal); }) << ";\n"
          << "export const PARAM_MAX: StaticArray<f64> = " << list ([&] (const VstaiParam& p) { return num (p.maxVal); }) << ";\n"
          << "export const PARAM_DEF: StaticArray<f64> = " << list ([&] (const VstaiParam& p) { return num (p.defVal); }) << ";\n"
          << "export const PARAM_VAL: StaticArray<f64> = " << list ([&] (const VstaiParam& p) { return num (liveValue ? liveValue (p.index) : p.value); }) << ";\n";
        return s;
    }

    // What the page-side sound browser (ui/webclap/presets.js) needs: the product, its parameter
    // table (to snapshot / apply a sound) and the factory sounds baked into the document.
    inline juce::String presetConfigJson (const VstaiDocument& doc)
    {
        auto* root = new juce::DynamicObject();
        root->setProperty ("id", "de.1ln.vibeplugin." + slugOf (doc.name));
        root->setProperty ("product", doc.name);
        root->setProperty ("instrument", doc.isInstrument);

        juce::Array<juce::var> params;
        std::set<int> seen;
        for (const auto& p : doc.params)
            if (p.index >= 0 && p.index < 63 && seen.insert (p.index).second)
            {
                auto* o = new juce::DynamicObject();
                o->setProperty ("index", p.index);
                o->setProperty ("def", p.defVal);
                params.add (juce::var (o));
            }
        root->setProperty ("params", params);

        juce::Array<juce::var> presets;
        for (const auto& pr : doc.presets)
        {
            auto* o = new juce::DynamicObject();
            o->setProperty ("name", pr.name);
            o->setProperty ("category", pr.category);
            juce::Array<juce::var> tags;
            for (const auto& t : pr.tags) tags.add (t);
            o->setProperty ("tags", tags);
            auto* vals = new juce::DynamicObject();
            for (const auto& kv : pr.values)
                if (seen.count (kv.first)) vals->setProperty (juce::String (kv.first), kv.second);
            o->setProperty ("values", juce::var (vals));
            presets.add (juce::var (o));
        }
        root->setProperty ("presets", presets);
        return juce::JSON::toString (juce::var (root), true).replace ("</", "<\\/");   // never close the <script> early
    }

    // The plugin's GUI with the WebCLAP shim spliced in where the desktop bridge would go, followed by
    // the sound browser: its host side (presets.js) and the same drawer the desktop plugin uses.
    inline juce::String pageWithShim (const juce::String& html, const juce::String& shimJs,
                                      const juce::String& presetCfgJson = {}, const juce::String& presetsJs = {})
    {
        juce::String inject = "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                              "<script>" + shimJs + "</script>";
        if (presetCfgJson.isNotEmpty() && presetsJs.isNotEmpty())
            inject << "<script>window.__vstaiPresetCfg=" << presetCfgJson << ";</script>"
                   << "<script>" << presetsJs << "</script>"
                   << vstai::u8 (vstai::shim::kPresetBrowserUi);   // UTF-8 strings (arrows, star): not Latin-1
        int head = html.indexOfIgnoreCase ("<head>");
        if (head >= 0) return html.substring (0, head + 6) + inject + html.substring (head + 6);
        int body = html.indexOfIgnoreCase ("<body>");
        if (body >= 0) return html.substring (0, body + 6) + inject + html.substring (body + 6);
        return inject + html;
    }

    // ---- tar.gz (plain ustar, fixed times and owners: the same bundle always gives the same bytes)
    struct Entry { juce::String path; juce::MemoryBlock data; };

    inline void tarField (char* dst, int width, juce::int64 value)   // zero-padded octal, NUL terminated
    {
        std::snprintf (dst, (size_t) width, "%0*llo", width - 1, (unsigned long long) value);
    }

    inline bool writeTarGz (const juce::File& dest, std::vector<Entry> entries)
    {
        std::sort (entries.begin(), entries.end(), [] (const Entry& a, const Entry& b) { return a.path < b.path; });

        dest.deleteFile();
        auto file = std::make_unique<juce::FileOutputStream> (dest);
        if (file->failedToOpen()) return false;
        // windowBits 31 = deflate with a gzip header (JUCE's default 0 writes bare zlib).
        juce::GZIPCompressorOutputStream gz (*file, 9, 31);

        for (const auto& e : entries)
        {
            char h[512] = {};
            const auto name = e.path.toRawUTF8();
            if (std::strlen (name) >= 100) return false;
            std::memcpy (h, name, std::strlen (name));
            tarField (h + 100, 8, 0644);
            tarField (h + 108, 8, 0);
            tarField (h + 116, 8, 0);
            tarField (h + 124, 12, (juce::int64) e.data.getSize());
            tarField (h + 136, 12, 0);
            std::memset (h + 148, ' ', 8);
            h[156] = '0';
            std::memcpy (h + 257, "ustar", 5);                  // magic "ustar\0"
            h[263] = '0'; h[264] = '0';                          // version "00"
            unsigned sum = 0;
            for (char c : h) sum += (unsigned char) c;
            tarField (h + 148, 7, (juce::int64) sum);
            h[155] = ' ';
            gz.write (h, 512);
            gz.write (e.data.getData(), e.data.getSize());
            const auto pad = (512 - (e.data.getSize() % 512)) % 512;
            if (pad > 0) { char zero[512] = {}; gz.write (zero, pad); }
        }
        char end[1024] = {};
        gz.write (end, sizeof (end));
        gz.flush();
        return ! file->getStatus().failed();
    }

    // Build the bundle for `doc` into `dest` (a .wclap.tar.gz). Blocking: compiles.
    inline bool exportBundle (AssemblyScriptCompiler& compiler, const VstaiDocument& doc,
                              const std::function<double (int)>& liveValue,
                              const juce::File& dest, juce::String& message)
    {
        if (doc.assembly.isEmpty() || doc.html.isEmpty())
        {
            message = "This plugin has no AssemblyScript source or GUI to export. Generate or load one first.";
            return false;
        }
        const auto adapter = vstai::webassets::readText ("webclap/clap-adapter.ts");
        const auto shim    = vstai::webassets::readText ("webclap/shim.js");
        const auto presets = vstai::webassets::readText ("webclap/presets.js");
        if (adapter.isEmpty() || shim.isEmpty() || presets.isEmpty())
        {
            message = "The WebCLAP adapter files (ui/webclap) were not found next to the plugin.";
            return false;
        }

        std::vector<uint8_t> wasm;
        juce::String diag;
        if (! compiler.compileWebClap (adapter, doc.assembly, metaSource (doc, liveValue), wasm, diag))
        {
            message = "WebCLAP compile failed:\n" + diag.trim().substring (0, 1500)
                    + "\n\n(If this mentions plugin.ts or --clap, rebuild the bundled compiler with compiler/build.sh.)";
            return false;
        }

        const auto root = slugOf (doc.name) + ".wclap";
        std::vector<Entry> entries;
        entries.push_back ({ root + "/module.wasm", juce::MemoryBlock (wasm.data(), wasm.size()) });
        const auto page = pageWithShim (doc.html, shim, presetConfigJson (doc), presets).toStdString();
        entries.push_back ({ root + "/ui/index.html", juce::MemoryBlock (page.data(), page.size()) });

        if (! writeTarGz (dest, std::move (entries)))
        {
            message = "Could not write " + dest.getFullPathName();
            return false;
        }

        const auto bytes = dest.getSize();
        const auto size = bytes >= 1048576 ? juce::String ((double) bytes / 1048576.0, 1) + " MB"
                                           : juce::String ((bytes + 512) / 1024) + " KB";
        message = vstai::u8 ("Exported “") + doc.name + vstai::u8 ("” as a WebCLAP bundle (")
                + size + "): " + dest.getFullPathName()
                + vstai::u8 ("\nIn openDAW: add a WebCLAP device, then Load Plugin → Import WebCLAP… and pick this file.");
        if (doc.assembly.contains ("getSamplePtr"))
            message += "\n\nNote: this plugin loads samples, which the WebCLAP version can't do yet.";
        return true;
    }
}
