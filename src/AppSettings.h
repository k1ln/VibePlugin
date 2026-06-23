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

    // The user's edited standard component kit, or the baked-in default. Used as
    // the starter GUI, the build-prompt house style, and the Standard UI tab seed.
    inline juce::String standardUi()
    {
        auto v = rawStandardUi();
        return v.isNotEmpty() ? v : juce::String (vstai::defaultStandardUiHtml());
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
