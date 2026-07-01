# Wave Storm — wavetable scanner

Models target: **Synths #99 — Waldorf Blofeld / Q** (wavetable/VA).

A wavetable-scanning synth: eight single-cycle frames (built at init from harmonic spectra) scanned
continuously by Position and swept by the envelope (Scan), so the timbre morphs over each note.
Resonant low-pass with its own envelope, amp envelope, 8-voice poly. Controls: Position, Scan,
Cutoff, Resonance, Env Amount, Level. No samples, no host imports, no alloc in process().
wasm-runner PASS (all 6 reactive); GUI render-checked (0 console errors) — pseudo-3D wavetable frames.
