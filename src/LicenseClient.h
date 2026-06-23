// LicenseClient.h
// =====================================================================
//  Synchronous helpers for the VibePlugin license server (activate / validate /
//  deactivate a lifetime license key). Call from a background thread; the
//  License dialog marshals results back to the UI.
//
//  Endpoints (all POST, JSON in/out):
//    /license/activate    { key, email, machine_id, name } -> { ok, activation_id,
//                           email, activations_used, max_activations, error? }
//    /license/validate    { key, machine_id } -> { ok, valid, status, activations_used }
//    /license/deactivate  { key, machine_id } -> { ok }
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>

namespace vstai::license
{
    struct Response
    {
        bool        transportOk = false;   // did the HTTP call complete at all
        int         status      = 0;
        juce::var   json;

        bool ok() const { return transportOk && status >= 200 && status < 300
                              && json.isObject()
                              && (bool) json.getProperty ("ok", true); }

        juce::String error() const
        {
            if (json.isObject() && json.hasProperty ("error"))
                return json.getProperty ("error", {}).toString();
            if (! transportOk) return "could not reach the license server";
            return "license server error (HTTP " + juce::String (status) + ")";
        }
    };

    inline juce::String trimUrl (juce::String base)
    {
        while (base.endsWithChar ('/')) base = base.dropLastCharacters (1);
        return base;
    }

    inline Response post (const juce::String& base, const juce::String& path, const juce::var& body)
    {
        Response r;
        const juce::String payload = juce::JSON::toString (body, true);
        juce::URL url = juce::URL (trimUrl (base) + path).withPOSTData (payload);

        int status = 0;
        auto options = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
                           .withExtraHeaders ("content-type: application/json")
                           .withConnectionTimeoutMs (15000)
                           .withHttpRequestCmd ("POST")
                           .withStatusCode (&status);

        std::unique_ptr<juce::InputStream> stream (url.createInputStream (options));
        if (stream == nullptr) return r;     // transportOk stays false

        const juce::String text = stream->readEntireStreamAsString();
        r.transportOk = true;
        r.status      = status;
        r.json        = juce::JSON::parse (text);
        return r;
    }

    inline juce::var obj (std::initializer_list<std::pair<const char*, juce::var>> props)
    {
        auto* o = new juce::DynamicObject();
        for (auto& p : props) o->setProperty (p.first, p.second);
        return juce::var (o);
    }

    inline Response activate (const juce::String& base, const juce::String& key,
                              const juce::String& email, const juce::String& machineId,
                              const juce::String& name)
    {
        return post (base, "/license/activate", obj ({ { "key", key }, { "email", email },
                                                       { "machine_id", machineId }, { "name", name } }));
    }

    inline Response validate (const juce::String& base, const juce::String& key,
                              const juce::String& machineId)
    {
        return post (base, "/license/validate", obj ({ { "key", key }, { "machine_id", machineId } }));
    }

    inline Response deactivate (const juce::String& base, const juce::String& key,
                                const juce::String& machineId)
    {
        return post (base, "/license/deactivate", obj ({ { "key", key }, { "machine_id", machineId } }));
    }
}
