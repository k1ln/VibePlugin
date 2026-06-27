# compiler — building the bundled AssemblyScript compiler

The plugin compiles Claude's AssemblyScript to WASM by running a **self-contained
compiler that ships inside the plugin** — no Node or tools on the end user's
machine. This folder builds it, once, at development time.

## Why a JS runtime and not a WASM module

`asc` (the AssemblyScript compiler) is JavaScript, and its optimizer backend
**Binaryen is an Emscripten WASM module that calls `WebAssembly.instantiate`**.
A JS engine compiled to WASM (QuickJS/Javy) has **no `WebAssembly`** inside it,
so `asc` aborts there with *"no native wasm support detected"* (verified). It
needs a real WebAssembly-capable JS engine — i.e. V8/JSC/SpiderMonkey. So the
compiler is a bundled JS **runtime** (V8) with `asc` baked in.

## Build

```bash
./build.sh                       # uses Node 22 by default
NODE_VERSION=v20.18.1 ./build.sh  # pin a different runtime version
```

It bundles `asc` + [`asc-driver.mjs`](asc-driver.mjs) into one ESM file
(`asc-bundle.mjs`, ~10 MB) and provides a runtime, producing one of:

| Output | Produced when | Plugin runs |
|---|---|---|
| `vstai-asc` (single file) | `deno` or `bun` is installed | `vstai-asc <in.ts> <out.wasm>` |
| `vstai-node` + `asc-bundle.mjs` | otherwise | `vstai-node asc-bundle.mjs <in.ts> <out.wasm>` |

When neither `deno` nor `bun` is present, `build.sh` **downloads an official Node
single-binary for the system you build on** (`darwin`/`linux`/`win` ×
`arm64`/`x64`) and uses that as the portable `vstai-node` — these official builds
are self-contained (no `libnode.*` dependency), unlike package-manager Node. Your
local node is only used to run the bundler.

The protocol is just: **`<in.ts>` in, `<out.wasm>` out**, diagnostics on stderr,
non-zero exit on failure. The plugin ([AssemblyScriptCompiler.cpp](../src/AssemblyScriptCompiler.cpp))
execs it directly (no shell) and feeds any compile error back to Claude.

## Shipping it with the plugin

Place the built file(s) where the plugin looks (see [Settings.h](../src/Settings.h)):

- next to the plugin binary, or in a sibling `Resources/` folder, or
- set `VSTAI_CONFIG_COMPILER` in `src/Config.h` (compiled in), or `$VSTAI_COMPILER`.

## Verify

```bash
node asc-bundle.mjs ../wasm-template/assembly/index.ts /tmp/fx.wasm   # effect
node asc-bundle.mjs ../wasm-template/assembly/synth.ts /tmp/synth.wasm # instrument
```

(Both produce a ~2 KB module exposing the ABI exports — `getInputPtr`, `process`,
… and `noteOn`/`noteOff` for the synth.)
