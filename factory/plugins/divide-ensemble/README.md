# Divide Ensemble — string + organ machine

Models target: **Synths #96 — Roland RS-09 / Logan String Melody** (string machine).

A divide-down **string + organ** machine, distinct from the lush Solina/Crumar string ensembles:
it blends a Strings voice (sawtooth) and an Organ voice (divide-down square) per key, with slow
attack/release and a wide three-voice ensemble chorus. Fully polyphonic (12 voices). No samples,
no host imports, no allocation in `process()`.

### Controls
- **Strings** — sawtooth string-section level.
- **Organ** — square divide-down organ level.
- **Attack / Release** — swell envelope.
- **Ensemble** — three-voice chorus depth/width.
- **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors).
