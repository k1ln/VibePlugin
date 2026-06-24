// Designs.h
// =====================================================================
//  Design "schools" — selectable visual languages for generated GUIs.
//
//  A design is ONE self-contained kit HTML (inline CSS/JS, talks to
//  window.vstai) that doubles as the starter GUI, the editable Standard UI
//  seed, and the house-style reference injected into the build prompt.
//
//  Built-in designs live on disk at ui/designs/<id>.html (shipped in the
//  bundle's Resources/ui, read via WebAssets). Each file begins with a
//  metadata header the app parses:
//
//      <!--VSTAI-DESIGN
//      {"id":"…","name":"…","blurb":"…","principles":"… prompt text …"}
//      -->
//
//  This header is the source of truth for a design's name/blurb and for the
//  DESIGN LANGUAGE block fed to the model. Custom designs (imported by the
//  user) carry the same header and are stored in AppSettings, not on disk.
//
//  This layer is deliberately settings-free (pure file IO + parsing) so
//  AppSettings.h can compose on top of it without a circular include.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include "WebAssets.h"
#include "StandardUi.h"

namespace vstai::designs
{
    struct DesignMeta
    {
        juce::String id, name, blurb, principles;
        // Optional chrome palette for the editor shell, so the whole app (header,
        // prompt, toolbar, tabs and every modal/dialog) re-skins to match the
        // selected design — not just the generated GUI. A plain key→value map of
        // shell CSS tokens (see ui/shell.css :root). Void when the design ships
        // no theme; the shell then keeps its built-in dark default.
        juce::var theme;
        bool builtin = true;
    };

    // The built-in schools, in display order. Each maps to ui/designs/<id>.html.
    inline juce::StringArray builtinIds()
    {
        return { "minimal", "modern-flagship", "skeuomorphic", "vintage-analog",
                 "neon-cyberpunk", "glassmorphism", "brutalist", "terminal-phosphor",
                 "color-pop", "bauhaus" };
    }

    inline bool isBuiltin (const juce::String& id) { return builtinIds().contains (id); }

    // Pull the leading <!--VSTAI-DESIGN … --> JSON header out of a kit document.
    // Falls back to sensible defaults (so a header-less file still works).
    inline DesignMeta parseMeta (const juce::String& html, const juce::String& fallbackId = {})
    {
        DesignMeta m;
        m.id = fallbackId;

        const auto open = html.indexOf ("<!--VSTAI-DESIGN");
        if (open >= 0)
        {
            const auto jStart = html.indexOf (open, "{");
            const auto close  = html.indexOf (open, "-->");
            if (jStart > open && close > jStart)
            {
                auto json = html.substring (jStart, close).trim();
                // Trim a trailing comment-body remnant if the JSON ran short.
                auto parsed = juce::JSON::parse (json);
                if (auto* o = parsed.getDynamicObject())
                {
                    auto get = [&] (const char* k, const juce::String& def)
                    {
                        auto v = o->getProperty (k);
                        return v.isVoid() ? def : v.toString();
                    };
                    m.id         = get ("id", m.id);
                    m.name       = get ("name", m.id);
                    m.blurb      = get ("blurb", {});
                    m.principles = get ("principles", {});
                    m.theme      = o->getProperty ("theme");   // void if absent
                    return m;
                }
            }
        }

        if (m.name.isEmpty()) m.name = m.id.isNotEmpty() ? m.id : juce::String ("Untitled");
        return m;
    }

    // The kit HTML for a built-in id: the on-disk file, else the baked minimal
    // kit as an ultimate fallback (e.g. an unsigned dev run with no Resources).
    inline juce::String builtinKitHtml (const juce::String& id)
    {
        auto html = vstai::webassets::readText ("designs/" + id + ".html");
        if (html.isNotEmpty()) return html;
        // Last resort: the compiled-in minimal kit (also used if the whole
        // designs/ folder is missing). Better a working GUI than a blank one.
        return juce::String (vstai::defaultStandardUiHtml());
    }

    inline DesignMeta builtinMeta (const juce::String& id)
    {
        auto m = parseMeta (builtinKitHtml (id), id);
        m.builtin = true;
        return m;
    }
}
