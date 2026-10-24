// preset_store_test.cpp
// =====================================================================
//  Headless checks for the sound browser's data layer (src/PresetStore.h) and the
//  host side of its URL protocol (src/PresetController.h): user sounds, favourites,
//  categories, tags, persistence, factory merge, apply/save through real URLs.
//
//    vstai_preset_test        (exit 0 = all passed)
// =====================================================================

#include "PresetController.h"
#include "PresetBrowserUi.h"
#include "Utf8.h"

#include <cmath>
#include <cstring>
#include <iostream>

using namespace vstai::presets;

static int failures = 0;
static bool near (double a, double b) { return std::abs (a - b) < 1.0e-6; }   // knobs are float-precision
#define CHECK(cond) do { if (! (cond)) { std::cerr << "FAIL line " << __LINE__ << ": " #cond "\n"; ++failures; } } while (0)

int main()
{
    const auto root = juce::File::getSpecialLocation (juce::File::tempDirectory)
                          .getChildFile ("vstai_preset_test_" + juce::String (juce::Time::currentTimeMillis()));
    root.createDirectory();

    // --- categories & inference ------------------------------------------------
    CHECK (builtinCategories (true).contains ("Bass") && builtinCategories (true).contains ("Pad"));
    CHECK (builtinCategories (false).contains ("Space") && ! builtinCategories (false).contains ("Bass"));
    CHECK (inferCategory ("Acid Bass 2", true) == "Bass");
    CHECK (inferCategory ("Warm Pad", true) == "Pad");
    CHECK (inferCategory ("FM Bell", true) == "Bells");
    CHECK (inferCategory ("Glass Harmonics", true) == "Bells");
    CHECK (inferCategory ("Soft Strings", true) == "Strings");
    CHECK (inferCategory ("Kick 909", true) == "Drums & Perc");
    CHECK (inferCategory ("Init", true) == "Other");
    CHECK (inferCategory ("Acid Bass", false) == "Other");          // effects never guess an instrument type
    CHECK (inferCategory ("Subtle Mood", true) == "Other");         // whole words only: "sub" is not inside "Subtle"

    // --- text and tag cleaning ---------------------------------------------------
    CHECK (cleanText ("  a \t b\n c  ") == "a b c");
    CHECK (cleanText (juce::String::repeatedString ("x", 100)).length() == kMaxTextLength);
    auto tags = cleanTags ({ " Warm ", "warm", "", "ANALOG", "x", "y", "z", "a1", "a2", "a3", "a4" });
    CHECK (tags[0] == "Warm" && tags[1] == "ANALOG");               // duplicate dropped case-insensitively
    CHECK (tags.size() == kMaxTags);

    CHECK (safeFolderName ("A/B:C") == "A_B_C");
    CHECK (safeFolderName ("..") == "Plugin" && safeFolderName ("") == "Plugin");

    // --- saving, overwriting, favourites ---------------------------------------
    Store s;
    s.open (root);
    CHECK (s.user().empty());
    const auto id1 = s.saveUser ("Warm Pad", "Pad", { "warm", "slow" }, { { 0, 0.25 }, { 3, 0.9 } });
    CHECK (id1.startsWith ("u:"));
    CHECK (s.saveUser ("   ", "Pad", {}, {}).isEmpty());             // a blank name is refused
    const auto id2 = s.saveUser ("Acid Bass", "Bass", {}, { { 0, 0.5 } });
    CHECK (id1 != id2 && s.user().size() == 2);
    CHECK (s.saveUser ("warm pad", "Keys", { "edited" }, { { 0, 0.75 } }) == id1);   // same name (any case) = update in place
    CHECK (s.user().size() == 2 && s.user()[0].category == "Keys" && s.user()[0].values.at (0) == 0.75);
    s.setFavorite (id2, true);
    CHECK (s.isFavorite (id2) && ! s.isFavorite (id1));

    // --- user categories ------------------------------------------------------
    CHECK (s.addCategory ("My Leads", true));
    CHECK (! s.addCategory ("my leads", true));                     // duplicate, case-insensitive
    CHECK (! s.addCategory ("Bass", true));                         // already built in
    CHECK (! s.addCategory ("   ", true));
    CHECK (s.updateMeta (id1, "Warm Pad", "My Leads", { "x" }));
    CHECK (! s.updateMeta (id1, "Acid Bass", "Pad", {}));           // would collide with another sound's name
    CHECK (s.user()[0].name == "Warm Pad");

    // --- persistence: a second Store on the same folder sees everything ---------------
    {
        Store r;
        r.open (root);
        CHECK (r.user().size() == 2);
        CHECK (r.user()[0].id == id1 && r.user()[0].category == "My Leads" && r.user()[0].tags.size() == 1);
        CHECK (r.user()[0].values.at (0) == 0.75);
        CHECK (r.isFavorite (id2));
        CHECK (r.getCategories().contains ("My Leads"));
    }

    // --- removing a category refiles its sounds; removing a sound drops its favourite -----
    CHECK (s.removeCategory ("my leads"));
    CHECK (s.user()[0].category == "Other");
    CHECK (! s.removeCategory ("Bass"));                            // built-ins can't be removed
    CHECK (s.removeUser (id2));
    CHECK (! s.isFavorite (id2) && s.user().size() == 1);
    CHECK (! s.removeUser ("u:does-not-exist"));

    // --- factory + user merge ----------------------------------------------------
    VstaiDocument doc;
    doc.isInstrument = true;
    VstaiPreset a; a.name = "Glass Keys"; a.values[0] = 0.1;
    VstaiPreset b; b.name = "Init";       b.category = "Lead"; b.tags = { "clean" };
    VstaiPreset c; c.name = "Init";                                   // a repeated name must still get its own id
    doc.presets = { a, b, c };
    s.setFavorite ("f:Init#2", true);
    const auto all = allEntries (doc, s);
    CHECK (all.size() == 4);
    CHECK (all[0].factory && all[0].id == "f:Glass Keys" && all[0].category == "Keys");    // inferred from "keys"
    CHECK (all[1].id == "f:Init" && all[1].category == "Lead" && all[1].tags[0] == "clean");
    CHECK (all[2].id == "f:Init#2" && all[2].favorite);
    CHECK (! all[3].factory && all[3].name == "Warm Pad");
    const auto json = juce::JSON::toString (browserJson (doc, s, all[1].id, "Test"));
    CHECK (json.contains ("\"current\": \"f:Init\"") && json.contains ("\"entries\""));
    CHECK (! json.contains ("\"values\""));                         // the UI never receives parameter values

    // --- a damaged or foreign file must not break the plugin ---------------------------
    root.getChildFile (Store::kFileName).replaceWithText ("{ not json");
    Store broken; broken.open (root);
    CHECK (broken.user().empty() && broken.getFavorites().isEmpty());
    root.getChildFile (Store::kFileName).replaceWithText ("{\"presets\":[{\"id\":\"zzz\",\"name\":\"x\"},{\"id\":\"u:1\",\"name\":\"\"},{\"id\":\"u:2\",\"name\":\"ok\"}]}");
    Store partial; partial.open (root);
    CHECK (partial.user().size() == 1 && partial.user()[0].name == "ok");   // bad ids / blank names are dropped

    root.deleteRecursively();

    // --- the baked browser script keeps its non-ASCII characters through the plugin's own decode ---
    // (juce::String (const char*) would read each UTF-8 byte as Latin-1 and the drawer would show
    //  "â\x80\xA6" for the ellipsis; BridgeShim.h decodes it with vstai::u8 for exactly that reason.)
    {
        const juce::String ui = vstai::u8 (vstai::shim::kPresetBrowserUi);
        CHECK (ui.containsChar (0x2605) && ui.containsChar (0x2026) && ui.containsChar (0x2039));   // star, ellipsis, arrow
        CHECK (! ui.containsChar (0x00E2));                                                      // no Latin-1 mojibake lead byte
        CHECK (ui.contains ("vstai-sound-browser") && ui.contains ("saveSound") && ui.trim().endsWith ("</script>"));
    }

    // =====================================================================
    //  The controller: the real /__vstai/presets/* protocol, driven with real URLs
    // =====================================================================
    // Like the JS side's encodeURIComponent (everything but A-Za-z0-9 -_.!~*'() is escaped).
    auto enc = [] (const juce::String& in)
    {
        juce::String out;
        for (auto* p = in.toRawUTF8(); *p; ++p)
        {
            const unsigned char c = (unsigned char) *p;
            if (juce::CharacterFunctions::isLetterOrDigit ((juce::juce_wchar) c) && c < 128 || std::strchr ("-_.!~*'()", c) != nullptr)
                out << juce::String::charToString ((juce::juce_wchar) c);
            else
                out << "%" << juce::String::toHexString ((int) c).paddedLeft ('0', 2).toUpperCase();
        }
        return out;
    };

    const juce::String vendor = "VstaiTest" + juce::String (juce::Time::currentTimeMillis());
    VstaiDocument cdoc;
    cdoc.name = "Chip Trio";
    cdoc.isInstrument = true;
    for (int i = 0; i < 3; ++i) { VstaiParam p; p.index = i; cdoc.params.push_back (p); }
    VstaiPreset f1; f1.name = "Glass Keys"; f1.values = { { 0, 0.1 }, { 1, 0.2 }, { 2, 0.3 } };
    cdoc.presets = { f1 };
    double knobs[64] = {};
    int setCalls = 0;
    int revealed = 0; juce::File revealedDir;
    auto make = [&] {
        return std::make_unique<Controller> (Controller::Hooks {
            [&]() -> const VstaiDocument& { return cdoc; },
            [&] { return vendor; },
            [&] (int i) { return (float) knobs[i]; },
            [&] (int i, float v) { knobs[i] = v; ++setCalls; },
            64,
            [&] (const juce::File& d) { ++revealed; revealedDir = d; } });
    };
    auto ctl = make();
    auto call = [&] (Controller& c, const juce::String& url)
    {
        auto r = c.handle (url);
        if (! r) return juce::var();
        return juce::JSON::parse (*r);
    };
    auto entryNames = [] (const juce::var& v)
    {
        juce::StringArray n;
        if (auto* a = v.getProperty ("entries", {}).getArray()) for (const auto& e : *a) n.add (e.getProperty ("name", {}).toString());
        return n;
    };

    CHECK (! ctl->handle ("/__vstai/param/1/0.5").has_value());          // not ours: left for the other routes
    CHECK (call (*ctl, "/__vstai/presets/bogus").getProperty ("error", {}).toString() == "Unknown request.");

    auto list = call (*ctl, "/__vstai/presets/list?_=123_0.5");           // cache-busting query is ignored
    CHECK (entryNames (list) == juce::StringArray ("Glass Keys"));
    CHECK ((bool) list.getProperty ("instrument", false) && list.getProperty ("product", {}).toString() == "Chip Trio");

    // "Show folder": the host is asked to reveal the per-user folder, which exists even before a first save
    CHECK ((bool) list.getProperty ("revealable", false) && list.getProperty ("where", {}).toString().isNotEmpty());
    CHECK (call (*ctl, "/__vstai/presets/reveal").getProperty ("error", {}).isVoid());
    CHECK (revealed == 1 && revealedDir == userDataFolder (vendor, "Chip Trio") && revealedDir.isDirectory());

    // load: a factory sound moves the knobs and becomes "current"
    list = call (*ctl, "/__vstai/presets/load/" + enc ("f:Glass Keys"));
    CHECK (near (knobs[0], 0.1) && near (knobs[2], 0.3) && setCalls == 3);
    CHECK (list.getProperty ("current", {}).toString() == "f:Glass Keys" && ctl->currentName() == "Glass Keys");
    CHECK (call (*ctl, "/__vstai/presets/load/" + enc ("u:nope")).getProperty ("error", {}).toString().isNotEmpty());

    // save: the CURRENT knob positions, under a name full of URL-hostile characters
    knobs[0] = 0.9; knobs[1] = 0.8; knobs[2] = 0.7;
    const juce::String hard = juce::String::fromUTF8 ("Caf\xC3\xA9 / 50% +bass & co");
    auto saved = call (*ctl, "/__vstai/presets/save/" + enc ("{\"name\":" + juce::JSON::toString (hard) + ",\"category\":\"Bass\",\"tags\":[\"warm\",\"Warm\",\"slow\"]}"));
    CHECK (saved.getProperty ("error", {}).isVoid() && saved.getProperty ("savedId", {}).toString().startsWith ("u:"));
    CHECK (entryNames (saved).contains (hard));
    const auto uid = saved.getProperty ("savedId", {}).toString();
    CHECK (saved.getProperty ("current", {}).toString() == uid);
    {   // the saved values are the knob positions at save time
        knobs[0] = knobs[1] = knobs[2] = 0.0;
        call (*ctl, "/__vstai/presets/load/" + enc (uid));
        CHECK (near (knobs[0], 0.9) && near (knobs[1], 0.8) && near (knobs[2], 0.7));
    }
    CHECK (call (*ctl, "/__vstai/presets/save/" + enc ("{\"name\":\"  \"}")).getProperty ("error", {}).toString() == "Give the sound a name.");

    // favourites, rename (and the duplicate-name guard), user categories
    auto fav = call (*ctl, "/__vstai/presets/fav/" + enc (uid) + "/1");
    bool isFav = false;
    for (const auto& e : *fav.getProperty ("entries", {}).getArray()) if (e.getProperty ("id", {}).toString() == uid) isFav = (bool) e.getProperty ("favorite", false);
    CHECK (isFav);
    call (*ctl, "/__vstai/presets/fav/" + enc ("f:Glass Keys") + "/1");                    // factory sounds can be starred too
    CHECK (call (*ctl, "/__vstai/presets/cat/add/" + enc ("My Leads")).getProperty ("error", {}).isVoid());
    CHECK (call (*ctl, "/__vstai/presets/cat/add/" + enc ("my leads")).getProperty ("error", {}).toString() == "That type already exists.");
    CHECK (call (*ctl, "/__vstai/presets/meta/" + enc ("{\"id\":\"" + uid + "\",\"name\":\"Warm Bass\",\"category\":\"My Leads\",\"tags\":[\"x\"]}")).getProperty ("error", {}).isVoid());
    CHECK (call (*ctl, "/__vstai/presets/meta/" + enc ("{\"id\":\"" + uid + "\",\"name\":\"Glass Keys\"}")).getProperty ("error", {}).isVoid());   // may share a name with a FACTORY sound
    CHECK (call (*ctl, "/__vstai/presets/cat/del/" + enc ("Bass")).getProperty ("error", {}).toString() == "Only your own types can be deleted.");

    // export bakes the user's sounds in, with their category and tags
    {
        const auto baked = ctl->userForExport();
        CHECK (baked.size() == 1 && baked[0].category == "My Leads" && baked[0].tags.size() == 1 && near (baked[0].values.at (1), 0.8));
    }

    // everything survived: a brand-new controller on the same product sees it (disk, not memory)
    {
        auto again = make();
        auto l2 = call (*again, "/__vstai/presets/list");
        CHECK (entryNames (l2).contains ("Glass Keys") && entryNames (l2).size() == 2);
        CHECK (l2.getProperty ("current", {}).toString().isEmpty());                         // "current" is per session
    }

    // a different plugin name is a different library; switching back finds the first again
    cdoc.name = "Other Synth";
    CHECK (entryNames (call (*ctl, "/__vstai/presets/list")) == juce::StringArray ("Glass Keys"));   // factory only, none of Chip Trio's
    cdoc.name = "Chip Trio";
    CHECK (entryNames (call (*ctl, "/__vstai/presets/list")).size() == 2);

    // delete: user sounds only
    CHECK (call (*ctl, "/__vstai/presets/delete/" + enc ("f:Glass Keys")).getProperty ("error", {}).toString().isNotEmpty());
    CHECK (call (*ctl, "/__vstai/presets/delete/" + enc (uid)).getProperty ("error", {}).isVoid());
    CHECK (entryNames (call (*ctl, "/__vstai/presets/list")) == juce::StringArray ("Glass Keys"));

    // nothing generated yet: there is no sound to save
    cdoc.params.clear();
    CHECK (call (*ctl, "/__vstai/presets/save/" + enc ("{\"name\":\"Empty\"}")).getProperty ("error", {}).toString().startsWith ("Nothing to save"));

    userDataFolder (vendor, "Chip Trio").getParentDirectory().deleteRecursively();

    if (failures == 0) std::cout << "preset store + controller: ALL PASSED\n";
    return failures == 0 ? 0 : 1;
}
