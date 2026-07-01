# Vivid Poly

A bright, punchy 8-voice analog-style polyphonic synthesizer instrument for the
VibePlugin factory. Vivid Poly is built for the forward, cutting end of the
analog-poly spectrum — aggressive leads and brass stabs rather than mellow pads.
Its lineage is the vivid Italian polysynth: an unusually bright, snappy top end
that bites where warmer Junos and Obies stay smooth.

## Sound

Each of the 8 independent voices runs:

- **Two DCOs** — a band-limited saw plus a variable-width band-limited pulse
  (PWM), the pulse tuned a hair sharp for animated movement.
- **Ring / Sync grit** — a master oscillator at a variable ratio above the
  voice; its saw is ring-modulated against the DCO mix and crossfaded in for an
  aggressive, metallic upper edge.
- **Snappy resonant 4-pole low-pass** with high-frequency emphasis so the filter
  stays vivid and forward rather than dark.
- **Fast, punchy filter envelope** (Attack + Env Amount) that sweeps the cutoff
  up to ~6.5 octaves and decays quickly toward a floor for a percussive zing,
  plus a quick amplitude AR.

Voices are allocated per `noteId` with oldest-voice stealing, so chords ring
with independent contours and pitch tracks the keyboard. The host passes
frequency in Hz to `noteOn(id, freq, vel)`.

## Parameters

| # | Name      | Default | Effect |
|---|-----------|---------|--------|
| 0 | Cutoff    | 0.62    | Base filter cutoff, 120 Hz .. ~18 kHz — opens up the bite |
| 1 | Resonance | 0.40    | Filter resonance / sharpness, up to near self-oscillation |
| 2 | Env Amount| 0.65    | Filter-envelope sweep depth (up to ~6.5 octaves) |
| 3 | PWM       | 0.35    | Pulse width, 50% (square) .. 92% (thin/nasal) |
| 4 | Ring      | 0.25    | Sync + ring-modulation grit — adds aggressive metallic top |
| 5 | Attack    | 0.04    | Amp/filter attack, ~1 .. 120 ms (fast and punchy) |
| 6 | Release   | 0.30    | Amp release, ~5 ms .. 1.6 s |
| 7 | Level     | 0.80    | Output level (gain-staged, peak well below clipping) |

## Files

- `assembly.ts` — AssemblyScript DSP (all `f32`, no allocation in `process()`,
  module-scope `StaticArray` state, planar stride 8192, clamped params).
- `spec.json` — plugin manifest (`isInstrument: true`, theme accents
  `#ffd23d` / `#ff5a4d`, param table, `guiFile`).
- `gui.html` — self-contained bespoke animated GUI: a bright red + gold Italian
  poly panel with white knob caps, a live snapping saw/pulse scope and a
  segment meter. No external assets.
- `preview.wav` — rendered preview from the WASM runner.
- `vivid-poly.vstai` — packed bundle.

## Verification

Compiled and tested via the factory tools:

```
node compiler/asc-driver.mjs factory/plugins/vivid-poly/assembly.ts vivid-poly.wasm
node factory/tools/wasm-runner.mjs vivid-poly.wasm --params vivid-poly-params.json \
     --wav factory/plugins/vivid-poly/preview.wav --synth --seconds 3
```

Result: **VERDICT: PASS** — audio present, finite, bounded (peak ≈ 0.26), and
all 8 parameters report `✓ affects`.

> Vivid Poly is an original instrument. It draws on the bright Italian-polysynth
> tradition but ships no trademarked names, presets, or samples.
