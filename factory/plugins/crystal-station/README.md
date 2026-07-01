# Crystal Station — PCM workstation

Models target: **Synths #69 — Korg M1** (PCM workstation).

A polyphonic **multisample PCM player** in the late-80s digital-workstation lineage. Three
original sampled voices — a bright percussive **Piano**, an airy **Universe** pad, and an FM
**Bell** — are baked in as base64 Int16 PCM @ 22050 Hz (recorded at C3), decoded into one f32
buffer at `init()`, and played back pitch-tracked across the keyboard through an 8-voice pool with
an attack→decay amp envelope, a tone filter and a lush built-in stereo **chorus**. No host imports,
no allocation in `process()`.

### Controls
- **Voice** — Piano / Universe / Bell.
- **Attack** — amp attack time.
- **Decay** — held-note decay / length.
- **Tone** — brightness.
- **Chorus** — built-in stereo chorus depth (the signature digital shimmer/width).
- **Level** — output.

### Embedded audio — source & license
The three PCM voices are **original, self-authored CC0 content**: synthesised offline (additive
harmonic-stack piano, detuned-stack pad, FM bell) in a small Node script, peak-normalised, and
baked in. **No third-party samples are used** — the `.vstai` is fully self-contained.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors). `test.html` plays it from the keyboard.
