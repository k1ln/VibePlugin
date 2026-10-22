// Planner.h
// =====================================================================
//  Request planner: splits an oversized plugin request into ordered build
//  steps before generation.
//
//  One generation is capped by the model's output ceiling (128K tokens) and
//  the model's reasoning counts against it, so a huge specification fails
//  with truncated JSON. Opus reads the request first and returns a plan the
//  editor then runs step by step (step 1 builds the plugin, later steps are
//  change requests on it).
//
//  Cloud accounts call the server's POST /v1/plan (billed in credits). Bring-
//  your-own-key Anthropic users call the API directly with their own key.
//  Other providers are not planned: the request goes through unchanged.
//
//  Synchronous, ASCII-only literals. Call from a background thread.
//  KEEP kPlannerSystem IN SYNC with PLANNER_SYSTEM in the server's
//  src/plannerPrompt.ts.
// =====================================================================

#pragma once

#include "CloudClient.h"
#include "DevLog.h"

#include <juce_core/juce_core.h>

namespace vstai::planner
{
    inline constexpr int kMaxSteps = 6;
    inline const char* kModel = "claude-opus-5-5";

    struct Plan
    {
        bool         ok    = false;     // false: planning failed, caller generates normally
        bool         split = false;     // true: run `prompts` in order
        juce::String reason, error;
        juce::StringArray titles, prompts;
        int          credits = 0;       // charged by the cloud route (0 on BYO key)
    };

