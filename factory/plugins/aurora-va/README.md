# Aurora VA — virtual-analog lead

Models target: **Synths #98 — Clavia Nord Lead** (virtual analog).

A clean modern VA lead, distinct from the hypersaw VA (Hyper VA): a single morphable oscillator
whose **Shape** control sweeps continuously sine → triangle → saw → pulse, with oscillator **Sync**
for bite, a clean resonant SVF low-pass with its own envelope, and a snappy amp envelope. 8-voice
poly. No samples, no host imports, no allocation in `process()`.

### Controls
- **Shape** — oscillator waveform morph (sine→tri→saw→pulse).
- **Cutoff / Resonance** — low-pass filter.
- **Sync** — oscillator hard-sync amount (edge/bite).
- **Env Amount** — filter-envelope depth.
- **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors) — Nord-red panel, live morphing oscillator.
