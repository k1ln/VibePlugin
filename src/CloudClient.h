// CloudClient.h
// =====================================================================
//  Synchronous helpers for the VibePlugin cloud account/auth endpoints
//  (device-code sign-in, account/credits, consent). Call from a background
//  thread; the editor's Account dialog marshals results back to the UI.
//  Generation goes through LlmClient (Provider::cloud), not here.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>

namespace vstai::cloud
{
    struct Response
    {
        bool      transportOk = false;   // could we reach the server at all?
        int       status      = 0;       // HTTP status
        juce::var json;                  // parsed body (object) or void
        bool ok() const { return transportOk && status >= 200 && status < 300; }
        juce::String error() const
        {
            if (! transportOk) return "could not reach the server";
            auto e = json.getProperty ("error", {}).toString();
            return e.isNotEmpty() ? e : ("HTTP " + juce::String (status));
        }
    };

    inline juce::String trimUrl (juce::String u)
    {
        while (u.endsWithChar ('/')) u = u.dropLastCharacters (1);
        return u;
    }

    inline Response send (const juce::String& method,
                          const juce::String& url,
                          const juce::String& token,
                          const juce::var& body)
    {
        juce::URL u (url);
        const bool hasBody = body.isObject();
        if (hasBody)
            u = u.withPOSTData (juce::JSON::toString (body));

        juce::String headers = "content-type: application/json";
        if (token.isNotEmpty())
            headers += "\r\nAuthorization: Bearer " + token;

        const auto handling = hasBody ? juce::URL::ParameterHandling::inPostData
                                      : juce::URL::ParameterHandling::inAddress;
        int status = 0;
        auto options = juce::URL::InputStreamOptions (handling)
                           .withExtraHeaders (headers)
                           .withConnectionTimeoutMs (15000)
                           .withHttpRequestCmd (method)
                           .withStatusCode (&status);

        Response r;
        std::unique_ptr<juce::InputStream> stream (u.createInputStream (options));
        if (stream == nullptr) return r;            // transportOk stays false
        r.transportOk = true;
        r.status = status;
        r.json = juce::JSON::parse (stream->readEntireStreamAsString());
        return r;
    }

    inline Response start (const juce::String& base, const juce::String& email)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("email", email);
        return send ("POST", trimUrl (base) + "/auth/start", {}, juce::var (o));
    }

    inline Response poll (const juce::String& base, const juce::String& deviceCode)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("device_code", deviceCode);
        return send ("POST", trimUrl (base) + "/auth/poll", {}, juce::var (o));
    }

    inline Response account (const juce::String& base, const juce::String& token)
    {
        return send ("GET", trimUrl (base) + "/v1/account", token, juce::var());
    }

    inline Response patchAccount (const juce::String& base, const juce::String& token, const juce::var& body)
    {
        return send ("PATCH", trimUrl (base) + "/v1/account", token, body);
    }
}
