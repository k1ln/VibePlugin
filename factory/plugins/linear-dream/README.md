# Linear Dream — LA synthesis

Models target: **Synths #22 — Roland D-50** (Linear Arithmetic synthesis).

The signature late-80s LA architecture: each note layers a short **PCM attack transient** over a
**synthesised sustain body**. Three original attack samples (mallet, blown, pluck) are baked in as
base64 Int16 PCM @ 22050 Hz (C3), decoded at `init()` and played once at note onset (pitched); a
sawtooth body runs through a per-voice resonant SVF low-pass with a decaying filter envelope and an
amp envelope; the 8-voice mix passes through a lush built-in chorus. No host imports, no allocation
in `process()`.

### Controls
- **Attack** — transient type: Mallet / Blown / Pluck.
- **Cutoff / Resonance** — body filter.
- **Env Amount** — filter-envelope depth (the body's opening sweep).
- **Chorus** — built-in stereo chorus depth.
- **Level** — output.

### Embedded audio — source & license
The three attack transients are **original, self-authored CC0 content**: short mallet/blown/pluck
onsets synthesised offline in a small Node script, peak-normalised, and baked in. **No third-party
samples are used** — the `.vstai` is fully self-contained.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors). `test.html` plays it from the keyboard.
