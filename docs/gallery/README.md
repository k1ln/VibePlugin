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

## Layout

```
docs/gallery/
  index.html  app.js        gallery list + search (reads data/index.json)
  play.html   player.js     live player (loads data/<id>.vstai)
  worklet.js                AudioWorklet DSP host (same ABI as src/WasmAbi.h)
  data/*.vstai              the published synths/effects (committed)
  data/index.json           generated catalogue — DO NOT edit by hand
  samples/*.wav             120 synthesised, copyright-free test loops
  samples/index.json        generated sample list
```

## Adding / regenerating

```sh
# add a .vstai to docs/gallery/data/, then:
node scripts/build-gallery.mjs     # rebuild data/index.json
node scripts/gen-samples.mjs       # (re)generate the royalty-free samples
```

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
