// Settings.h
// =====================================================================
//  Resolves runtime settings from the compiled-in Config.h (if present),
//  falling back to environment variables. Everything the plugin needs to
//  run can be baked into the binary via Config.h.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>

#if __has_include("Config.h")
 #include "Config.h"
#endif

#ifndef VSTAI_CONFIG_API_KEY
 #define VSTAI_CONFIG_API_KEY ""
#endif
#ifndef VSTAI_CONFIG_MODEL
 #define VSTAI_CONFIG_MODEL ""
#endif
#ifndef VSTAI_CONFIG_COMPILER
 #define VSTAI_CONFIG_COMPILER ""
#endif
#ifndef VSTAI_CONFIG_OLLAMA_URL
 #define VSTAI_CONFIG_OLLAMA_URL ""
#endif
#ifndef VSTAI_CONFIG_GLM_API_KEY
 #define VSTAI_CONFIG_GLM_API_KEY ""
#endif
#ifndef VSTAI_CONFIG_GLM_URL
 #define VSTAI_CONFIG_GLM_URL ""
#endif
#ifndef VSTAI_CONFIG_LICENSE_URL
 #define VSTAI_CONFIG_LICENSE_URL ""
#endif
#ifndef VSTAI_CONFIG_CHECKOUT_URL
 #define VSTAI_CONFIG_CHECKOUT_URL ""
#endif
#ifndef VSTAI_CONFIG_CLOUD_URL
 #define VSTAI_CONFIG_CLOUD_URL ""
#endif
#ifndef VSTAI_CONFIG_CLOUD_CHECKOUT_URL
 #define VSTAI_CONFIG_CLOUD_CHECKOUT_URL ""
#endif

namespace vstai::settings
{
    inline juce::String apiKey()
    {
        juce::String k (VSTAI_CONFIG_API_KEY);
        if (k.isEmpty()) k = juce::SystemStats::getEnvironmentVariable ("ANTHROPIC_API_KEY", {});
        return k;
    }

    // Base URL of a local Ollama server (open models, no key). Config.h ->
    // $VSTAI_OLLAMA_URL -> $OLLAMA_HOST -> the default localhost port.
    inline juce::String ollamaBaseUrl()
    {
        juce::String u (VSTAI_CONFIG_OLLAMA_URL);
        if (u.isEmpty()) u = juce::SystemStats::getEnvironmentVariable ("VSTAI_OLLAMA_URL", {});
        if (u.isEmpty()) u = juce::SystemStats::getEnvironmentVariable ("OLLAMA_HOST", {});
        if (u.isEmpty()) u = "http://localhost:11434";
        return u;
    }

    // GLM (Zhipu / Z.ai) API key (OpenAI-compatible endpoint). Config.h -> $GLM_API_KEY.
    inline juce::String glmApiKey()
    {
        juce::String k (VSTAI_CONFIG_GLM_API_KEY);
        if (k.isEmpty()) k = juce::SystemStats::getEnvironmentVariable ("GLM_API_KEY", {});
        return k;
    }

    // GLM API base URL (no trailing /chat/completions). Config.h -> $GLM_BASE_URL
    // -> the Z.ai default. Use the open.bigmodel.cn host for the China endpoint.
    inline juce::String glmBaseUrl()
    {
        juce::String u (VSTAI_CONFIG_GLM_URL);
        if (u.isEmpty()) u = juce::SystemStats::getEnvironmentVariable ("GLM_BASE_URL", {});
        if (u.isEmpty()) u = "https://api.z.ai/api/paas/v4";
        return u;
    }

    // Base URL of the VibePlugin license server (activate / validate a lifetime key).
    inline juce::String licenseServerUrl()
    {
        juce::String u (VSTAI_CONFIG_LICENSE_URL);
        if (u.isEmpty()) u = juce::SystemStats::getEnvironmentVariable ("VSTAI_LICENSE_URL", {});
        if (u.isEmpty()) u = "https://api.vst3ai.app";
        return u;
    }

    // Lemon Squeezy checkout URL for the lifetime license. Empty -> opens the server.
    inline juce::String licenseCheckoutUrl()
    {
        juce::String u (VSTAI_CONFIG_CHECKOUT_URL);
        if (u.isEmpty()) u = juce::SystemStats::getEnvironmentVariable ("VSTAI_CHECKOUT_URL", {});
        return u;
    }

    // Base URL of the VibePlugin cloud-credits server (sign-in + metered generation).
    // It is the same deployment as the license server by default.
    inline juce::String cloudBaseUrl()
    {
        juce::String u (VSTAI_CONFIG_CLOUD_URL);
        if (u.isEmpty()) u = juce::SystemStats::getEnvironmentVariable ("VSTAI_CLOUD_URL", {});
        if (u.isEmpty()) u = "https://api.vst3ai.app";
        return u;
    }

    // Lemon Squeezy checkout URL for credit packs. Empty -> opens the server.
    inline juce::String cloudCheckoutUrl()
    {
        juce::String u (VSTAI_CONFIG_CLOUD_CHECKOUT_URL);
        if (u.isEmpty()) u = juce::SystemStats::getEnvironmentVariable ("VSTAI_CLOUD_CHECKOUT_URL", {});
        return u;
    }

    inline juce::String model()
    {
        juce::String m (VSTAI_CONFIG_MODEL);
        if (m.isEmpty()) m = juce::SystemStats::getEnvironmentVariable ("VSTAI_MODEL", {});
        if (m.isEmpty()) m = "claude-opus-4-8";
        return m;
    }

    // The command (argv prefix) that runs the bundled AssemblyScript compiler.
    // Two supported packagings, both fully self-contained:
    //   * a single executable `vstai-asc`            -> { vstai-asc }
    //   * a runtime + ESM bundle `vstai-node` + `asc-bundle.mjs`
    //                                                -> { vstai-node, asc-bundle.mjs }
    // The plugin appends <in.ts> <out.wasm> and execs it directly (no shell).
    inline juce::StringArray compilerCommand()
    {
       #if JUCE_WINDOWS
        const juce::String single = "vstai-asc.exe";
        const juce::String runtime = "vstai-node.exe";
       #else
        const juce::String single = "vstai-asc";
        const juce::String runtime = "vstai-node";
       #endif
        const juce::String bundle = "asc-bundle.mjs";

        // Explicit single-file override via Config.h / env.
        juce::String configured (VSTAI_CONFIG_COMPILER);
        if (configured.isEmpty())
            configured = juce::SystemStats::getEnvironmentVariable ("VSTAI_COMPILER", {});
        if (configured.isNotEmpty() && juce::File (configured).existsAsFile())
            return { juce::File (configured).getFullPathName() };

        auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
        const juce::File dirs[] = {
            exe.getParentDirectory(),
            exe.getParentDirectory().getChildFile ("Resources"),
            exe.getParentDirectory().getParentDirectory().getChildFile ("Resources")
        };
        for (auto& d : dirs)
        {
            auto one = d.getChildFile (single);
            if (one.existsAsFile())
                return { one.getFullPathName() };

            auto rt = d.getChildFile (runtime);
            auto js = d.getChildFile (bundle);
            if (rt.existsAsFile() && js.existsAsFile())
                return { rt.getFullPathName(), js.getFullPathName() };
        }
        return {};
    }
}
