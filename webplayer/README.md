# VibePlugin web player & catalogue

A tiny, zero-dependency web app that hosts plugins published from the VibePlugin
editor and **runs their AssemblyScript/WASM DSP live in the browser** — synths
(on-screen keyboard + Web MIDI) and effects (mic, an uploaded audio file, or a
test tone as input). Anyone can browse, search, play, and download the published
`.vstai` files.

## Run the server

Needs Node 18+ (uses only the standard library).

```sh
node webplayer/server.mjs
# → http://localhost:8787      (data stored in webplayer/data/)

# override:
PORT=9000 DATA_DIR=/var/lib/vstai node webplayer/server.mjs
```

Then open <http://localhost:8787>.

## Publish from the host

1. In the VibePlugin editor open **Keys…** and set **Publish server URL** to the
   server's base URL (e.g. `http://localhost:8787`).
2. Generate or compile a plugin, then press **Publish**.
3. The status line shows the public play link. The plugin now appears in the
   catalogue for anyone with access to the server.

The host POSTs the `.vstai` JSON (name, params, GUI HTML, compiled WASM as
base64, effect/synth flag) to `POST /api/publish`. Nothing is sent until you
press Publish.

## How playback works

The DSP WASM module implements the same ABI as the desktop host (`src/WasmAbi.h`).
In the browser it runs inside an **AudioWorklet** (`public/worklet.js`):

- `init / process / getInputPtr / getOutputPtr / getParamsPtr / getNumParams`
- optional `noteOn / noteOff` (synths) and the optional sample buffer
  (`getSamplePtr / getSampleCapacity / setSampleInfo`)

The plugin's GUI runs in a **sandboxed iframe** (no same-origin access — it's
arbitrary published HTML) with a `window.vstai` shim that forwards
`setParam` / `noteOn` / `noteOff` / `loadSample` to the worklet via `postMessage`.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/publish` | Store a `.vstai` JSON; returns `{id, url}` |
| `GET`  | `/api/plugins?q=` | Search/list (name + description) |
| `GET`  | `/api/plugins/:id` | Player metadata (name, params, GUI HTML, wasm URL) |
| `GET`  | `/api/plugins/:id/plugin.wasm` | The compiled module (binary) |
| `GET`  | `/api/plugins/:id/download` | The `.vstai` file (loads back into the host) |

## Security notes

- Published GUIs are **untrusted user HTML/JS**; they run only in a
  `sandbox="allow-scripts"` iframe with an opaque origin, so they can't read the
  catalogue page, its storage, or cookies.
- There is **no authentication** on publishing — run it on a trusted network, or
  put your own auth/reverse-proxy in front before exposing it publicly.
- Microphone input requires a secure context (`https://` or `localhost`).
