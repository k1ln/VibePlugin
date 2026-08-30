# Developing VibePlugin

Build-from-source, architecture, and internals. For installing and using the
released plugin, see the [README](../README.md).

---

## Architecture

```
        ┌──────────────────────────── VibePlugin (C++ / JUCE) ────────────────────────────┐
prompt ▶│  Editor (WebView GUI + prompt bar)                                            │
        │     │ window.vstai.setParam / noteOn / noteOff                                │
        │     ▼                                                                         │
        │  AudioProcessor ──▶ WasmEngine (wasmtime) ◀── plugin.wasm (the DSP)            │
        │     │                                                                         │
        │     ├─ LlmClient ─── HTTPS ──▶ Claude (your key) or VibePlugin Cloud credits  │
        │     │       │ { assembly, html, params }  (structured / JSON output)         │
        │     │       ▼                                                                 │
        │     └─ AssemblyScriptCompiler ──▶ execs bundled vstai-asc ──▶ plugin.wasm     │
        │             (direct exec, no shell; compile errors fed back to the model ≤3×) │
        └───────────────────────────────────────────────────────────────────────────────┘
```

You type a prompt; Claude generates an **AssemblyScript** DSP module and an
**HTML** GUI; the AssemblyScript is compiled to **WebAssembly** by a compiler
that **ships inside the plugin**; the WASM runs under **wasmtime**; the HTML is
shown in an embedded WebView. Each plugin saves to a portable **`.vstai`** file
and reloads later — and you can keep prompting to evolve it.

One core builds two products, selected by `VSTAI_IS_SYNTH` at build time:

| | `VibePlugin FX` | `VibePlugin Synth` |
|---|---|---|
| Type | audio effect | instrument (`IS_SYNTH`) |
| Buses | stereo in + out | stereo out, MIDI in |
| DSP ABI | reads input, writes output | `noteOn(id, freq, vel)` / `noteOff(id)` + writes output |
| Notes | — | host converts MIDI note→Hz; GUI keyboard via `window.vstai.noteOn/noteOff` |

---

## How AssemblyScript gets compiled (no toolchain on the user's machine)

`asc` (the AssemblyScript compiler) is JavaScript, and its optimizer backend
**Binaryen is a WASM module that needs a real `WebAssembly` engine**. A JS engine
compiled to WASM (QuickJS/Javy) has none, so `asc` can't run inside wasmtime
(verified: it aborts with *"no native wasm support detected"*). So the compiler
ships as a **self-contained JS runtime (V8) with `asc` baked in** — one file
`vstai-asc` (via `deno`/`bun --compile`), or `vstai-node` + `asc-bundle.mjs`. The
plugin **execs it directly** (JUCE `ChildProcess`, no shell) — AssemblyScript file
in, compiled WASM out — and feeds any compile error back to Claude (≤3×). Build it
once with [`compiler/build.sh`](../compiler/build.sh); see
[compiler/README.md](../compiler/README.md).

The generated DSP still runs under **wasmtime**. The only network use is
generating a *new* plugin; a saved `.vstai` runs with no network.

---

## Generation paths (Manual / Anthropic / Cloud)

The **Model** dropdown picks who writes the plugin.

| Option | Models | Key / account | How |
|---|---|---|---|
| **Manual** (free) | any chatbot you have | **none** | copy the prompt → paste into ChatGPT/Claude/etc → paste the reply back |
| **Anthropic — your key** | Fable 5, Opus 5, Sonnet 5 | your Anthropic API key | `api.anthropic.com/v1/messages` (structured outputs + thinking) |
| **VibePlugin Cloud — credits** | Cloud · Haiku 4.5 / Sonnet 5 / Opus 4.8 | sign in via **Account** (pay-as-you-go credits) | proxied through the hosted server — no API key needed |

**Manual ("bring your own chatbot")** is the free, no-API-key, no-account path.
**Copy to chatbot** copies a self-contained prompt; paste the full reply back and
click **Apply** — the plugin extracts the fenced `assemblyscript` / `html` /
`json` blocks and compiles them. This prompt is deliberately **different** from
the API prompt: no JSON output schema to enforce, so it asks for clearly fenced
blocks instead. A failed compile shows the error and a **Copy fix request**
button. See [`Prompt.h`](../src/Prompt.h) (`buildManualPrompt` /
`parseManualReply`).

