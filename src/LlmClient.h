// LlmClient.h
// =====================================================================
//  Talks to a chat-completions LLM directly from C++ (raw HTTPS — there is
//  no official C/C++ SDK for any of these). One class, three providers:
//
//    * anthropic  - POST https://api.anthropic.com/v1/messages, x-api-key,
//                   structured outputs + adaptive thinking (claude-*).
//    * glm        - POST {baseUrl}/chat/completions, Bearer, OpenAI-compatible,
//                   JSON mode — GLM / Zhipu (Z.ai), e.g. glm-4.6.
//    * ollama     - POST {baseUrl}/v1/chat/completions, OpenAI-compatible,
//                   local open models, no key.
//    * cloud      - POST {baseUrl}/v1/generate to the VibePlugin proxy with a
//                   Bearer session token; the proxy injects the system prompt +
//                   provider key, meters tokens and charges the user's credits.
//
//  (The free, no-key path — "copy the prompt into any chatbot and paste the
//  reply back" — does not go through this class; see Prompt.h::buildManualPrompt
//  and parseManualReply.)
//
//  Synchronous: call from a background thread. The model is asked to return
//  JSON matching Prompt.h's schema (assembly, html, params, explanation).
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <functional>

class LlmClient
{
public:
    enum class Provider { anthropic, glm, ollama, cloud };

    LlmClient();

    void setProvider (Provider p)               { provider = p; }
    void setApiKey  (const juce::String& key)   { apiKey = key; }
    void setModel   (const juce::String& m)      { if (m.isNotEmpty()) model = m; }
    void setEffort  (const juce::String& e)      { if (e.isNotEmpty()) effort = e; }   // anthropic thinking depth
    void setBaseUrl (const juce::String& u)      { if (u.isNotEmpty()) baseUrl = u; }  // ollama / glm / cloud server
    void setToken   (const juce::String& t)      { token = t; }                        // cloud session token
    void setSynth   (bool b)                     { synth = b; }                        // cloud: tag stored history
    void setThinking (bool b)                    { thinking = b; }                     // glm reasoning on/off (cloud forwards it)
    // Live reasoning sink: called on the calling thread with each reasoning_content
    // delta as a GLM response streams. Marshal to the UI thread inside the callback.
    void setThinkingSink (std::function<void (const juce::String&)> cb) { onThinking = std::move (cb); }

    Provider getProvider() const                 { return provider; }
    // Direct-to-provider keys: anthropic/glm need one; ollama/cloud don't.
    bool needsApiKey() const                     { return provider == Provider::anthropic
                                                       || provider == Provider::glm; }
    bool hasApiKey() const                       { return apiKey.isNotEmpty(); }

    // One round trip. `messages` is an array of { role, content } vars (the
    // system prompt is added internally). On success, `artifactOut` is the
    // parsed {assembly, html, params, explanation}.
    bool callMessages (const juce::Array<juce::var>& messages,
                       juce::var& artifactOut,
                       juce::String& errorOut);

    // ---- helpers ---------------------------------------------------------
    static Provider     providerFromString (const juce::String& s);
    static juce::String providerToString   (Provider p);
    static Provider     providerForModel   (const juce::String& model);   // heuristic by model id

    // Normalise an Ollama base URL (add http:// scheme, strip trailing slash).
    static juce::String normaliseOllamaUrl (const juce::String& url);

    // List models available on a local Ollama server (GET {baseUrl}/api/tags).
    // Returns the model names; on failure returns empty and sets `errorOut`.
    static juce::StringArray listOllamaModels (const juce::String& baseUrl, juce::String& errorOut);

private:
    bool callAnthropic     (const juce::Array<juce::var>& messages, juce::var& out, juce::String& err);
    bool callOpenAiCompat  (const juce::Array<juce::var>& messages, juce::var& out, juce::String& err);
    bool callCloud         (const juce::Array<juce::var>& messages, juce::var& out, juce::String& err);

    Provider     provider { Provider::anthropic };
    juce::String apiKey;
    juce::String model   { "claude-opus-4-8" };
    juce::String effort  { "medium" };   // low|medium|high|max (anthropic only)
    juce::String baseUrl { "http://localhost:11434" };
    juce::String token;                  // cloud session token
    bool         synth { false };        // cloud: is_synth tag
    bool         thinking { true };      // glm reasoning on/off (cloud forwards it)
    std::function<void (const juce::String&)> onThinking;   // live reasoning_content sink (optional)
    juce::var    schema;                 // parsed from Prompt.h once

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LlmClient)
};
