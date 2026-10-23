# VibePlugin gallery (static, runs on GitHub Pages)

A fully static gallery that **renders every published synth/effect in the browser**
and plays it live — the AssemblyScript/WASM DSP runs in an `AudioWorklet` with the
same ABI as the desktop plugin. No server, no build step at view time.

- **Synths** get an on-screen keyboard (also computer keys `a`–`k`, and Web MIDI).
- **Effects** get a dropdown of 120 royalty-free test samples, grouped by kind
  (plus test tone, mic, or your own file) so you can hear them work. The last
  sample you pick is remembered across plugins.

Published `.vstai` files already embed the compiled WASM (`wasmBase64`), the GUI
HTML, and the params — so the player just fetches the file, decodes the WASM, and
runs it. No in-browser compilation needed.

## Linking straight to a synth

Every plugin has a stable id (its filename in `data/`, e.g. `acid-bass`, `doob`).

| Link | Opens |
|---|---|
| `gallery/#<id>` | the gallery with that synth loaded and highlighted in the list (also `?id=<id>` / `?synth=<id>`) |
| `gallery/play.html?id=<id>` | the player on its own page, full window |

The address bar follows what you pick, so you can copy it as-is, and the **Copy link** /
**Open player** buttons in the header do the same. Audio starts on the first click or key
press (browsers don't allow it before). An unknown id falls back to the default pick.

## Layout

```
docs/gallery/
  index.html  app.js        gallery list + search (reads data/index.json)
  play.html   player.js     live player (loads data/<id>.vstai)
  worklet.js                AudioWorklet DSP host (same ABI as src/WasmAbi.h)
  data/*.vstai              the published synths/effects (committed)
  data/index.json           generated catalogue — DO NOT edit by hand
                            (each row has `category` + `categoryOrder`)
  webclap/*.wclap.tar.gz    one WebCLAP bundle per plugin (committed; rendered locally)
  webclap/index.json        generated: id -> { file, bytes, hash, params } — DO NOT edit by hand
  vst3/index.json           generated: id -> { macos|windows|linux: { file, bytes, sha256, cid, signed } }
                            plus `base`, the bucket URL the zips are downloaded from
  samples/*.wav             120 synthesised, copyright-free test loops
  samples/index.json        generated sample list
```

## Adding / regenerating

```sh
# add a .vstai to docs/gallery/data/, then:
node scripts/build-gallery.mjs     # rebuild data/index.json
node scripts/gen-samples.mjs       # (re)generate the royalty-free samples
```

### WebCLAP downloads

Every listed plugin also offers a **↓ WebCLAP** download (gallery row + player header): a
`.wclap.tar.gz` that browser hosts such as openDAW import via *Load Plugin → Import WebCLAP…*.
The bundles are rendered by the real "Export WebCLAP…" code path and each `module.wasm` is
smoke-tested (no imports, params in range, finite audio, state round trip) before it is kept:

```sh
cmake --build build-test --target vstai_webclap_export   # once: the headless exporter
node scripts/build-webclap-gallery.mjs                   # new/changed plugins only (content hash)
node scripts/build-webclap-gallery.mjs --force           # re-render everything
node scripts/build-webclap-gallery.mjs --only doob,acid-bass
```

Needs the bundled compiler (`compiler/build.sh`); rebuild it if the driver changed. Re-run after
adding a plugin or editing `ui/webclap/*`, then commit `webclap/`. CI doesn't render them (no
compiler/C++ toolchain there). Plugins that load samples are skipped — WebCLAP can't carry them yet.

### VST3 downloads (macOS / Windows / Linux, hosted in a Scaleway bucket)

Each plugin can also be downloaded as a **locked, signed, whitelabel `.vst3`** — the same thing the
editor's *Export plugin…* makes (its own VST3 id + name, GUI only, no authoring chrome). They are
~11 MB each, ~2.2 GB per OS for the catalogue, so the zips live in a Scaleway Object Storage bucket
(`<id>-<os>.zip`, public-read) and only the small manifest `vst3/index.json` is in the repo. The
**↓ VST3 ▾** menu appears once the manifest has a `base` URL and entries.

```sh
cmake -B build -DCMAKE_BUILD_TYPE=Release …                       # as for a release build
cmake --build build --target VibePlugin_Synth_VST3 VibePlugin_FX_VST3 vstai_export_vst3
node scripts/build-vst3-gallery.mjs --notary vibeplugin           # THIS OS: export, sign, (notarize), zip
node scripts/build-vst3-gallery.mjs --only doob --force           # one plugin
SCW_BUCKET=… AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
  node scripts/build-vst3-gallery.mjs --upload                    # sync this OS's zips to the bucket
```

* **macOS** is rendered locally (needs the Developer ID cert; `--notary <profile>` notarizes and
  staples each — ~30 s each, an Accepted ticket is required or the plugin is rejected).
* **Windows + Linux** are rendered by `.github/workflows/gallery-vst3.yml` (manual run), which also
  uploads and merges its columns into `vst3/index.json`. Windows zips are Authenticode-signed only
  if the `WIN_SIGN_PFX_BASE64` secret is set; Linux VST3s have no signing convention.
* Every export is checked before it is kept: valid signature (macOS), and a **unique VST3 id across
  the whole set** (a copy that kept VibePlugin's shared id is rejected). Re-runs are cached by a hash
  of the `.vstai` + the source plugin binary.
* Bucket setup: create a bucket (e.g. `vibeplugin-gallery`, region `fr-par`), enable public read for
  objects, and create an API key pair with write access. The public URL is
  `https://<bucket>.s3.<region>.scw.cloud/vst3/` (pass `--base` or set `SCW_BUCKET` to record it).

### Categories

Every plugin is filed under one category (Reverb, Analog Synths, Drum Voices, …), shown
as section headings and filter chips in this page and in the plugin's in-editor
**Gallery** browser. The mapping lives in `factory/gallery-categories.json`: `synth` and
`effect` list the categories in display order, and `assign` maps a plugin id to one of
them. **Add a new plugin's id there** before rebuilding the catalogue — `build-gallery.mjs`
warns about any listed plugin that has no category (it files it under "Other Synths" /
"Other Effects"). The web page and the editor read `category` straight from `index.json`,
so no other consumer needs touching.

The samples are **synthesised from scratch** in `scripts/gen-samples.mjs` (oscillators
+ noise + envelopes) — no recorded audio, so they carry no licence/copyright.

CI (`.github/workflows/gallery.yml`) reruns `build-gallery.mjs` whenever a `.vstai`
lands on `main`, keeping the catalogue in sync.

## Publishing from the plugin (review-before-publish)

GitHub Pages is read-only, so a "Publish" can't write here directly. The intended
flow lets anyone who has the plugin submit, with you reviewing first:

1. The plugin's **Publish** button POSTs the `.vstai` to a tiny **proxy**
   (a Cloudflare Worker holding a GitHub App credential — never shipped in the
   plugin).
2. The proxy commits the `.vstai` to a new branch and opens a **Pull Request**.
3. You review/play the PR, then **merge to publish** (or close to reject). CI
   rebuilds `index.json` and Pages redeploys.

The proxy is the only piece that needs a credential; the gallery itself stays a
free static site. The proxy + deploy guide live in [`proxy/`](../../proxy/) —
deployable to Scaleway Functions, Cloudflare Workers, or plain Node.
