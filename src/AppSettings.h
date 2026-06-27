// AppSettings.h
// =====================================================================
//  User-editable settings that persist across sessions, stored in a small
//  properties file in the user's app-data folder (written from the plugin's
//  "Keys…" dialog). These are runtime overrides on top of the compiled-in
//  Config.h / environment fallbacks in Settings.h:
//
//      dialog value  ->  Config.h  ->  environment variable
//
//  Keys are stored in clear text in this file (same trust model as a baked-in
//  Config.h key). Only the message thread touches it; build worker threads read
//  a snapshot taken before they start.
// =====================================================================

#pragma once

#include <juce_data_structures/juce_data_structures.h>
#include "Settings.h"
#include "StandardUi.h"
#include "Designs.h"

namespace vstai::appsettings
{
    inline juce::PropertiesFile& file()
    {
        static juce::PropertiesFile instance ([]
        {
            juce::PropertiesFile::Options o;
            o.applicationName     = "VibePlugin";
            o.filenameSuffix      = "settings";
            o.folderName          = "VibePlugin";
            o.osxLibrarySubFolder = "Application Support";
            return o;
        }());
        return instance;
    }

    // ---- raw stored overrides (empty == "fall back to Config.h/env") --------
    inline juce::String rawAnthropicKey() { return file().getValue ("anthropicApiKey"); }
    inline juce::String rawOllamaUrl()    { return file().getValue ("ollamaBaseUrl"); }
    inline juce::String rawGlmKey()       { return file().getValue ("glmApiKey"); }
    inline juce::String rawGlmUrl()       { return file().getValue ("glmBaseUrl"); }
    inline juce::String rawStandardUi()   { return file().getValue ("standardUi"); }
    inline juce::String publishUrl()      { return file().getValue ("publishUrl"); }

    inline void setPublishUrl   (const juce::String& v) { file().setValue ("publishUrl", v); file().saveIfNeeded(); }
    inline void setAnthropicKey (const juce::String& v) { file().setValue ("anthropicApiKey", v); file().saveIfNeeded(); }
    inline void setOllamaUrl    (const juce::String& v) { file().setValue ("ollamaBaseUrl",   v); file().saveIfNeeded(); }
    inline void setGlmKey       (const juce::String& v) { file().setValue ("glmApiKey",       v); file().saveIfNeeded(); }
    inline void setGlmUrl       (const juce::String& v) { file().setValue ("glmBaseUrl",       v); file().saveIfNeeded(); }
    inline void setStandardUi   (const juce::String& v) { file().setValue ("standardUi",       v); file().saveIfNeeded(); }
    inline void resetStandardUi ()                      { file().removeValue ("standardUi");      file().saveIfNeeded(); }

    // ---- resolved values (override, else Config.h/env) ----------------------
    inline juce::String anthropicKey()
    {
        auto v = rawAnthropicKey();
        return v.isNotEmpty() ? v : vstai::settings::apiKey();
    }

    inline juce::String ollamaBaseUrl()
    {
        auto v = rawOllamaUrl();
        return v.isNotEmpty() ? v : vstai::settings::ollamaBaseUrl();
    }

    inline juce::String glmKey()
    {
        auto v = rawGlmKey();
        return v.isNotEmpty() ? v : vstai::settings::glmApiKey();
    }

    inline juce::String glmBaseUrl()
    {
        auto v = rawGlmUrl();
        return v.isNotEmpty() ? v : vstai::settings::glmBaseUrl();
    }

    // ===== Design schools ===================================================
    //  The selected design provides the default component kit + the design
    //  language fed to the prompt. Built-in designs load from ui/designs/;
    //  imported "custom" designs are stored here as JSON (they have no file).

    inline juce::String selectedDesignId()
    {
        auto v = file().getValue ("designId");
        return v.isNotEmpty() ? v : juce::String ("minimal");
    }

    inline juce::Array<juce::var> customDesignArray()
    {
        auto parsed = juce::JSON::parse (file().getValue ("customDesigns"));
        if (auto* a = parsed.getArray()) return *a;
        return {};
    }

    inline juce::var findCustomDesign (const juce::String& id)
    {
        for (auto& v : customDesignArray())
            if (auto* o = v.getDynamicObject())
                if (o->getProperty ("id").toString() == id)
                    return v;
        return {};
    }

    // Kit HTML for any design id: a custom design's stored HTML, else the
    // built-in on-disk file (or baked minimal fallback).
    inline juce::String designKitHtml (const juce::String& id)
    {
        auto c = findCustomDesign (id);
        if (auto* o = c.getDynamicObject())
            return o->getProperty ("html").toString();
        return vstai::designs::builtinKitHtml (id);
    }

    inline vstai::designs::DesignMeta designMeta (const juce::String& id)
    {
        auto c = findCustomDesign (id);
        if (auto* o = c.getDynamicObject())
        {
            vstai::designs::DesignMeta m;
            m.id = id; m.builtin = false;
            m.name       = o->getProperty ("name").toString();
            m.blurb      = o->getProperty ("blurb").toString();
            m.principles = o->getProperty ("principles").toString();
            // The chrome palette lives only in the kit's header — pull it from the
            // stored HTML so imported designs re-skin the shell like built-ins do.
            m.theme      = vstai::designs::parseMeta (o->getProperty ("html").toString(), id).theme;
            if (m.name.isEmpty()) m.name = id;
            return m;
        }
        return vstai::designs::builtinMeta (id);
    }

