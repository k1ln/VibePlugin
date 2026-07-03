# Deep-Detail Rebuild Playbook

How to rebuild a factory synth at **full manual fidelity** — the Seer Six standard
(`factory/plugins/seer-six/` is the reference implementation; read its `README.md`,
`spec.json`, `assembly.ts` and `gui.html` before starting).

The old factory builds (~6–8 params, generic voice) were judged *not good enough*.
The bar now: read the original hardware's operation manual **cover to cover** and
implement **every program parameter** it documents. Do not forget one tiny bit —
the hidden shapes, the polarity conventions, the switch interactions, the weird
edge-case rules. Those details are the whole point.

## Non-negotiable rules

1. **Keep the existing plugin name and slug exactly** (e.g. "Fat Mono" / `fat-mono`)
   so the gallery entry is replaced, not duplicated. Never use the trademarked
   original name as the plugin name (fine inside README/`explanation` as
   "modelled on…").
2. **≤ 64 host params** (hard ABI cap). Never drop a hardware feature to fit —
   bit-pack switch groups instead (see below).
3. Never commit a manufacturer's PDF to the repo. Download to `mktemp -d`.
4. Do NOT edit global files: `factory/README.md`, `factory/REBUILD-QUEUE.md`,
   `docs/gallery/index/anything`, other plugins. Do NOT run `scripts/build-gallery.mjs`
   (the coordinator does; concurrent runs race).
5. Every deliverable gate below must PASS before you report success — no
   "should work". Report failures honestly.

## Pipeline

