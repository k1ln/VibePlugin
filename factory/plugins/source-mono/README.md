# Source Mono — two-osc Moog mono

Models target: **Synths #4 — Moog Source**.

A smooth two-oscillator monosynth: saw + pulse (blendable) plus a square sub into a resonant
ladder-style low-pass with its own envelope, glide, and an amp envelope. Warm, rounded Moog mono.
Controls: Cutoff, Resonance, Env Amount, Osc Mix, Detune, Level. No samples, no host imports, no
alloc in process(). wasm-runner PASS (all 6 reactive); GUI render-checked (0 console errors) —
round osc-scope panel.
