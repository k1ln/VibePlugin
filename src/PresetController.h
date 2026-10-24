// PresetController.h
// =====================================================================
//  Everything the sound browser asks of the host, in one juce_core-only class so it
//  can be tested without a plugin or a window: apply a sound, save the current knob
//  positions, favourites, user categories, and the /__vstai/presets/* URL protocol
//  the in-GUI browser (ui/preset-browser.js) speaks.
//
//  The processor owns one and hands it four things: the document, the vendor name
//  (for the per-user data folder), and get/set for a parameter's 0..1 value.
//
//  Thread-safe: the WebView bridge calls in from a non-message thread.
//
//      /__vstai/presets/list              /__vstai/presets/reveal   (show the sounds folder)
//      /__vstai/presets/load/<id>          /__vstai/presets/delete/<id>
//      /__vstai/presets/fav/<id>/<0|1>
//      /__vstai/presets/save/<json {name,category,tags[]}>
//      /__vstai/presets/meta/<json {id,name,category,tags[]}>
//      /__vstai/presets/cat/add/<name>     /__vstai/presets/cat/del/<name>
//
//  Arguments are percent-encoded in the path. Every reply is the refreshed browser
//  list as JSON, plus "error" (and "savedId") when relevant.
// =====================================================================

#pragma once

#include <functional>
#include <memory>
#include <optional>
#include "PresetStore.h"

namespace vstai::presets
{
    class Controller
    {
    public:
        struct Hooks
        {
            std::function<const VstaiDocument&()> document;    // the loaded creation
            std::function<juce::String()>         vendor;      // folder the user's sounds live under
            std::function<float (int)>            getParam;    // current knob position, 0..1
            std::function<void (int, float)>      setParam;    // move a knob (host, engine and GUI all follow)
            int                                   maxParams = 64;
            std::function<void (const juce::File&)> reveal;    // optional: show the user's sounds folder in the OS file manager
        };

        explicit Controller (Hooks h) : hooks (std::move (h)) {}

        // ---- what the browser shows -------------------------------------------------
        juce::var browserVar()
        {
            const juce::ScopedLock sl (lock);
            const auto& doc = hooks.document();
            auto v = browserJson (doc, store (doc), currentId, doc.name);
            if (auto* o = v.getDynamicObject())
            {
                o->setProperty ("revealable", (bool) hooks.reveal);                  // the UI shows "Show folder" only when this host can
                o->setProperty ("where", store (doc).folder().getFullPathName());    // where presets.json lives (shown as a tooltip)
            }
            return v;
        }

        juce::String currentName()
        {
            const juce::ScopedLock sl (lock);
            if (currentId.isEmpty()) return {};
            const auto& doc = hooks.document();
            for (const auto& e : allEntries (doc, store (doc)))
                if (e.id == currentId) return e.name;
            return {};
        }

        // ---- actions ---------------------------------------------------------------
        bool applyById (const juce::String& id)
        {
            std::map<int, double> values;
            {
                const juce::ScopedLock sl (lock);
                const auto& doc = hooks.document();
                bool found = false;
                for (const auto& e : allEntries (doc, store (doc)))
                    if (e.id == id) { values = e.values; found = true; break; }
                if (! found) return false;
                currentId = id;
            }
            for (const auto& kv : values)                       // outside the lock: this fans out to the host
                if (kv.first >= 0 && kv.first < hooks.maxParams)
                    hooks.setParam (kv.first, (float) kv.second);
            return true;
        }

        // Saves the knobs as they are right now. Returns the new id, or empty if there is
        // nothing to save (no plugin generated yet) or the name is blank.
        juce::String saveCurrent (const juce::String& name, const juce::String& category, const juce::StringArray& tags)
        {
            const juce::ScopedLock sl (lock);
            const auto& doc = hooks.document();
            std::map<int, double> values;
            for (const auto& p : doc.params)
                if (p.index >= 0 && p.index < hooks.maxParams)
                    values[p.index] = (double) hooks.getParam (p.index);
            if (values.empty()) return {};
            const auto id = store (doc).saveUser (name, category, tags, values);
            if (id.isNotEmpty()) currentId = id;
            return id;
        }

        bool updateMeta (const juce::String& id, const juce::String& name, const juce::String& category, const juce::StringArray& tags)
        { const juce::ScopedLock sl (lock); return store (hooks.document()).updateMeta (id, name, category, tags); }

        bool deleteUser (const juce::String& id)
        {
            const juce::ScopedLock sl (lock);
            const bool ok = store (hooks.document()).removeUser (id);
            if (ok && currentId == id) currentId.clear();
            return ok;
        }

        void setFavorite (const juce::String& id, bool on)
        { const juce::ScopedLock sl (lock); store (hooks.document()).setFavorite (id, on); }

        bool addCategory (const juce::String& name)
        { const juce::ScopedLock sl (lock); const auto& d = hooks.document(); return store (d).addCategory (name, d.isInstrument); }

        bool removeCategory (const juce::String& name)
        { const juce::ScopedLock sl (lock); return store (hooks.document()).removeCategory (name); }

