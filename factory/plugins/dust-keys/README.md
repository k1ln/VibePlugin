# Dust Keys — lo-fi 8-bit sampler

Models target: **Synths #76 — Ensoniq Mirage** (lo-fi 8-bit sampler).

A polyphonic **melodic sampler** with the gritty character of an early 8-bit unit. One original
sampled instrument voice (a warm detuned choir/string pad) is baked in as base64 Int16 PCM @
22050 Hz (C3), decoded at `init()` and played back pitch-tracked through an 8-voice pool with a
**sustain loop**. The signature grit is a lo-fi stage — **bit-depth reduction + sample-rate
decimation** (the Bits knob) — into a resonant SVF low-pass and an ADSR. No host imports, no
allocation in `process()`.

### Controls
- **Cutoff / Resonance** — resonant low-pass filter.
- **Bits** — lo-fi amount: clean (≈13-bit) down to crunchy ~3-bit + heavy decimation.
- **Attack / Decay** — amp envelope (held-note shape).
- **Level** — output.

### Embedded audio — source & license
The sampled voice is **original, self-authored CC0 content**: a detuned-saw choir/string pad
synthesised offline in a small Node script, peak-normalised, and baked in. **No third-party
samples are used** — the `.vstai` is fully self-contained.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors). `test.html` plays it from the keyboard.
