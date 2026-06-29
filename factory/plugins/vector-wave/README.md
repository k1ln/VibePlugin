# Vector Wave

A polyphonic **vector / wave-sequencing** synthesizer instrument for the VibePlugin
factory. An original design inspired by classic vector-synthesis workstations — no
samples, no trademarks, all DSP generated in code.

## Sound engine

Four single-cycle waves are generated at `init` and placed on the corners of a
square morph pad:

| Pad corner   | Wave    |
|--------------|---------|
| bottom-left  | Sine    |
| bottom-right | Triangle|
| top-left     | Saw (8 partials) |
| top-right    | Pulse (odd harmonics) |

- **Vector X / Y** bilinearly crossfade the four corner waves — the joystick
  morphs the timbre continuously across the pad.
- **Sequence Rate** advances a shared wave-sequence position that both rotates the
  corner assignment (stepping through the waves) *and* walks the vector point on a
  small circular orbit around the joystick, so the timbre evolves over time even on
  a single held note. At 0 the timbre is static; higher rates step faster and wider.
- Up to **8 voices** are allocated per `noteId` (oldest-voice stealing), so chords
  ring with independent contours. Each voice runs **two detuned vector oscillators**
  into a **resonant low-pass** shaped by an **attack / release** amplitude contour.
  Output is soft-saturated (`tanh`) for glue and bounded well under full scale.

## Parameters

| # | Name          | Range | Default | Effect |
|---|---------------|-------|---------|--------|
| 0 | Vector X      | 0–1   | 0.50    | Horizontal crossfade across the pad |
| 1 | Vector Y      | 0–1   | 0.50    | Vertical crossfade across the pad |
| 2 | Sequence Rate | 0–1   | 0.30    | Wave-sequence step rate + orbit depth |
| 3 | Cutoff        | 0–1   | 0.60    | Low-pass cutoff (80 Hz – ~15 kHz, exp) |
| 4 | Attack        | 0–1   | 0.05    | Amplitude attack (2 ms – 2 s) |
| 5 | Release       | 0–1   | 0.40    | Amplitude release (5 ms – 3 s) |
| 6 | Detune        | 0–1   | 0.25    | Detune between the two oscillators |
| 7 | Level         | 0–1   | 0.60    | Output level |

## GUI

`gui.html` is a single self-contained document (inline CSS / JS / SVG, no external
assets). A glowing draggable joystick crossfades the four corner waves on a teal
workstation pad, with an animated wave-sequence timeline whose scan speed tracks the
Sequence Rate, plus six ring-knobs. Every control wires to `window.vstai.setParam`,
initialises to its default, is draggable and double-click resets.

## Build / verify

```sh
node compiler/asc-driver.mjs factory/plugins/vector-wave/assembly.ts /tmp/vector-wave.wasm
node factory/tools/wasm-runner.mjs /tmp/vector-wave.wasm \
  --params /tmp/vector-wave-params.json --synth --seconds 3   # VERDICT: PASS
node factory/tools/pack-vstai.mjs factory/plugins/vector-wave/spec.json
```

All 8 parameters report `✓ affects`; peak ≈ 0.17 (no clipping).
