# Brass Eight — fat multimode analog poly

Models target: **Synths #33 — Oberheim OB-Xa**.

A fat 8-voice analog polysynth — brighter and harder than an OB-X (Oberon), built for big brass
stabs and bright pads. Two detuned oscillators (saw + pulse) per voice give a thick unison; a
resonant state-variable filter whose **Mode** control morphs low-pass → band-pass → high-pass
shapes the tone, driven by its own filter envelope. No host imports, no allocation in `process()`.

### Controls
- **Cutoff / Resonance** — multimode filter.
- **Mode** — LP → BP → HP morph.
- **Env Amount** — filter-envelope depth.
- **Detune** — unison fatness (osc spread).
- **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors).