    inline const char* kPlannerSystem = R"PLAN(You split a large audio-plugin request into ordered build steps for an AI plugin generator.

The generator writes ONE complete plugin per step: an AssemblyScript DSP module compiled to WebAssembly plus a single-file HTML GUI. Facts about it:
- One step can safely produce a module of roughly 1,500 lines plus its GUI. Anything much bigger fails, so each step must add a moderate amount.
- The plugin exposes a fixed pool of 64 float parameters to the GUI and the host (index 63 is reserved). Large plugins pack extra controls into those slots, so each step must keep earlier parameter indices unchanged.
- After step 1, every later step is applied as a change request on the plugin built so far.

Rules:
1. If the request is small or medium (roughly under 40 distinct requirements, no large content such as hundreds of presets), answer split=false with exactly one step whose prompt is the original request, unchanged.
2. Otherwise split it into 2 to 6 steps. Step 1 builds the core working instrument/effect: the main signal path and a basic but good-looking GUI with the controls for that path. Later steps ADD one coherent block each (for example modulation, effects, extra voices/modes, presets), never rewrite what exists.
3. Each step prompt must be self-contained: state the plugin name and type, say that it is a change request on the existing plugin (except step 1), keep existing parameter indices stable, and copy the user's own wording and numbers for that block verbatim (do not paraphrase specifications, do not drop items).
4. Every requirement of the original request must land in exactly one step. Put presets last. Put the GUI-polish requirements that apply everywhere (tabs, layout, style) in step 1 and mention them again where a later step adds controls.
5. Titles are 2 to 5 words.

Answer with JSON only, no prose and no code fence:
{"split": boolean, "reason": "one short sentence", "steps": [{"title": "...", "prompt": "..."}]})PLAN";

    // Turn a parsed { split, reason, steps:[{title,prompt}] } object into a Plan.
    // A single step, or split=false, always means "run the original prompt".
    inline Plan fromObject (const juce::var& j, const juce::String& original, bool force = false)
    {
        Plan p;
        const auto* arr = j.getProperty ("steps", {}).getArray();
        if (arr == nullptr || arr->isEmpty()) { p.error = "empty plan"; return p; }

        p.reason = j.getProperty ("reason", {}).toString();
        const bool wantSplit = force || (bool) j.getProperty ("split", true);
        for (const auto& s : *arr)
        {
            if (p.prompts.size() >= kMaxSteps) break;
            const auto prompt = s.getProperty ("prompt", {}).toString().trim();
            if (prompt.isEmpty()) continue;
            p.prompts.add (prompt);
            p.titles.add (s.getProperty ("title", {}).toString().trim());
        }
        if (p.prompts.isEmpty()) { p.error = "empty plan"; return p; }

        if (force && p.prompts.size() < 2) { p.error = "could not split further"; return p; }
        p.ok = true;
        if (! wantSplit || p.prompts.size() == 1)
        {
            p.split = false;
            p.prompts.clear(); p.titles.clear();
            p.prompts.add (original); p.titles.add ("Build");
            return p;
        }
        p.split = true;
        for (int i = 0; i < p.titles.size(); ++i)
            if (p.titles[i].isEmpty()) p.titles.set (i, "Step " + juce::String (i + 1));
        return p;
    }

    // Cloud account: server-side Opus call, billed in credits.
    inline Plan planViaCloud (const juce::String& base, const juce::String& token,
                              const juce::String& prompt, bool isSynth, bool force)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("prompt",   prompt);
        o->setProperty ("is_synth", isSynth);
        o->setProperty ("force",    force);
        const auto r = vstai::cloud::send ("POST", vstai::cloud::trimUrl (base) + "/v1/plan", token, juce::var (o));
        if (! r.ok())
        {
            Plan p; p.error = r.error();
            VSTAI_LOG ("planner: cloud failed: " + p.error);
            return p;
        }
        auto p = fromObject (r.json, prompt, force);
        p.credits = (int) r.json.getProperty ("credits_charged", 0);
        return p;
    }

    // Bring-your-own Anthropic key: call the API directly.
    inline Plan planViaAnthropic (const juce::String& apiKey, const juce::String& prompt, bool isSynth, bool force)
    {
        Plan p;
        juce::Array<juce::var> msgs;
        {
            auto* m = new juce::DynamicObject();
            m->setProperty ("role", "user");
            m->setProperty ("content", juce::String ("Target: ") + (isSynth ? "instrument / synthesizer" : "audio effect")
                                       + ".\n\nRequest:\n" + prompt
                                       + (force ? juce::String ("\n\nIMPORTANT: this request already FAILED as a single generation because it exceeded the output budget. "
                                                                "Do NOT answer split=false: split it into 2 to 4 smaller steps, each adding a moderate amount.")
                                                : juce::String()));
            msgs.add (juce::var (m));
        }
        auto* body = new juce::DynamicObject();
        body->setProperty ("model",      kModel);
        body->setProperty ("max_tokens", 8000);
        body->setProperty ("system",     juce::String (kPlannerSystem));
        body->setProperty ("messages",   juce::var (msgs));

        const auto url = juce::URL ("https://api.anthropic.com/v1/messages")
                             .withPOSTData (juce::JSON::toString (juce::var (body), true));
        int status = 0;
        auto options = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
                           .withExtraHeaders ("content-type: application/json\r\nanthropic-version: 2023-06-01\r\nx-api-key: " + apiKey)
                           .withConnectionTimeoutMs (20000)
                           .withHttpRequestCmd ("POST")
                           .withStatusCode (&status);
        std::unique_ptr<juce::InputStream> in (url.createInputStream (options));
        if (in == nullptr) { p.error = "could not reach the Anthropic API"; return p; }
        const auto resp = juce::JSON::parse (in->readEntireStreamAsString());
        if (status < 200 || status >= 300)
        {
            p.error = resp.getProperty ("error", {}).getProperty ("message", "HTTP " + juce::String (status)).toString();
            return p;
        }
        if (resp.getProperty ("stop_reason", {}).toString() == "max_tokens") { p.error = "plan was cut off"; return p; }

        juce::String text;
        if (const auto* blocks = resp.getProperty ("content", {}).getArray())
            for (const auto& b : *blocks)
                if (b.getProperty ("type", {}).toString() == "text") { text = b.getProperty ("text", {}).toString(); break; }
        const int a = text.indexOfChar ('{'), z = text.lastIndexOfChar ('}');
        if (a < 0 || z <= a) { p.error = "unparseable plan"; return p; }
        return fromObject (juce::JSON::parse (text.substring (a, z + 1)), prompt, force);
    }
}
