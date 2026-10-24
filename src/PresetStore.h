// PresetStore.h
// =====================================================================
//  The data behind the in-plugin sound browser ("Pro browser").
//
//  Two kinds of sound are shown together:
//    * factory — the VstaiDocument's own presets (baked into an export, so every
//      customer of that product sees them); read-only for the user.
//    * user    — sounds the user saved with "Save current sound". These live in a
//      small JSON file in the user's application-data folder, per vendor/product,
//      NOT in the DAW session — so they and the favourites follow the user across
//      projects. Export bakes the user's sounds into the product as factory presets.
//
//  Each sound has a category (instrument type), free-form tags, and a favourite
//  flag. The user can also create their own categories. Everything here is
//  juce_core only, so it is unit-testable without a plugin or a window.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <initializer_list>
#include <map>
#include <vector>
#include "VstaiDocument.h"

namespace vstai::presets
{
    struct Entry
    {
        juce::String           id;          // "f:<name>" (factory) or "u:<uuid>" (user)
        juce::String           name;
        juce::String           category;
        juce::StringArray      tags;
        bool                   factory  = false;
        bool                   favorite = false;
        std::map<int, double>  values;
    };

    inline constexpr int kMaxTags       = 8;
    inline constexpr int kMaxTextLength = 40;

    // The instrument types offered out of the box. The user adds their own on top.
    inline juce::StringArray builtinCategories (bool instrument)
    {
        if (instrument)
            return { "Bass", "Lead", "Pad", "Keys", "Pluck", "Bells", "Strings", "Brass",
                     "Arp & Seq", "Drums & Perc", "FX", "Ambient", "Other" };
        return { "Clean", "Warm", "Dirty", "Space", "Modulation", "Dynamics", "Creative", "Other" };
    }

    inline juce::String cleanText (const juce::String& s, int maxLen = kMaxTextLength)
    {
        auto t = s.trim().replaceCharacters ("\r\n\t", "   ");
        while (t.contains ("  ")) t = t.replace ("  ", " ");
        return t.substring (0, maxLen).trim();
    }

    // Trim, drop empties, de-duplicate case-insensitively, cap the count.
    inline juce::StringArray cleanTags (const juce::StringArray& in)
    {
        juce::StringArray out;
        for (const auto& raw : in)
        {
            const auto t = cleanText (raw, 24);
            if (t.isNotEmpty() && ! out.contains (t, true) && out.size() < kMaxTags) out.add (t);
        }
        return out;
    }

    // Best-guess instrument type from a sound's name, so factory sounds that carry no
    // category still land in a sensible bucket. Matches whole words, case-insensitively.
    inline juce::String inferCategory (const juce::String& name, bool instrument)
    {
        if (! instrument) return "Other";
        struct Rule { const char* cat; std::initializer_list<const char*> words; };
        static const Rule rules[] =
        {
            { "Bass",         { "bass", "sub", "808", "reese", "wobble" } },
            { "Lead",         { "lead", "solo", "saw", "sync", "mono", "hoover" } },
            { "Pad",          { "pad", "warm", "drone", "wash", "choir", "voices" } },
            { "Keys",         { "keys", "piano", "organ", "rhodes", "ep", "clav", "wurli", "harpsichord" } },
            { "Pluck",        { "pluck", "stab", "pizz", "harp", "guitar", "kalimba", "marimba" } },
            { "Bells",        { "bell", "bells", "chime", "glass", "vibes", "mallet" } },
            { "Strings",      { "strings", "string", "violin", "cello", "ensemble" } },
            { "Brass",        { "brass", "horn", "horns", "trumpet", "sax", "trombone" } },
            { "Arp & Seq",    { "arp", "seq", "sequence", "pattern" } },
            { "Drums & Perc", { "kick", "snare", "hat", "hihat", "clap", "tom", "perc", "drum", "drums" } },
            { "FX",           { "fx", "riser", "noise", "sweep", "impact", "zap", "laser", "texture" } },
            { "Ambient",      { "ambient", "atmos", "atmosphere", "space", "dream", "evolving", "cinematic" } },
        };
        const auto words = juce::StringArray::fromTokens (
            name.toLowerCase().retainCharacters ("abcdefghijklmnopqrstuvwxyz0123456789 "), " ", "");
        for (const auto& r : rules)
            for (const char* w : r.words)
                if (words.contains (w)) return r.cat;
        return "Other";
    }

    // Folder names must survive every filesystem: replace the awkward characters.
    inline juce::String safeFolderName (const juce::String& s)
    {
        auto t = s.replaceCharacters ("/\\:*?\"<>|", "_________").trim();
        if (t.isEmpty() || t == "." || t == "..") t = "Plugin";
        return t.substring (0, 64);
    }

