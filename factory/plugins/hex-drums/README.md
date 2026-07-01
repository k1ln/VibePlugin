# Hex Drums — analog electronic drums

Models target: **Synths #83 — Simmons SDS-V** (analog electronic drums).

Distinct from the factory's *sampled* drum machines and its 808-style analog box: every hit here is
**synthesised in real time**, the iconic 80s Simmons sound. The signature is the pitch-swept "pew"
tom — a sine whose pitch drops sharply at the attack — plus a noisy click; with kick, snare and hat
voices. A MIDI note selects a voice (`note % 6`) and fires it into an 8-slot pool. No samples, no
host imports, no allocation in `process()`.

### Voices (note % 6)
0 Kick · 1 Snare · 2 Tom Hi · 3 Tom Mid · 4 Tom Lo · 5 Hat

### Controls
- **Pitch** — global tuning.
- **Sweep** — depth of the attack pitch-drop (the "pew").
- **Decay** — hit length.
- **Noise** — click / snap amount.
- **Tone** — brightness.
- **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors) — hexagonal Simmons-style pads.