        // The user's sounds as VstaiPresets: Export bakes these into the product, so they
        // become its factory sounds for every customer.
        std::vector<VstaiPreset> userForExport()
        {
            const juce::ScopedLock sl (lock);
            const auto& doc = hooks.document();
            std::vector<VstaiPreset> out;
            for (const auto& u : store (doc).user())
            {
                VstaiPreset p;
                p.name     = u.name;
                p.category = u.category.isNotEmpty() ? u.category : inferCategory (u.name, doc.isInstrument);
                p.tags     = u.tags;
                p.values   = u.values;
                out.push_back (std::move (p));
            }
            return out;
        }

        // ---- the URL protocol -------------------------------------------------------
        // Returns the JSON reply, or nullopt if `url` is not a /__vstai/presets/ call.
        std::optional<juce::String> handle (const juce::String& url)
        {
            if (! url.startsWith ("/__vstai/presets/")) return std::nullopt;
            const juce::String cmd = url.fromFirstOccurrenceOf ("/__vstai/presets/", false, false)
                                        .upToFirstOccurrenceOf ("?", false, false);
            auto arg = [&cmd] (const juce::String& prefix)
            { return juce::URL::removeEscapeChars (cmd.fromFirstOccurrenceOf (prefix, false, false)); };

            if (cmd == "list")                 return reply();
            if (cmd == "reveal")
            {
                juce::File dir;
                { const juce::ScopedLock sl (lock); dir = store (hooks.document()).folder(); }
                if (! hooks.reveal) return reply ("This host cannot open the folder.");
                dir.createDirectory();                              // exists even before the first save
                hooks.reveal (dir);
                return reply();
            }
            if (cmd.startsWith ("load/"))      return applyById (arg ("load/")) ? reply() : reply ("That sound no longer exists.");
            if (cmd.startsWith ("delete/"))    return deleteUser (arg ("delete/")) ? reply() : reply ("Only your own sounds can be deleted.");
            if (cmd.startsWith ("fav/"))
            {
                const auto rest = cmd.fromFirstOccurrenceOf ("fav/", false, false);
                setFavorite (juce::URL::removeEscapeChars (rest.upToLastOccurrenceOf ("/", false, false)),
                             rest.fromLastOccurrenceOf ("/", false, false) == "1");
                return reply();
            }
            if (cmd.startsWith ("save/"))
            {
                const auto o = juce::JSON::parse (arg ("save/"));
                const auto name = cleanText (o.getProperty ("name", {}).toString());
                if (name.isEmpty()) return reply ("Give the sound a name.");
                const auto id = saveCurrent (name, o.getProperty ("category", {}).toString(), tagsOf (o.getProperty ("tags", {})));
                return id.isEmpty() ? reply ("Nothing to save yet: generate a plugin first.") : reply ({}, id);
            }
            if (cmd.startsWith ("meta/"))
            {
                // A field the request leaves out stays as it is (only what is sent changes).
                const auto o = juce::JSON::parse (arg ("meta/"));
                const auto id = o.getProperty ("id", {}).toString();
                Entry cur;
                {
                    const juce::ScopedLock sl (lock);
                    for (const auto& u : store (hooks.document()).user()) if (u.id == id) cur = u;
                }
                const bool hasName = o.hasProperty ("name"), hasCat = o.hasProperty ("category"), hasTags = o.hasProperty ("tags");
                return updateMeta (id, hasName ? o.getProperty ("name", {}).toString() : cur.name,
                                   hasCat ? o.getProperty ("category", {}).toString() : cur.category,
                                   hasTags ? tagsOf (o.getProperty ("tags", {})) : cur.tags)
                           ? reply() : reply ("Another sound already has that name.");
            }
            if (cmd.startsWith ("cat/add/"))   return addCategory (arg ("cat/add/")) ? reply() : reply ("That type already exists.");
            if (cmd.startsWith ("cat/del/"))   return removeCategory (arg ("cat/del/")) ? reply() : reply ("Only your own types can be deleted.");
            return reply ("Unknown request.");
        }

    private:
        static juce::StringArray tagsOf (const juce::var& v)
        {
            juce::StringArray out;
            if (auto* a = v.getArray()) for (const auto& t : *a) out.add (t.toString());
            return out;
        }

        juce::String reply (const juce::String& error = {}, const juce::String& savedId = {})
        {
            auto v = browserVar();
            if (auto* o = v.getDynamicObject())
            {
                if (error.isNotEmpty())   o->setProperty ("error", error);
                if (savedId.isNotEmpty()) o->setProperty ("savedId", savedId);
            }
            return juce::JSON::toString (v, true);
        }

        // The store follows the document: a different vendor or plugin name opens that
        // product's folder (and forgets which sound was current). Lock must be held.
        Store& store (const VstaiDocument& doc)
        {
            const auto vendor = hooks.vendor();
            const auto key = vendor + "|" + doc.name;
            if (store_ == nullptr || key != storeKey)
            {
                store_ = std::make_unique<Store>();
                store_->open (userDataFolder (vendor, doc.name));
                storeKey = key;
                currentId.clear();
            }
            return *store_;
        }

        Hooks                  hooks;
        juce::CriticalSection  lock;
        std::unique_ptr<Store> store_;
        juce::String           storeKey, currentId;
    };
}
