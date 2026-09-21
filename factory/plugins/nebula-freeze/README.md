# Nebula Freeze

Live granular texture processor with freeze — 20 params, stereo, ~8 s capture buffer, 64-grain pool.

| Control | What it does |
|---|---|
| Position / Spray | where grains start in the buffer (0 = newest), and how far they scatter |
| Size / Density / Chaos | grain length 10 ms–1.2 s, 1–200 grains/s, spawn timing from metronomic to Poisson |
| Texture | window morph: percussive → Hann → flat-topped plateau |
| Pitch / Jitter / Quantize | ±24 st, random ±12 st per grain, optional snap to octaves / fifths / minor pent / major / whole tone |
| Reverse / Spread | probability a grain plays backwards, per-grain random pan |
| Freeze / Window | stop the write head (buffer becomes an instrument); buffer length 0.25–8 s |
| Feedback / Tone / Degrade | cloud re-injected into the buffer; LP↔HP tilt; sample-rate + bit reduction |
| Reverb / Decay | Freeverb-style diffuse tail behind the cloud |

Design notes: each grain carries its own delay trajectory (`delay += live − dir·rate`), clamped at
spawn so it never crosses the write head — live or frozen — so there are no clicks. 4-point Hermite
interpolation. Wet gain is normalised by expected overlap.

Tests (`wasm-runner`, `test-params.json`): VERDICT PASS, all 20 params reactive. Extra harness:
frozen tail sustains after input stops (rms 0.21) while unfrozen decays to 0; extreme settings
(max feedback/density/size/reverb, ±24 st) stay finite and bounded; 96 kHz OK.