**Anthropic (your key)** — paste your `sk-ant-…` key in **Settings** (stored in
user settings, taking precedence over `Config.h` / `ANTHROPIC_API_KEY`). A
**Thinking** depth control applies to Claude models. The ≤3× compile-error retry
loop applies to every API generation.

**VibePlugin Cloud (credits)** — **Account** ▸ sign in; generations are billed
against pay-as-you-go credits, proxied by the hosted server so you never handle
an API key.

> The `LlmClient` backend also speaks **GLM (Z.ai)** and local **Ollama**, but
> both are currently **hidden from the dropdown** (Anthropic-only for now).
> Re-enable them in `modelCatalog` ([`src/WebEditor.cpp`](../src/WebEditor.cpp)).

---

## Compiled-in config (API key baked into the binary)

Copy [`src/Config.example.h`](../src/Config.example.h) → `src/Config.h`
(gitignored) and fill in your key:

```cpp
#define VSTAI_CONFIG_API_KEY  "sk-ant-..."
#define VSTAI_CONFIG_MODEL    ""            // empty -> claude-opus-4-8
#define VSTAI_CONFIG_COMPILER ""            // empty -> found next to the plugin
```

It's compiled into the plugin, so no environment is needed at runtime. Any empty
value falls back to the env var (`ANTHROPIC_API_KEY` / `VSTAI_MODEL` /
`VSTAI_COMPILER`). You can also enter keys at runtime in **Settings**.

⚠️ The key is embedded in clear text (extractable with `strings`) — only ship a
scoped key you're comfortable distributing. Distributed builds must ship with
these values **empty** so the only paid path is the credits server.

---

## The `.vstai` file

Plain JSON, saveable anywhere and reloadable; the same JSON is the DAW session
state, so reopening a project restores the exact plugin:

```jsonc
{
  "format": 1, "name": "Tape Saturator", "isInstrument": false,
  "promptHistory": ["a warm tape saturator…", "add wow & flutter"],
  "assembly": "…AssemblyScript source…",
  "html": "…GUI document…",
  "wasmBase64": "AGFzbQ…",          // the compiled WASM, base64
  "params": [{ "name": "Drive", "index": 0, "min": 0, "max": 1, "default": 0.3, "value": 0.5 }],
  "explanation": "…",
  "locked": false                   // true in an exported/whitelabel plugin (opens locked, no editor)
}
```

"Talking again" sends `assembly` + `html` back to Claude with the new prompt, so
it edits in place.

---

## Export & share a creation

- **Save `.vstai`** — the portable JSON above. Anyone running VibePlugin can **Load** it.
- **Publish** to the web **gallery** — uploads the `.vstai` to the catalogue;
  each entry plays live in the browser (the WASM in an AudioWorklet) and is
  downloadable. Static site under [`docs/gallery/`](gallery/).
- **Export plugin… (whitelabel)** — turn the loaded creation into a
  **standalone, locked `.vst3`**. It opens straight into the product GUI — no
  prompt, no editor (see [`LockedEditor`](../src/LockedEditor.h)). It **copies
  the running bundle** (no rebuild), bakes the creation in, gives the copy its
  **own VST3 id + product name** (in-place binary patch, so it coexists with
  VibePlugin and other exports), **strips** the bundled compiler + editor shell
  (≈170 MB → ≈30 MB), and re-signs. With a **notarytool profile** in
  **Settings** it also notarizes + staples. See
  [`src/PluginExport.h`](../src/PluginExport.h).

---

## Editing the code by hand

The editor is an HTML single-page app served from the bundle and shown in a
WebView ([`WebEditor.*`](../src/WebEditor.cpp) + [`ui/`](../ui/); the legacy
native JUCE editor [`PluginEditor.*`](../src/PluginEditor.cpp) is still there as a
fallback, toggled by the `useWebShell` setting). Tabs:

- **GUI** — the live plugin (the generated GUI, sandboxed in an `<iframe>`).
- **DSP (AssemblyScript)** / **GUI HTML** — Monaco editors for the `index.ts` DSP
  and the GUI document.
- **Notes** — the model's explanation + the latest compiler diagnostics.
- **History** — the prompt browser: every version (generate / AI-fix / hand-compile).
- **Standard UI** / **Settings** — edit the house-style component kit, pick a
  design school, and set keys / publish URL / notarization profile.

