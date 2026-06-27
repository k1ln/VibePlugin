// LlmClient.cpp
#include "LlmClient.h"
#include "Prompt.h"
#include "DevLog.h"

namespace
{
    // GET/POST a URL and return the body, or {} on transport failure.
    juce::String httpRequest (const juce::URL& url,
                              const juce::String& headers,
                              bool isPost,
                              int& statusCode,
                              int timeoutMs)
    {
        auto handling = isPost ? juce::URL::ParameterHandling::inPostData
                               : juce::URL::ParameterHandling::inAddress;
        auto options = juce::URL::InputStreamOptions (handling)
                           .withExtraHeaders (headers)
                           .withConnectionTimeoutMs (timeoutMs)
                           .withHttpRequestCmd (isPost ? "POST" : "GET")
                           .withStatusCode (&statusCode);

        std::unique_ptr<juce::InputStream> stream (url.createInputStream (options));
        if (stream == nullptr) return {};
        return stream->readEntireStreamAsString();
    }

    // POST a streaming (SSE) request, feeding each parsed `data:` JSON object to
    // onData as it arrives. Returns false only on transport failure (the stream
    // could not be opened). A non-2xx response is not SSE — its single JSON error
    // body is returned via errorBody instead.
    bool httpStreamSse (const juce::URL& url,
                        const juce::String& headers,
                        int& statusCode,
                        int timeoutMs,
                        const std::function<void (const juce::var&)>& onData,
                        juce::String& errorBody)
    {
        auto options = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
                           .withExtraHeaders (headers)
                           .withConnectionTimeoutMs (timeoutMs)
                           .withHttpRequestCmd ("POST")
                           .withStatusCode (&statusCode);

        std::unique_ptr<juce::InputStream> stream (url.createInputStream (options));
        if (stream == nullptr) return false;

        if (statusCode < 200 || statusCode >= 300)
        {
            errorBody = stream->readEntireStreamAsString();
            return true;
        }

        while (! stream->isExhausted())
        {
            const juce::String line = stream->readNextLine();
            if (! line.startsWith ("data:")) continue;   // skip event:/ping/blank framing
            const juce::String data = line.fromFirstOccurrenceOf ("data:", false, false).trim();
            // OpenAI-style streams (GLM/Ollama) send a literal "[DONE]" sentinel and
            // may keep the socket open afterwards — stop now instead of blocking in
            // readNextLine until the timeout. (Anthropic doesn't send this; it closes.)
            if (data == "[DONE]") break;
            if (data.isNotEmpty())
            {
                const juce::var ev = juce::JSON::parse (data);
                if (ev.isObject()) onData (ev);
            }
        }
        return true;
    }

    // OpenAI-style providers sometimes wrap the JSON in prose or ```json fences,
    // even in JSON mode. Pull out the outermost {...} object and parse it.
    juce::var parseLooseJson (const juce::String& text)
    {
        auto v = juce::JSON::parse (text);
        if (v.isObject()) return v;

        const int first = text.indexOfChar ('{');
        const int last  = text.lastIndexOfChar ('}');
        if (first >= 0 && last > first)
            return juce::JSON::parse (text.substring (first, last + 1));
        return {};
    }

    juce::var makeObject (std::initializer_list<std::pair<const char*, juce::var>> props)
    {
        auto* o = new juce::DynamicObject();
        for (auto& p : props) o->setProperty (p.first, p.second);
        return juce::var (o);
    }
}

LlmClient::LlmClient()
{
    schema = juce::JSON::parse (vstai::kOutputSchemaJson);
}