    // <app-data>/<vendor>/<product>/ — per user, outside the DAW session.
    inline juce::File userDataFolder (const juce::String& vendor, const juce::String& product)
    {
        auto base = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
       #if JUCE_MAC
        base = base.getChildFile ("Application Support");
       #endif
        return base.getChildFile (safeFolderName (vendor)).getChildFile (safeFolderName (product));
    }

    class Store
    {
    public:
        // Point the store at a folder (created on first save) and load presets.json if present.
        void open (const juce::File& folder)
        {
            dir = folder;
            userEntries.clear(); favorites.clear(); customCategories.clear();
            const auto f = dir.getChildFile (kFileName);
            if (! f.existsAsFile()) return;
            const auto root = juce::JSON::parse (f.loadFileAsString());
            auto* o = root.getDynamicObject();
            if (o == nullptr) return;
            if (auto* a = o->getProperty ("presets").getArray())
                for (const auto& pv : *a)
                    if (auto* po = pv.getDynamicObject())
                    {
                        Entry e;
                        e.id       = po->getProperty ("id").toString();
                        e.name     = cleanText (po->getProperty ("name").toString());
                        e.category = cleanText (po->getProperty ("category").toString());
                        if (auto* tv = po->getProperty ("tags").getArray())
                            for (const auto& t : *tv) e.tags.add (t.toString());
                        e.tags = cleanTags (e.tags);
                        if (auto* vo = po->getProperty ("values").getDynamicObject())
                            for (const auto& prop : vo->getProperties())
                                e.values[prop.name.toString().getIntValue()] = (double) prop.value;
                        if (e.id.startsWith ("u:") && e.name.isNotEmpty()) userEntries.push_back (std::move (e));
                    }
            if (auto* a = o->getProperty ("favorites").getArray())
                for (const auto& v : *a) favorites.addIfNotAlreadyThere (v.toString());
            if (auto* a = o->getProperty ("categories").getArray())
                for (const auto& v : *a)
                {
                    const auto c = cleanText (v.toString(), 24);
                    if (c.isNotEmpty()) customCategories.addIfNotAlreadyThere (c, true);
                }
        }

        const std::vector<Entry>& user() const            { return userEntries; }
        const juce::StringArray&  getFavorites() const    { return favorites; }
        const juce::StringArray&  getCategories() const   { return customCategories; }
        const juce::File&         folder() const          { return dir; }
        bool isFavorite (const juce::String& id) const    { return favorites.contains (id); }

        // Save the given values as a user sound. A user sound with the same name is
        // replaced (keeping its id and favourite), so "save" twice updates, not duplicates.
        juce::String saveUser (const juce::String& nameIn, const juce::String& category,
                               const juce::StringArray& tags, const std::map<int, double>& values)
        {
            const auto name = cleanText (nameIn);
            if (name.isEmpty()) return {};
            for (auto& e : userEntries)
                if (e.name.equalsIgnoreCase (name))
                {
                    e.name = name; e.category = cleanText (category); e.tags = cleanTags (tags); e.values = values;
                    flush();
                    return e.id;
                }
            Entry e;
            e.id = "u:" + juce::Uuid().toDashedString();
            e.name = name; e.category = cleanText (category); e.tags = cleanTags (tags); e.values = values;
            userEntries.push_back (std::move (e));
            const auto id = userEntries.back().id;
            flush();
            return id;
        }

        bool updateMeta (const juce::String& id, const juce::String& nameIn,
                         const juce::String& category, const juce::StringArray& tags)
        {
            for (auto& e : userEntries)
                if (e.id == id)
                {
                    const auto name = cleanText (nameIn);
                    if (name.isNotEmpty())
                    {
                        for (const auto& other : userEntries)     // no two user sounds share a name
                            if (other.id != id && other.name.equalsIgnoreCase (name)) return false;
                        e.name = name;
                    }
                    e.category = cleanText (category); e.tags = cleanTags (tags);
                    flush();
                    return true;
                }
            return false;
        }

        bool removeUser (const juce::String& id)
        {
            for (size_t i = 0; i < userEntries.size(); ++i)
                if (userEntries[i].id == id)
                {
                    userEntries.erase (userEntries.begin() + (std::ptrdiff_t) i);
                    favorites.removeString (id);
                    flush();
                    return true;
                }
            return false;
        }

        void setFavorite (const juce::String& id, bool on)
        {
            if (on) favorites.addIfNotAlreadyThere (id); else favorites.removeString (id);
            flush();
        }

        bool addCategory (const juce::String& nameIn, bool instrument)
        {
            const auto name = cleanText (nameIn, 24);
            if (name.isEmpty() || customCategories.contains (name, true) || builtinCategories (instrument).contains (name, true))
                return false;
            customCategories.add (name);
            flush();
            return true;
        }