Edit either source and **Save & Compile** (or `Cmd/Ctrl+S`): the AssemblyScript
is recompiled to WASM and, on success, the engine + GUI reload live. On failure
the previous plugin keeps playing and the compiler errors show in **Problems**.
**Fix with AI** hands the current source (plus errors) to the selected model to
repair — same ≤3× compile-retry loop as generation. **Revert** restores the last
compiled source. The code editors are **Monaco**, shipped offline inside the
bundle; no external editor and no network either way.

The **History** tab snapshots every successful version onto an append-only
timeline. Pick any entry and **Restore** (or double-click) to load it — engine,
GUI, and editors all roll back. The timeline never truncates; generating again
after stepping back branches. The last ~25 snapshots are kept in the `.vstai`
file and the DAW session.

---

## Build & run

### Quick start — scripts (macOS)

Two scripts build everything and **publish to your local VST3 folder, signed** so
a DAW will load them. They auto-build the bundled compiler and auto-download the
wasmtime c-api on first run.

```bash
./scripts/build.sh       # Release  -> ~/Library/Audio/Plug-Ins/VST3, code-signed
./scripts/dev.sh         # Debug + file logging (development mode), same place
./scripts/dev.sh --tail  # follow the dev log
```

Then rescan in your DAW. There's also a Standalone `.app` under
`build*/…/Standalone/` for quick testing without a DAW.

