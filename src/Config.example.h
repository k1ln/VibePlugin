// Config.example.h
// =====================================================================
//  Copy this to Config.h and fill in your values. Config.h is gitignored
//  and is compiled INTO the plugin, so the shipped binary carries the API
//  key and settings (no environment needed at runtime).
//
//      cp src/Config.example.h src/Config.h    # then edit src/Config.h
//
//  ⚠️  The API key is embedded in the binary in clear text — anyone with the
//      plugin file can extract it with `strings`. Only ship a key you are
//      comfortable distributing (use a scoped/limited key, rotate as needed).
//      If you leave a value empty, the plugin falls back to the matching
//      environment variable (ANTHROPIC_API_KEY / VSTAI_MODEL / VSTAI_COMPILER /
//      VSTAI_OLLAMA_URL). All of these can also be set at
//      runtime from the plugin's "Keys…" dialog (stored in your user settings),
//      which takes precedence over the values below.
// =====================================================================

#pragma once

// Your Anthropic API key (used for the REST call that generates plugins).
#define VSTAI_CONFIG_API_KEY  ""

// Model id. Empty -> "claude-opus-4-8".
#define VSTAI_CONFIG_MODEL    ""

// Absolute path to the bundled AssemblyScript compiler executable
// (vstai-asc, built with compiler/build.sh). Empty -> the plugin looks for
// it next to its own binary / in a sibling Resources folder, then $VSTAI_COMPILER.
#define VSTAI_CONFIG_COMPILER ""

// Optional: base URL of a local Ollama server for running open models with no
// key (e.g. "http://localhost:11434"). Empty -> $VSTAI_OLLAMA_URL / $OLLAMA_HOST
// / the dialog value / the default localhost port.
#define VSTAI_CONFIG_OLLAMA_URL ""

// Optional: your GLM (Zhipu / Z.ai) API key (OpenAI-compatible). Empty ->
// $GLM_API_KEY or the key entered in the plugin's "Keys…" dialog.
#define VSTAI_CONFIG_GLM_API_KEY ""

// Optional: GLM API base URL (OpenAI-compatible, no trailing /chat/completions).
// Empty -> $GLM_BASE_URL or the Z.ai default (https://api.z.ai/api/paas/v4).
// Use https://open.bigmodel.cn/api/paas/v4 for the mainland-China endpoint.
#define VSTAI_CONFIG_GLM_URL ""