bool LlmClient::callMessages (const juce::Array<juce::var>& messages,
                              juce::var& artifactOut,
                              juce::String& errorOut)
{
    if (needsApiKey() && apiKey.isEmpty())
    {
        errorOut = provider == Provider::glm
                       ? "GLM API key is not set (open the Keys… dialog or set GLM_API_KEY)."
                       : "Anthropic API key is not set (open the Keys… dialog or set ANTHROPIC_API_KEY).";
        return false;
    }

    if (provider == Provider::cloud)
    {
        if (token.isEmpty())
        {
            errorOut = "Sign in to VibePlugin Cloud first (open the Account… dialog).";
            return false;
        }
        return callCloud (messages, artifactOut, errorOut);
    }

    return provider == Provider::anthropic ? callAnthropic    (messages, artifactOut, errorOut)
                                           : callOpenAiCompat (messages, artifactOut, errorOut);
}

// ---------------------------------------------------------------------------
//  Cloud — POST {baseUrl}/v1/generate to the VibePlugin proxy (Bearer token).
//  The proxy injects the system prompt + provider key, meters tokens, charges
//  credits, and returns { content, credits_charged, balance, model_used }.
// ---------------------------------------------------------------------------
bool LlmClient::callCloud (const juce::Array<juce::var>& messages,
                           juce::var& artifactOut,
                           juce::String& errorOut)
{
    auto* body = new juce::DynamicObject();
    body->setProperty ("model",    model);
    body->setProperty ("effort",   effort);
    body->setProperty ("is_synth", synth);
    body->setProperty ("thinking", thinking);   // honoured for GLM models server-side
    body->setProperty ("messages", juce::var (juce::Array<juce::var> (messages)));

    const juce::String payload = juce::JSON::toString (juce::var (body), true);

    juce::String base = baseUrl;
    while (base.endsWithChar ('/')) base = base.dropLastCharacters (1);
    juce::URL url = juce::URL (base + "/v1/generate").withPOSTData (payload);
    const juce::String headers = "content-type: application/json\r\nAuthorization: Bearer " + token;

    int statusCode = 0;
    const juce::String responseText = httpRequest (url, headers, true, statusCode, 600000);
    VSTAI_LOG ("cloud HTTP " + juce::String (statusCode) + ", "
               + juce::String (responseText.length()) + " bytes");

    if (responseText.isEmpty())
    {
        errorOut = "could not reach VibePlugin Cloud (" + base + ")";
        return false;
    }

    const juce::var response = juce::JSON::parse (responseText);
    if (! response.isObject())
    {
        errorOut = "unexpected response from VibePlugin Cloud (HTTP " + juce::String (statusCode) + ")";
        return false;
    }

    if (response.hasProperty ("error"))
    {
        errorOut = "Cloud: " + response.getProperty ("error", "unknown").toString();
        return false;
    }

    const juce::String content = response.getProperty ("content", {}).toString();
    if (content.isEmpty()) { errorOut = "VibePlugin Cloud returned an empty result"; return false; }

    artifactOut = parseLooseJson (content);
    if (! artifactOut.isObject()) { errorOut = "VibePlugin Cloud did not return valid JSON"; return false; }
    return true;
}