Signing identity: the scripts prefer a **Developer ID Application** cert, else the
first code-signing identity, else ad-hoc (local-only). Override with
`VSTAI_SIGN_ID="Developer ID Application: …" ./scripts/build.sh`. See
[Signing](#signing--gatekeeper-macos).

### Development mode

`scripts/dev.sh` builds with `-DVSTAI_DEV_MODE=ON`, turning on a file logger
(`src/DevLog.h`) that traces the whole generate → compile → load pipeline (the
prompt, the Claude HTTP status, the exact compiler command, compile diagnostics,
wasm size). In a DAW you can't see stdout, so it writes to:

```
~/Library/Logs/VibePlugin/VibePlugin FX.log
~/Library/Logs/VibePlugin/VibePlugin Synth.log
```

`VSTAI_LOG(...)` compiles to nothing in release builds. Dev and release use
separate build dirs (`build-dev` / `build`); installing one replaces the other in
the VST3 folder, so rescan after switching.

### Testing the knobs (no DAW)

`scripts/test.sh` drives the real `WasmEngine` headlessly to verify the knob/note
path between the GUI and the DSP:

```bash
./scripts/test.sh                 # regression tests: protocol + reference effect/synth
./scripts/test.sh MyPlugin.vstai  # sweep every param of a saved plugin
```

The reference run asserts the bridge URL protocol parses and that the gain,
cutoff, and synth-level knobs change the audio. The `.vstai` run sweeps each
parameter min→max and reports `OK affects audio` / `DEAD does nothing` / `?? no
audio`. It exits non-zero if any knob is dead, so it doubles as a CI gate. The
GUI↔host wire format lives in one header, [`src/BridgeProtocol.h`](../src/BridgeProtocol.h).

### Signing / Gatekeeper (macOS)

On Apple Silicon a plugin must be code-signed to load. The scripts sign for you;
the one-time setup is getting a valid signing identity:

- An **Apple Development** cert (Xcode ▸ Settings ▸ Accounts ▸ Manage
  Certificates) is enough for local use. Verify with
  `security find-identity -v -p codesigning` (must show ≥ 1 identity).
- If signing fails with *"unable to build chain to self-signed root"*, import the
  current **WWDR G3** intermediate and **Apple Root CA** from
  <https://www.apple.com/certificateauthority/>.
- The dev build signs with **no hardened runtime**: the DSP (wasmtime) and the
  bundled compiler (V8) both JIT, which hardened runtime blocks without extra
  entitlements — fine for local use.
- For **distribution**, **Export plugin…** hardened-runtime signs the export
  (Developer ID + JIT entitlements) and, with a notarytool profile in Settings,
  notarizes + staples it. The locked export carries only the WASM, so wasmtime is
  the only JIT'ing binary left to entitle.

### Manual build

**1. Build the bundled compiler once** (dev-time; needs Node 18+ to build):

```bash
cd compiler && ./build.sh
```

`build.sh` downloads a portable Node runtime for the system you run it on
(official single-binary build) and bundles `asc` into `asc-bundle.mjs`. Output is
`vstai-node` + `asc-bundle.mjs` (~124 MB), or a single `vstai-asc` if you have
`deno`/`bun`. See [compiler/README.md](../compiler/README.md).

**2. Put your Claude key in** (compiled into the plugin):

```bash
cp src/Config.example.h src/Config.h   # then edit src/Config.h
```

Set `VSTAI_CONFIG_API_KEY "sk-ant-..."`. Baked into the binary; leave empty to
use the `ANTHROPIC_API_KEY` env var. `Config.h` is gitignored. ⚠️ Extractable
with `strings` — use a scoped key.

**3. Build the plugins** (CMake + JUCE 8 + wasmtime):

Download a prebuilt **wasmtime c-api** release for your platform from
<https://github.com/bytecodealliance/wasmtime/releases> (the `…-c-api` asset),
extract it, then:

```bash
cmake -B build -DWASMTIME_DIR=/path/to/wasmtime-vXX.X.X-<platform>-c-api
cmake --build build --config Release
```

JUCE is fetched automatically. Both products build (VST3 + Standalone). Ship the
compiler from step 1 next to the plugin (or point `VSTAI_CONFIG_COMPILER` /
`$VSTAI_COMPILER` at it). On Linux, HTTPS links libcurl automatically.

---

## Layout

```
src/                         C++ (shared by both plugins)
  WasmAbi.h                  the host<->WASM contract (source of truth)
  BridgeProtocol.h / BridgeShim.h   GUI<->host wire format + the injected window.vstai shim
  Prompt.h                   system prompt + output schema  ← "the prompt"
  Config.example.h           copy to Config.h to bake in the API key
  Settings.h / AppSettings.h resolved config (compiled-in/env) + runtime keys/URLs/notary
  Designs.h                  the 10 built-in design schools (house-style kits)
  LlmClient.* / CloudClient.* raw HTTPS to Claude (your key) or the hosted Cloud proxy (credits)
  AccountPanel.h             "Account…" dialog: cloud sign-in + credits balance
  ManualPanel.h              "bring your own chatbot" dialog (copy prompt / paste reply)
  AssemblyScriptCompiler.*   execs the bundled compiler -> WASM
  WasmEngine.*               wasmtime wrapper; audio + synth notes
  VstaiDocument.*            the .vstai JSON model (+ DAW state, lock flag)
  PluginProcessor.*          audio/MIDI + state + generate/compile loop + export
  WebEditor.* + WebAssets.h  the default editor: an HTML/Monaco WebView shell (loads ui/)
  LockedEditor.*             product-only editor for an exported/whitelabel plugin
  PluginExport.h             "Export plugin…": copy + bake + re-identify + sign a standalone .vst3
  PluginEditor.* / SourceEditor.h / HistoryPanel.h   legacy native editor (fallback)
ui/                          the WebView editor SPA (shell.html/js/css + Monaco) and designs/
compiler/                    builds the bundled AssemblyScript compiler
  asc-driver.mjs             <in.ts> in, <out.wasm> out
  build.sh                   esbuild + (deno/bun/node) -> vstai-asc
wasm-template/assembly/      reference AssemblyScript: index.ts (effect), synth.ts
docs/gallery/                static web gallery — play creations live, download them as .vstai
web/                         the default starter GUI
```

The credits backend is **not** in this tree — it's a separate private repo
(`VibePlugin-server`).

---

## Notes & limits

- ABI: planar f32, ≤ 8192 frames/block, ≤ 2 channels, ≤ 64 params (see
  [`WasmAbi.h`](../src/WasmAbi.h)). Generated modules are sandboxed (no imports,
  no host calls).
- If no module is loaded (or while one swaps in), audio passes through.
- Generated GUIs are offline/self-contained (no CDN/network) — they only talk to
  the host through `window.vstai`.
- The REST calls are non-streaming with a 10-minute timeout; switch `LlmClient`
  to streaming for very large generations. Very large GUIs are best generated
  with the strongest model (Opus 4.8).
- Treat generated code as untrusted: DSP runs in the WASM sandbox, the GUI in an
  embedded WebView. Don't paste secrets into prompts.