### 1. Get the documentation
- WebSearch for the original's operation/owner's manual PDF ("<synth> owner's
  manual pdf", manufacturer sites, archive.org, manuals.fdiskc.com, synthxl.com).
- `curl -sL -o $(mktemp -d)/manual.pdf <url>`, confirm with `file` (real PDF, not HTML).
- **Read every page** with the Read tool (`pages: "1-20"`, then 21–40, … — 20 pp max
  per call; scanned manuals render as images and are still readable).
- The **MIDI implementation / parameter appendix** (NRPN/CC/sysex table), if present,
  is your completeness checklist. Otherwise enumerate every front-panel control and
  every function documented in the text (incl. hidden/button-combo features).

### 2. Design the param map (`spec.json`)
- One host param per continuous knob/slider. Bit-pack groups of on/off switches into
  one mask param; pack N-way selectors as `0..N-1` ints; mixed-radix-pack a selector
  pair that shares a section if you're out of slots. The GUI must still show every
  individual switch.
- `min`/`max`/`default` real; `step: 1` on discrete params. Bipolar knobs: `min: -1`.
- Include performance controls the hardware has: pitch bend wheel/lever (+range if
  the hardware sets one), mod wheel, aftertouch pressure if the hardware has it.
- Defaults = a good musical patch (this is what the gallery preview renders).
- Spec fields: `name` (existing!), `isInstrument: true`, `explanation` (dense,
  accurate), `assembly`, `out`, `guiFile`, `theme` (accent colors fitting the
  hardware's livery), `publishedAt`, `params`.

### 3. Write the DSP (`assembly.ts`)
VibePlugin WASM ABI (see any factory plugin):
- exports `init(sr, maxFrames, ch)`, `process(n)`, `getInputPtr/getOutputPtr/getParamsPtr`,
  `getNumParams`, `noteOn(id, freqHz, vel)`, `noteOff(id)`；buffers are `StaticArray<f32>`,
  planar stride 8192, params array of 64 f32.
- AssemblyScript, `--runtime minimal`, no imports, no allocation in `process()`.
  All state = module-scope `StaticArray`s. `Mathf.*` for f32 math. No closures.
  Compile: `node compiler/asc-driver.mjs <assembly.ts> /tmp/x.wasm`.
- In `init()` set `params[]` to the spec defaults (host may render before pushing).

Quality bar learned on Seer Six:
- polyBLEP band-limited saw/pulse edges (copy the helpers), phase-accurate hard sync,
  real per-voice polyphony with oldest-steal, per-voice filters.
- Ladder LPF: add passband makeup `* (1 + k*0.75)` or the patch will be whisper-quiet.
- Envelopes: linear attack, exponential-approach decay/release
  (`env += (target-env) * (1-exp(-4/(t*sr)))`), times ~1 ms–10 s exponential knobs.
- Voice-sum scale ~0.5, output gain `vol²*2.4`, final `Mathf.tanh()` stage.
  Target with defaults + held note: **rms ≥ 0.03, peak 0.15–0.5**, `peak ≤ 1` always.
- Implement the *behavioral* features too, not just tone: arp/seq/chord/hold/glide
  modes/LFO retrigger rules/velocity routing — whatever the manual documents.
- Sequencers record via `noteOn` while a record param bit is set; GUI rest/tie-style
  markers use negative note ids (seer-six uses −2/−3).

### 4. Test the DSP
- `factory/plugins/<slug>/test-params.json`: copy of the spec params with performance
  state engaged so *every* param can prove itself in an automated single-note sweep
  (pressure > 0, wheel slightly off-center, arp/glide on, etc. — seer-six README
  explains why). Commit this file.
- `node factory/tools/wasm-runner.mjs /tmp/x.wasm --params factory/plugins/<slug>/test-params.json --seconds 3`
  → must print `VERDICT: PASS` and **every param `✓ affects`**. If a param is inert,
  fix the DSP or the test defaults — don't ship it inert.
- Also run with the real `spec.json` → PASS (levels sane).
- `factory/plugins/<slug>/behavior-test.mjs` (crib from
  `factory/plugins/seer-six/../../..`-scratch pattern in seer-six README): exercise the
  synth-specific behaviors (seq/arp/hold/chord/unison/glide/whatever the hardware has)
  with measurable assertions (rms windows, zero-crossing rate for pitch). All must pass.

### 5. Bespoke GUI (`gui.html`)
- A panel that *echoes the hardware's layout and livery* (sections, ordering, switch
  styles, colors) with the plugin's own name on it. Borrow the widget framework from
  `factory/plugins/seer-six/gui.html` (knob/bitBtn/selector/wheel builders + PD table)
  and restyle it — sliders for slider-based hardware (Junos, Jupiters, CS), rocker
  switches, etc.
- Every packed param decodes into its individual switches. Push all defaults on
  `vstai.onReady`. Guard every `window.vstai` call (must run standalone too).
- **Host readback is mandatory.** Inside `ready()`, after pushing defaults, register
  `window.vstai.onParam(function(i, v){ if(!(i in vals)) return; vals[i]=+v; var
  ls=listeners[i]; if(ls) for(var j=0;j<ls.length;j++) ls[j](); })`. Without this the
  knobs render at hardcoded defaults and never follow the host — after a project/preset
  restore or DAW automation they show the WRONG position ("knobs are off"). Every widget
  already registers `listen(idx, repaint)`, so this one handler repaints all of them.
  The host pushes natural (not normalized) values — same units the GUI sends via `setParam`.
- **Knob/slider integer-snapping must not catch bipolar continuous params.** The `setN`
  helper snaps discrete params to integers, but a naive `if (p.max-p.min >= 2) v=round(v)`
  ALSO snaps bipolar continuous knobs (`min:-1, max:1`, range 2) to −1/0/1 — fine tune,
  master tune, detune, pan, pitch-wheel become unusable ("knobs jump instead of turning").
  Guard it with `p.min >= 0`: discrete selectors are always `0..N-1`, bipolar continuous
  are `-1..1`, so `if (p.min >= 0 && p.max-p.min >= 2 && (p.max-p.min)%1===0) v=round(v)`
  snaps the selectors and leaves the bipolar knobs smooth.
- `node factory/tools/gui-check.mjs factory/plugins/<slug> --shot /tmp/<slug>.png`
  → `GUI CHECK: PASS` (0 errors, 64-or-N params pushed). Then **Read the screenshot
  and look at it** — fix overlapping labels, broken layout, invisible controls.

### 6. Pack + document
- `node factory/tools/pack-vstai.mjs factory/plugins/<slug>/spec.json`
  (writes `<slug>.vstai`, `test.html`, gallery copy).
- Preview: `node factory/tools/wasm-runner.mjs /tmp/x.wasm --params factory/plugins/<slug>/spec.json --seconds 4 --wav factory/plugins/<slug>/preview.wav`.
- `factory/plugins/<slug>/README.md`: manual title/version/page count you read, a
  **manual-section → implementation coverage table**, the param packing table, test
  evidence, and honest notes on anything simplified or out of scope.

### 7. Report back (to the coordinator)
Manual (title, version, pages read) · param count & packing summary · wasm-runner
result (all-affects? y/n) · behavior tests run & results · gui-check JSON · screenshot
path · list of signature "tiny bits" implemented · deviations/simplifications.
