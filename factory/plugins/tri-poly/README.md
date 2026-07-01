# Tri Poly — DCO poly with cross-modulation

Models target: **Synths #24 — Roland JX-3P**.

A bright DCO polysynth: two DCOs (saw + pulse) per voice with OSC-2 → OSC-1 cross-modulation for a
metallic edge, a resonant low-pass with its own decay envelope, and a built-in chorus. 8-voice
poly. Controls: Cutoff, Resonance, Env Amount, Cross-Mod, Chorus, Level. No samples, no host
imports, no alloc in process(). wasm-runner PASS; GUI render-checked (0 console errors).
