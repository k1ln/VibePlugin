# Bark Beat — analog drum machine

Models target: **Synths #14 — Roland TR-606** (analog drum machine).

A tight analog drum machine — every hit synthesised in real time (no samples), distinct from the
factory's 808/909 boxes and Simmons e-drums by its punchy "barking" kick (fast pitch-drop), snappy
noise+tone snare, tight analog toms and bright high-passed hats. A MIDI note selects a voice
(`note % 6`) into an 8-slot pool. No host imports, no allocation in `process()`.

### Voices (note % 6)
0 Kick · 1 Snare · 2 Tom Lo · 3 Tom Hi · 4 Closed Hat · 5 Open Hat

### Controls
- **Pitch** — global tuning. **Punch** — kick attack/snap (pitch-drop depth).
- **Snare** — snare tone/noise balance. **Hat** — hat brightness + length.
- **Decay** — overall hit length. **Level** — output.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping, all 6 params reactive). GUI
render-checked headless (0 console errors) — TR-style 16-step sequencer.
