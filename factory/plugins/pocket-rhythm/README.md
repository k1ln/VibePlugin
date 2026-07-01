# Pocket Rhythm — Latin rhythm box

Models target: **Synths #68 — Korg Mini-Pops / Rhythm** (preset rhythm box).

A vintage Latin preset rhythm box — distinct from the factory's kick/snare drum machines: an analog
**percussion** set synthesised in real time (bongo, conga, claves, maracas, cowbell, cymbal). A
MIDI note picks a voice (`note % 6`) into an 8-slot pool. No samples, no host imports, no allocation
in `process()`.

### Voices (note % 6)
0 Bongo · 1 Conga · 2 Claves · 3 Maracas · 4 Cowbell · 5 Cymbal

### Controls
- **Pitch** — membrane tuning (bongo/conga/cowbell).
- **Decay** — membrane length.
- **Shaker** — maracas / cymbal length.
- **Cowbell** — cowbell level/tone.
- **Tone** — overall brightness.
- **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors) — round percussion pads on a bossa pattern.
