# Vee Organ — combo organ

Models target: **Synths #92 — Vox Continental** (combo organ).

A bright, hollow "combo" organ — distinct from the reedy Farfisa-style Combo Organ. Each key sums
drawbar-weighted harmonic partials (sine) with a key-click transient, a pitch vibrato and a
brightness control; fully polyphonic (12 voices). No samples, no host imports, no allocation in
`process()`.

### Controls
- **Low** — 16'+8' drawbars (fundamental weight).
- **High** — 4'+2'+upper drawbars (brightness/registration).
- **Brightness** — upper-partial tone.
- **Vibrato** — pitch-vibrato depth.
- **Click** — key-click transient.
- **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors) — colored drawbar registration.