        // Removes a user-created category; sounds filed under it fall back to "Other".
        bool removeCategory (const juce::String& name)
        {
            const int idx = customCategories.indexOf (name, true);
            if (idx < 0) return false;
            customCategories.remove (idx);
            for (auto& e : userEntries) if (e.category.equalsIgnoreCase (name)) e.category = "Other";
            flush();
            return true;
        }

        bool flush() const
        {
            if (! dir.exists() && ! dir.createDirectory()) return false;
            auto* root = new juce::DynamicObject();
            root->setProperty ("version", 1);
            juce::Array<juce::var> presets;
            for (const auto& e : userEntries)
            {
                auto* po = new juce::DynamicObject();
                po->setProperty ("id", e.id); po->setProperty ("name", e.name); po->setProperty ("category", e.category);
                juce::Array<juce::var> tv; for (const auto& t : e.tags) tv.add (t);
                po->setProperty ("tags", tv);
                auto* vo = new juce::DynamicObject();
                for (const auto& kv : e.values) vo->setProperty (juce::String (kv.first), kv.second);
                po->setProperty ("values", juce::var (vo));
                presets.add (juce::var (po));
            }
            root->setProperty ("presets", presets);
            juce::Array<juce::var> fav; for (const auto& f : favorites) fav.add (f);
            root->setProperty ("favorites", fav);
            juce::Array<juce::var> cats; for (const auto& c : customCategories) cats.add (c);
            root->setProperty ("categories", cats);
            // Write through a temp file so a crash mid-write can't leave half a library.
            const auto target = dir.getChildFile (kFileName);
            juce::TemporaryFile tmp (target);
            return tmp.getFile().replaceWithText (juce::JSON::toString (juce::var (root)), false, false, "\n")
                   && tmp.overwriteTargetFileWithTemporary();
        }

        static constexpr const char* kFileName = "presets.json";

    private:
        juce::File           dir;
        std::vector<Entry>   userEntries;
        juce::StringArray    favorites;
        juce::StringArray    customCategories;
    };

    // Factory sounds (the document's) first, then the user's — each with category, tags
    // and favourite resolved. Factory ids are "f:<name>", with "#2", "#3"... on a repeat.
    inline std::vector<Entry> allEntries (const VstaiDocument& doc, const Store& store)
    {
        std::vector<Entry> out;
        juce::StringArray seen;
        for (const auto& p : doc.presets)
        {
            Entry e;
            e.factory  = true;
            e.name     = p.name.isNotEmpty() ? p.name : ("Preset " + juce::String ((int) out.size() + 1));
            e.category = p.category.isNotEmpty() ? p.category : inferCategory (e.name, doc.isInstrument);
            e.tags     = cleanTags (p.tags);
            e.values   = p.values;
            auto id = "f:" + e.name;
            for (int n = 2; seen.contains (id); ++n) id = "f:" + e.name + "#" + juce::String (n);
            seen.add (id);
            e.id = id;
            e.favorite = store.isFavorite (e.id);
            out.push_back (std::move (e));
        }
        for (const auto& u : store.user())
        {
            Entry e = u;
            if (e.category.isEmpty()) e.category = inferCategory (e.name, doc.isInstrument);
            e.favorite = store.isFavorite (e.id);
            out.push_back (std::move (e));
        }
        return out;
    }

    // What the browser UI renders. No values: the UI never needs them.
    inline juce::var browserJson (const VstaiDocument& doc, const Store& store,
                                  const juce::String& currentId, const juce::String& productName)
    {
        const auto entries = allEntries (doc, store);

        juce::Array<juce::var> cats;
        juce::StringArray listed;
        auto addCat = [&] (const juce::String& n, bool custom)
        {
            auto* c = new juce::DynamicObject();
            c->setProperty ("name", n); c->setProperty ("custom", custom);
            cats.add (juce::var (c));
            listed.add (n);
        };
        for (const auto& c : builtinCategories (doc.isInstrument)) addCat (c, false);
        for (const auto& c : store.getCategories()) if (! listed.contains (c, true)) addCat (c, true);
        for (const auto& e : entries)       // a category carried by a baked factory sound
            if (e.category.isNotEmpty() && ! listed.contains (e.category, true)) addCat (e.category, false);

        juce::Array<juce::var> list;
        for (const auto& e : entries)
        {
            auto* o = new juce::DynamicObject();
            o->setProperty ("id", e.id); o->setProperty ("name", e.name); o->setProperty ("category", e.category);
            juce::Array<juce::var> tv; for (const auto& t : e.tags) tv.add (t);
            o->setProperty ("tags", tv);
            o->setProperty ("factory", e.factory); o->setProperty ("favorite", e.favorite);
            list.add (juce::var (o));
        }

        auto* root = new juce::DynamicObject();
        root->setProperty ("product", productName);
        root->setProperty ("instrument", doc.isInstrument);
        root->setProperty ("current", currentId);
        root->setProperty ("categories", cats);
        root->setProperty ("entries", list);
        return juce::var (root);
    }
}
