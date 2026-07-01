# Pitch Snap — pitch correction

Models target: **Effects #89 — Antares Auto-Tune** (pitch correction).

A real-time pitch corrector: autocorrelation pitch detection → snap to the nearest note of the
chosen scale → shift to that pitch with a crossfaded two-grain delay-line shifter. Fast retune =
the robotic "T-Pain" snap; slow = natural correction. Controls: Speed, Amount, Key (chromatic /
major / minor / fifths), Mix, Output. Best on monophonic pitched input. No host imports, no alloc
in process(). wasm-runner PASS (all 5 reactive); GUI render-checked (0 console errors) — note-grid
with the detected pitch snapping to scale lines.