// ---------------------------------------------------------------------------
//  Anthropic — /v1/messages with structured outputs + adaptive thinking.
// ---------------------------------------------------------------------------
bool LlmClient::callAnthropic (const juce::Array<juce::var>& messages,
                               juce::var& artifactOut,
                               juce::String& errorOut)
{
    auto* format = new juce::DynamicObject();
    format->setProperty ("type", "json_schema");
    format->setProperty ("schema", schema);

    auto* outputConfig = new juce::DynamicObject();
    outputConfig->setProperty ("format", juce::var (format));
    if (effort.isNotEmpty())
        outputConfig->setProperty ("effort", effort);   // cost/quality: low|medium|high|max

    auto* thinkingCfg = new juce::DynamicObject();
    thinkingCfg->setProperty ("type", "adaptive");
    thinkingCfg->setProperty ("display", "summarized");   // stream a readable reasoning summary
                                                          // (default "omitted" returns empty thinking)

    // max_tokens caps thinking + visible output *combined* (the model isn't told
    // about it). A full plugin is a big JSON blob — a complete AssemblyScript
    // module plus a complete HTML GUI — and adaptive thinking at higher effort
    // spends a chunk of the budget before any text, so a low cap truncates the
    // JSON with stop_reason: max_tokens. Use each model's real output ceiling
    // (Opus 4.x → 128K, Sonnet/Haiku 4.x → 64K). Streaming (below) avoids the
    // HTTP timeouts these large values would otherwise risk.
    const int maxTokens = model.startsWithIgnoreCase ("claude-opus") ? 128000 : 64000;

    auto* body = new juce::DynamicObject();
    body->setProperty ("model", model);
    body->setProperty ("max_tokens", maxTokens);
    body->setProperty ("stream", true);
    body->setProperty ("thinking", juce::var (thinkingCfg));
    body->setProperty ("output_config", juce::var (outputConfig));

    // The system prompt is large and byte-identical on every call, so cache it:
    // `cache_control: ephemeral` makes repeat requests within the 5-min TTL read it
    // at ~0.1x input cost instead of re-billing the whole prompt each fix/edit turn.
    // (Anthropic-only; the per-request current source rides in the user message,
    // after this cached prefix, so it doesn't break the cache.)
    {
        auto* cc = new juce::DynamicObject();
        cc->setProperty ("type", "ephemeral");
        auto* sysBlock = new juce::DynamicObject();
        sysBlock->setProperty ("type", "text");
        sysBlock->setProperty ("text", juce::String (vstai::kSystemPrompt));
        sysBlock->setProperty ("cache_control", juce::var (cc));
        juce::Array<juce::var> sys; sys.add (juce::var (sysBlock));
        body->setProperty ("system", juce::var (sys));
    }
    body->setProperty ("messages", juce::var (juce::Array<juce::var> (messages)));

    const juce::String payload = juce::JSON::toString (juce::var (body), true);

    juce::URL url = juce::URL ("https://api.anthropic.com/v1/messages").withPOSTData (payload);
    const juce::String headers =
          "content-type: application/json\r\n"
          "anthropic-version: 2023-06-01\r\n"
          "x-api-key: " + apiKey;

    // Consume the SSE stream, assembling the JSON from `text_delta` events. The
    // text block is emitted after any thinking phase, so we accumulate to the end.
    juce::String jsonText, stopReason, apiError, errorBody;
    juce::StringArray blockTypes;
    int statusCode = 0;

    const bool reached = httpStreamSse (url, headers, statusCode, 600000,
        [&] (const juce::var& ev)
        {
            const juce::String type = ev.getProperty ("type", {}).toString();

            if (type == "content_block_start")
                blockTypes.add (ev.getProperty ("content_block", {})
                                  .getProperty ("type", {}).toString());
            else if (type == "content_block_delta")
            {
                const auto delta = ev.getProperty ("delta", {});
                const juce::String dt = delta.getProperty ("type", {}).toString();
                if (dt == "text_delta")
                    jsonText += delta.getProperty ("text", {}).toString();
                else if (dt == "thinking_delta" && onThinking)
                    onThinking (delta.getProperty ("thinking", {}).toString());   // live reasoning summary
            }
            else if (type == "message_delta")
            {
                const juce::String sr = ev.getProperty ("delta", {})
                                          .getProperty ("stop_reason", {}).toString();
                if (sr.isNotEmpty()) stopReason = sr;
            }
            else if (type == "error")
                apiError = ev.getProperty ("error", {}).getProperty ("message", "unknown").toString();
        },
        errorBody);

    VSTAI_LOG ("anthropic HTTP " + juce::String (statusCode)
               + ", stop_reason=" + (stopReason.isEmpty() ? juce::String ("(none)") : stopReason)
               + ", " + juce::String (jsonText.length()) + " text bytes");

    if (! reached)
    {
        errorOut = "could not reach api.anthropic.com (network/TLS error)";
        return false;
    }

    // Non-2xx: the body is a single JSON error object, not an SSE stream.
    if (errorBody.isNotEmpty())
    {
        VSTAI_LOG ("error body: " + errorBody.substring (0, 500));
        const juce::var err = juce::JSON::parse (errorBody);
        const juce::String msg = err.getProperty ("error", {}).getProperty ("message", {}).toString();
        errorOut = msg.isNotEmpty() ? "API error: " + msg
                                    : "unexpected response from the API (HTTP " + juce::String (statusCode) + ")";
        return false;
    }

    if (apiError.isNotEmpty())   { errorOut = "API error: " + apiError; return false; }
    if (stopReason == "refusal") { errorOut = "Claude declined this request (stop_reason: refusal)."; return false; }

    if (jsonText.isEmpty())
    {
        // Thinking-only/truncated response is the usual cause — log so it's diagnosable.
        VSTAI_LOG ("no text block; stop_reason=" + stopReason
                   + " blocks=[" + blockTypes.joinIntoString (", ") + "]");
        errorOut = (stopReason == "max_tokens")
            ? "the model ran out of output tokens before returning JSON (stop_reason: "
              "max_tokens) — lower the effort setting or raise max_tokens"
            : "response contained no text block (stop_reason: "
              + (stopReason.isEmpty() ? juce::String ("none") : stopReason) + ")";
        return false;
    }

    artifactOut = juce::JSON::parse (jsonText);
    if (! artifactOut.isObject()) { errorOut = "model did not return valid JSON"; return false; }
    return true;
}

