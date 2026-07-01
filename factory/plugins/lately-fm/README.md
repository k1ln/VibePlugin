# Lately FM — FM with operator waveforms

Models target: **Synths #56 — Yamaha TX81Z** (FM with multiple operator waveforms).

A 2-operator FM voice whose signature — distinct from sine-only FM synths — is its **selectable
operator waveforms** (sine, half-sine, abs-sine, quarter, even, square-ish). Non-sine waves give
reedy, buzzy, hollow timbres — the famous "Lately Bass". A modulator with feedback phase-modulates
a carrier (both using the chosen wave), with a brightness/modulator decay and amp ADSR. 8-voice
poly, no host imports, no allocation in `process()`.

### Controls
- **Wave** — operator waveform (Sine / Half / Abs / Quarter / Even / Square).
- **Ratio** — modulator:carrier ratio (stepped musical set).
- **FM Depth** — modulation index (brightness).
- **Feedback** — modulator self-feedback (grit).
- **Decay** — brightness/modulator decay.
- **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors).
