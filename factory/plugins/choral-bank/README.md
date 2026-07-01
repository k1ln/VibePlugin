# Choral Bank

A **fully-polyphonic organ / string-ensemble** synthesizer in the lineage of the
big paraphonic-string and fully-polyphonic organ machines. Hold dense stacked
chords and every note rings on its own — this is a vast, angelic, shimmering pad.

## Sound

- **Divide-down full-keyboard source.** Each key sounds a stack of harmonically
  related sine partials voiced like an organ's footages (fundamental, octave,
  two-octave, fifth). The mix is energy-normalised so a big chord stays bounded.
- **One filter per note.** Every voice has its OWN gentle resonant 2-pole
  low-pass with a slow attack / sustain / release contour, so dense chords each
  breathe and bloom independently rather than sharing one envelope.
- **Rich ensemble chorus.** The whole bank pours into a four-tap ensemble built
  from slow, slightly-incommensurate quadrature LFOs modulating short delay
  lines, hard-spread across the stereo field. As **Ensemble** rises the sound
  widens into a huge, lush, choral shimmer.
- 16-voice polyphony with oldest-voice stealing; pitch tracks the host (Hz).

## Parameters

| # | Name       | Default | Description |
|---|------------|---------|-------------|
| 0 | Cutoff     | 0.55    | Per-note low-pass corner (120 Hz … ~12 kHz, exponential). |
| 1 | Resonance  | 0.22    | Gentle filter resonance — a soft vocal peak, never screaming. |
| 2 | Attack     | 0.30    | Slow swell time (up to ~3.5 s). |
| 3 | Release    | 0.45    | Slow fade time (up to ~4 s). |
| 4 | Ensemble   | 0.70    | Chorus depth / stereo width — widens into a lush choir. |
| 5 | Brightness | 0.50    | Drawbar balance: tilts energy toward the upper partials. |
| 6 | Level      | 0.55    | Output level (post soft-saturation glue). |

## GUI

A pale sky-blue + lilac cathedral panel: faint arch columns, slow-drifting
ensemble haze (`@keyframes drift`), and a wide shimmering choral wavefield
animated on `requestAnimationFrame` (depth/brightness reshape it live). Hand-built
SVG knobs (drag vertically, wheel to nudge, shift for fine, double-click to reset),
grouped into Voice / Swell / Ensemble sections, and a playable on-screen keyboard
wired to `window.vstai.noteOn/noteOff`. Self-contained — no external assets.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the in-process `asc`).
- `gui.html` — self-contained GUI.
- `spec.json` — name, params, theme, packing metadata.
- `choral-bank.vstai` — packed plugin document.
- `preview.wav` — rendered preview.

## Rebuild

```sh
node compiler/asc-driver.mjs factory/plugins/choral-bank/assembly.ts /tmp/choral-bank.wasm
node factory/tools/wasm-runner.mjs /tmp/choral-bank.wasm \
  --params factory/plugins/choral-bank/spec.json --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/choral-bank/spec.json
```
