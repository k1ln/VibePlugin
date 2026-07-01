# Kit Machine — sample-playback drum machine

Models target: **Synths #82 — Oberheim DMX** (classic sampled drum machine).

A true **PCM one-shot player**, distinct from the factory's real-time-synthesised analog drum
boxes (e.g. Voltage Drums). Eight short drum samples are baked into the module as base64 Int16
PCM @ 22050 Hz, decoded into one f32 buffer at `init()`, and played back through a 16-slot
polyphonic pool. A MIDI note selects a voice (`note % 8`) and fires a one-shot.

### Voices (note % 8)
0 Kick · 1 Snare · 2 Closed Hat · 3 Open Hat · 4 Clap · 5 Tom · 6 Rim · 7 Cowbell

### Controls
- **Tune** — global sample playback pitch (±1 octave).
- **Decay** — per-hit amp decay (tight ↔ long).
- **Snap** — attack-transient emphasis (punch).
- **Tone** — global brightness (dark ↔ open).
- **Level** — output.

### Embedded audio — source & license
The eight drum one-shots are **original, self-authored CC0 content**: synthesised offline (in a
small Node script — sine/noise/envelope models for kick, snare, hats, clap, tom, rim, cowbell),
peak-normalised, and baked in as PCM. **No third-party samples are used**, so the `.vstai` is
fully self-contained and free of licensing constraints.

### Test
`wasm-runner --synth` → VERDICT PASS (present, finite, non-clipping peak ~0.73, all 5 params
reactive). GUI render-checked headless (0 console errors). `test.html` plays it from the keyboard.