    inline juce::String selectedDesignKitHtml()    { return designKitHtml (selectedDesignId()); }
    inline juce::String selectedDesignPrinciples() { return designMeta   (selectedDesignId()).principles; }
    inline juce::String selectedDesignName()       { return designMeta   (selectedDesignId()).name; }

    // Switching design clears any manual Standard-UI override so the chosen
    // design actually takes effect as the starter GUI / house style.
    inline void setSelectedDesignId (const juce::String& id)
    {
        file().setValue ("designId", id);
        file().removeValue ("standardUi");
        file().saveIfNeeded();
    }

    inline void upsertCustomDesign (const vstai::designs::DesignMeta& m, const juce::String& html)
    {
        juce::Array<juce::var> arr = customDesignArray();
        for (int i = arr.size(); --i >= 0;)
            if (auto* o = arr[i].getDynamicObject())
                if (o->getProperty ("id").toString() == m.id) arr.remove (i);
        auto* o = new juce::DynamicObject();
        o->setProperty ("id", m.id);
        o->setProperty ("name", m.name);
        o->setProperty ("blurb", m.blurb);
        o->setProperty ("principles", m.principles);
        o->setProperty ("html", html);
        arr.add (juce::var (o));
        file().setValue ("customDesigns", juce::JSON::toString (juce::var (arr)));
        file().saveIfNeeded();
    }

    inline void removeCustomDesign (const juce::String& id)
    {
        juce::Array<juce::var> arr = customDesignArray();
        for (int i = arr.size(); --i >= 0;)
            if (auto* o = arr[i].getDynamicObject())
                if (o->getProperty ("id").toString() == id) arr.remove (i);
        file().setValue ("customDesigns", juce::JSON::toString (juce::var (arr)));
        if (selectedDesignId() == id) setSelectedDesignId ("minimal");
        file().saveIfNeeded();
    }

    // The user's edited standard component kit, or — failing that — the selected
    // design's kit. Used as the starter GUI, the build-prompt house style, and
    // the Standard UI tab seed.
    inline juce::String standardUi()
    {
        auto v = rawStandardUi();
        return v.isNotEmpty() ? v : selectedDesignKitHtml();
    }

    // Which editor chrome to use: the new WebView shell (default) or the legacy
    // native JUCE editor (fallback). Toggle while the shell is reaching parity.
    inline bool useWebShell()           { return file().getBoolValue ("useWebShell", true); }
    inline void setUseWebShell (bool b) { file().setValue ("useWebShell", b); file().saveIfNeeded(); }

    // ---- VibePlugin Cloud credits (signed in via the Account… dialog) ----------
    inline juce::String cloudBaseUrl()
    {
        auto v = file().getValue ("cloudBaseUrl");
        return v.isNotEmpty() ? v : vstai::settings::cloudBaseUrl();
    }
    inline juce::String cloudCheckoutUrl() { return vstai::settings::cloudCheckoutUrl(); }

    inline juce::String cloudToken() { return file().getValue ("cloudToken"); }
    inline juce::String cloudEmail() { return file().getValue ("cloudEmail"); }
    inline bool isSignedIn()         { return cloudToken().isNotEmpty(); }

    inline void signIn (const juce::String& token, const juce::String& email)
    {
        file().setValue ("cloudToken", token);
        file().setValue ("cloudEmail", email);
        file().saveIfNeeded();
    }
    inline void signOut()
    {
        file().removeValue ("cloudToken");
        file().removeValue ("cloudEmail");
        file().saveIfNeeded();
    }

    // ---- Lifetime license (shareware: removes the friendly nag) -------------
    inline juce::String licenseServerUrl()
    {
        auto v = file().getValue ("licenseServerUrl");
        return v.isNotEmpty() ? v : vstai::settings::licenseServerUrl();
    }
    inline juce::String licenseCheckoutUrl() { return vstai::settings::licenseCheckoutUrl(); }

    // A stable per-install identifier, generated once. Each distinct id counts
    // as one activation on the server (max 5; the oldest is invalidated past 5).
    inline juce::String machineId()
    {
        auto v = file().getValue ("machineId");
        if (v.isEmpty())
        {
            v = juce::Uuid().toDashedString();
            file().setValue ("machineId", v);
            file().saveIfNeeded();
        }
        return v;
    }

    inline juce::String licenseKey()          { return file().getValue ("licenseKey"); }
    inline juce::String licenseEmail()        { return file().getValue ("licenseEmail"); }
    inline juce::String licenseActivationId() { return file().getValue ("licenseActivationId"); }

    // Licensed == we hold a key that the server confirmed at least once. Network
    // failures never flip this off (fail-open); only an explicit server "invalid".
    inline bool isLicensed() { return file().getBoolValue ("licensed", false) && licenseKey().isNotEmpty(); }

    inline void setLicense (const juce::String& key, const juce::String& email,
                            const juce::String& activationId)
    {
        file().setValue ("licenseKey", key);
        file().setValue ("licenseEmail", email);
        file().setValue ("licenseActivationId", activationId);
        file().setValue ("licensed", true);
        file().saveIfNeeded();
    }
    inline void clearLicense()
    {
        file().removeValue ("licenseKey");
        file().removeValue ("licenseEmail");
        file().removeValue ("licenseActivationId");
        file().removeValue ("licensed");
        file().saveIfNeeded();
    }
}
