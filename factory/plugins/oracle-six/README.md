# Oracle Six — analog poly with Poly-Mod

Models target: **Synths #30 — Sequential Prophet-600**.

A CEM-based analog polysynth. Two oscillators (saw + pulse) per voice; the signature **Poly-Mod**
routes the filter envelope to oscillator pitch for sweeping, sync-like and clangourous timbres.
Resonant low-pass with its own envelope, amp envelope, 6-voice poly. Controls: Cutoff, Resonance,
Env Amount, Poly-Mod, Detune, Level. No samples, no host imports, no alloc in process().
wasm-runner PASS; GUI render-checked (0 console errors).
