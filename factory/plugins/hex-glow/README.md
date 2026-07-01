# Hex Glow — poly with built-in phaser

Models target: **Synths #66 — Korg Polysix**.

A 6-voice single-VCO polysynth: one VCO (saw) + square sub per voice, a resonant low-pass with its
own envelope and an amp envelope; the poly mix runs through the Polysix's signature effects section
— here a 4-stage modulated allpass phaser (the distinct hook vs the factory's chorus polys).
Controls: Cutoff, Resonance, Env Amount, Sub, Phaser, Level. No samples, no host imports, no alloc
in process(). wasm-runner PASS (all 6 params reactive); GUI render-checked (0 console errors).
