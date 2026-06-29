# De-Esser

A vocal **de-esser** — it tames harsh sibilance (the "sss", "shh" and "tss"
sounds) without dulling the voice.

## How it works

A sidechain **band-pass detector** isolates the sibilant energy around the
**Frequency** control (centred 4–10 kHz). A fast peak-follower watches that band
and, whenever it crosses **Threshold**, a downward compressor ducks **only the
high band** — by up to **Amount** dB — while the body of the voice (everything
below the band) passes through untouched. The two are recombined, so consonants
soften but vowels and warmth stay intact. **Mix** blends the processed signal
against the dry input for parallel de-essing.

The whole thing is a pure per-sample algorithm (one-pole crossover + band-pass
sidechain + envelope-driven gain) with no lookahead, no allocation in the audio
loop, and bounded output.

## Parameters

| Index | Name      | Range        | Default | Description |
|-------|-----------|--------------|---------|-------------|
| 0     | Frequency | 4.0–10.0 kHz | 6.7 kHz | Centre of the sibilant detection band. |
| 1     | Threshold | −50–0 dB     | −27 dB  | Level the sibilant band must exceed before ducking starts. |
| 2     | Amount    | 0–24 dB      | 14 dB   | Maximum reduction applied to the high band. |
| 3     | Mix       | 0–100 %      | 100 %   | Dry/processed blend. |

## GUI

A bespoke, self-contained vocal-tool panel in cool aqua (`#9ad0e0` / `#c0e0f0`):
an animated spectrum scope with a highlighted, frequency-tracking sibilant band,
streaming "sss" particles that get visibly caught and ducked inside the band, a
live gain-reduction readout + LED, and four hand-built SVG knobs (vertical drag,
wheel fine-tune, double-click to reset). No external assets.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the VibePlugin ABI).
- `gui.html` — single-file GUI.
- `spec.json` — plugin manifest (name, params, theme, paths).
- `de-esser.vstai` — packed bundle (baked GUI + WASM).
- `preview.wav` — rendered preview.
