# Nova Six — DCO polysynth (high-pass)

Models target: **Synths #16 — Roland Juno-106**.

A 6-voice DCO polysynth. Distinct from the Juno-60-style voice (Juno Glow) by its signature
**high-pass filter**: a single stable DCO (saw + variable-pulse PWM) plus a square sub feeds a
resonant SVF low-pass with its own decay envelope, then a non-resonant one-pole high-pass that
carves the low end, into a lush BBD-style chorus. 8-voice pool, no host imports, no allocation in
`process()`.

### Controls
- **Cutoff / Resonance** — low-pass filter.
- **HPF** — high-pass corner (the 106's low-end carve).
- **Env Amount** — filter-envelope depth.
- **Chorus** — BBD-style stereo chorus.
- **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors).