// ---------------------------------------------------------------------------
//  GLM + Ollama — OpenAI-compatible /chat/completions, JSON mode.
// ---------------------------------------------------------------------------
bool LlmClient::callOpenAiCompat (const juce::Array<juce::var>& messages,
                                  juce::var& artifactOut,
                                  juce::String& errorOut)
{
    const bool isOllama = (provider == Provider::ollama);
    const bool isGlm    = (provider == Provider::glm);

    auto trimSlashes = [] (juce::String u) { while (u.endsWithChar ('/')) u = u.dropLastCharacters (1); return u; };

    const juce::String endpoint =
        isOllama ? normaliseOllamaUrl (baseUrl) + "/v1/chat/completions"
                 : trimSlashes (baseUrl) + "/chat/completions";   // glm

    // Build messages: a system prompt that pins the exact JSON schema (these
    // providers don't take Anthropic's output_config), then the conversation.
    const juce::String systemPrompt =
        juce::String (vstai::kSystemPrompt) +
        "\n\n============================================================\n"
        "OUTPUT FORMAT (STRICT)\n"
        "============================================================\n"
        "Respond with ONE JSON object and nothing else — no prose, no markdown, no code\n"
        "fences. It MUST conform exactly to this JSON schema:\n"
        + juce::String (vstai::kOutputSchemaJson) +
        "\nReturn only that JSON object.";

    juce::Array<juce::var> full;
    full.add (makeObject ({ { "role", "system" }, { "content", systemPrompt } }));
    full.addArray (messages);

    // Build the POST URL for either a streaming or a buffered request (same body
    // otherwise). GLM is a reasoning model: thinking + visible output share the
    // max_tokens budget. In thinking mode the reasoning can eat tens of thousands
    // of tokens, so a full plugin's JSON needs lots of headroom or it truncates
    // mid-output (finish_reason: length). Ollama models are local with small
    // context, so keep the modest cap there.
    auto buildPostUrl = [&] (bool stream) -> juce::URL
    {
        auto* body = new juce::DynamicObject();
        body->setProperty ("model", model);
        body->setProperty ("messages", juce::var (full));
        body->setProperty ("stream", stream);
        body->setProperty ("temperature", 0.2);
        body->setProperty ("max_tokens", isGlm ? 131072 : 8192);
        body->setProperty ("response_format", makeObject ({ { "type", "json_object" } }));
        if (isGlm)   // hybrid reasoning model — let the user trade quality for speed/cost
            body->setProperty ("thinking",
                               makeObject ({ { "type", thinking ? "enabled" : "disabled" } }));
        return juce::URL (endpoint).withPOSTData (juce::JSON::toString (juce::var (body), true));
    };

    juce::String headers = "content-type: application/json";
    if (apiKey.isNotEmpty())
        headers += "\r\nAuthorization: Bearer " + apiKey;

    // A single buffered JSON response → artifactOut. Used by Ollama always, and by
    // GLM as a fallback when the streaming connection can't be opened.
    auto callBuffered = [&] () -> bool
    {
        int statusCode = 0;
        const juce::String responseText = httpRequest (buildPostUrl (false), headers, true, statusCode, 600000);
        VSTAI_LOG (juce::String (isGlm ? "glm" : "ollama") + " buffered HTTP " + juce::String (statusCode)
                   + ", " + juce::String (responseText.length()) + " bytes");

        if (responseText.isEmpty())
        {
            errorOut = isGlm
                ? ("could not reach the GLM server at " + trimSlashes (baseUrl) + " (network/TLS error)")
                : ("could not reach the Ollama server at " + normaliseOllamaUrl (baseUrl)
                   + " — is `ollama serve` running?");
            return false;
        }

        const juce::var response = juce::JSON::parse (responseText);
        if (! response.isObject())
        {
            VSTAI_LOG ("non-JSON response: " + responseText.substring (0, 500));
            errorOut = "unexpected response from the API"
                     + (statusCode != 0 ? " (HTTP " + juce::String (statusCode) + ")" : juce::String());
            return false;
        }

        // OpenAI/Ollama error shape: { "error": { "message": ... } } or { "error": "..." }.
        if (response.hasProperty ("error"))
        {
            auto err = response.getProperty ("error", {});
            errorOut = "API error: " + (err.isObject() ? err.getProperty ("message", "unknown").toString()
                                                        : err.toString());
            return false;
        }

        auto* choices = response.getProperty ("choices", {}).getArray();
        if (choices == nullptr || choices->isEmpty())
        {
            errorOut = "response had no choices"
                     + (statusCode != 0 ? " (HTTP " + juce::String (statusCode) + ")" : juce::String());
            return false;
        }

        const juce::var    c0          = (*choices)[0];
        const juce::String contentText = c0.getProperty ("message", {})
                                           .getProperty ("content", {}).toString();
        if (contentText.isEmpty())
        {
            errorOut = c0.getProperty ("finish_reason", {}).toString() == "length"
                ? "the model hit its output-token limit before returning an answer "
                  "(a reasoning model can spend the whole budget thinking) — try a simpler request"
                : "model returned an empty message";
            return false;
        }

        artifactOut = parseLooseJson (contentText);
        if (! artifactOut.isObject())
        {
            VSTAI_LOG ("could not parse model JSON: " + contentText.substring (0, 500));
            errorOut = "model did not return valid JSON";
            return false;
        }
        return true;
    };

    // Ollama: always a single buffered response.
    if (! isGlm)
        return callBuffered();

    // GLM: stream so reasoning_content surfaces live. If the streaming connection
    // can't be opened (some TLS stacks reject the chunked SSE POST), fall back to a
    // buffered request so generation still works — just without the live thinking.
    juce::String jsonText, finishReason, errorBody;
    int statusCode = 0;
    const juce::String streamHeaders = headers + "\r\nAccept: text/event-stream";

    const bool reached = httpStreamSse (buildPostUrl (true), streamHeaders, statusCode, 600000,
        [&] (const juce::var& ev)
        {
            auto* choices = ev.getProperty ("choices", {}).getArray();
            if (choices == nullptr || choices->isEmpty()) return;
            const juce::var c0    = (*choices)[0];
            const juce::var delta = c0.getProperty ("delta", {});

            const juce::String rc = delta.getProperty ("reasoning_content", {}).toString();
            if (rc.isNotEmpty() && onThinking) onThinking (rc);

            jsonText += delta.getProperty ("content", {}).toString();

            const juce::String fr = c0.getProperty ("finish_reason", {}).toString();
            if (fr.isNotEmpty()) finishReason = fr;
        },
        errorBody);

    VSTAI_LOG ("glm stream HTTP " + juce::String (statusCode) + ", reached=" + juce::String ((int) reached)
               + ", finish=" + (finishReason.isEmpty() ? juce::String ("(none)") : finishReason)
               + ", " + juce::String (jsonText.length()) + " content bytes");

    // An explicit API error from the stream is authoritative — report it, no retry.
    if (reached && errorBody.isNotEmpty())
    {
        VSTAI_LOG ("glm error body: " + errorBody.substring (0, 500));
        const juce::var err = juce::JSON::parse (errorBody);
        const juce::String msg = err.getProperty ("error", {}).getProperty ("message", {}).toString();
        errorOut = msg.isNotEmpty() ? "API error: " + msg
                                    : "unexpected response from GLM (HTTP " + juce::String (statusCode) + ")";
        return false;
    }

    // Truncated by the token cap: report it directly. A buffered retry would just
    // truncate the same way, so don't waste another full generation on it.
    if (reached && finishReason == "length")
    {
        errorOut = jsonText.isEmpty()
            ? "the model hit its output-token limit before returning an answer "
              "(reasoning used the whole budget) — turn Thinking off or simplify the request"
            : "the model hit its output-token limit before finishing the JSON "
              "(reasoning used too much of the budget) — turn Thinking off or simplify the request";
        return false;
    }

    // Streamed content arrived — parse it.
    if (reached && jsonText.isNotEmpty())
    {
        artifactOut = parseLooseJson (jsonText);
        if (artifactOut.isObject()) return true;
        VSTAI_LOG ("could not parse streamed GLM JSON; retrying buffered");
    }

    // Streaming couldn't open (or produced nothing usable) — fall back to buffered.
    VSTAI_LOG ("glm: streaming unavailable, falling back to a buffered request");
    return callBuffered();
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------
LlmClient::Provider LlmClient::providerFromString (const juce::String& s)
{
    if (s.equalsIgnoreCase ("glm"))      return Provider::glm;
    if (s.equalsIgnoreCase ("ollama"))   return Provider::ollama;
    if (s.equalsIgnoreCase ("cloud"))    return Provider::cloud;
    return Provider::anthropic;
}

juce::String LlmClient::providerToString (Provider p)
{
    switch (p)
    {
        case Provider::glm:      return "glm";
        case Provider::ollama:   return "ollama";
        case Provider::cloud:    return "cloud";
        case Provider::anthropic:
        default:                 return "anthropic";
    }
}

LlmClient::Provider LlmClient::providerForModel (const juce::String& m)
{
    if (m.startsWithIgnoreCase ("claude"))   return Provider::anthropic;
    if (m.startsWithIgnoreCase ("glm"))      return Provider::glm;
    return Provider::ollama;   // everything else is a local/open model
}

juce::String LlmClient::normaliseOllamaUrl (const juce::String& url)
{
    juce::String u = url.trim();
    if (u.isEmpty()) u = "http://localhost:11434";
    if (! u.containsIgnoreCase ("://")) u = "http://" + u;      // $OLLAMA_HOST is often host:port
    while (u.endsWithChar ('/')) u = u.dropLastCharacters (1);
    return u;
}

juce::StringArray LlmClient::listOllamaModels (const juce::String& baseUrl, juce::String& errorOut)
{
    juce::StringArray names;
    juce::URL url (normaliseOllamaUrl (baseUrl) + "/api/tags");

    int statusCode = 0;
    const juce::String body = httpRequest (url, "content-type: application/json", false, statusCode, 4000);
    if (body.isEmpty())
    {
        errorOut = "Ollama not reachable at " + normaliseOllamaUrl (baseUrl);
        return names;
    }

    const juce::var parsed = juce::JSON::parse (body);
    if (auto* models = parsed.getProperty ("models", {}).getArray())
        for (const auto& mdl : *models)
        {
            const juce::String name = mdl.getProperty ("name", {}).toString();
            if (name.isNotEmpty()) names.add (name);
        }

    if (names.isEmpty())
        errorOut = "Ollama is running but has no models (try `ollama pull <model>`).";
    return names;
}
