# Micro Beat — budget analog drum box

Models target: **Synths #86 — Boss DR-110** (analog drum machine).

A tiny budget analog drum box — distinct from the factory's bigger boxes by a thin, clicky, bright
character: short clicky kick, papery snare, sizzly "tssh" hats, thin clap/cymbal, all synthesised
in real time. MIDI note picks a voice (note % 5) into a 6-slot pool. Controls: Pitch, Decay, Click,
Hat, Accent, Level. No samples, no host imports, no alloc in process(). wasm-runner PASS; GUI
render-checked (0 console errors) — mini LCD with voice lamps + step grid.
