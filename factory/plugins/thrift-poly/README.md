# Thrift Poly

A lovable lo-fi **8-voice paraphonic DCO** synthesizer in the budget-classic
tradition (Poly-800 lineage), built as an original VibePlugin instrument.

## What makes it distinctive

Thrift Poly is **paraphonic**: every voice has its own DCO, but they all share
**ONE resonant low-pass filter** and **ONE envelope**. That is the whole
character — sweep the Cutoff and an entire chord gurgles and breathes together,
rather than each note moving independently. A built-in stereo chorus adds width
and a gentle wobble, and a soft-clipped output keeps things gritty and charming
rather than hi-fi.

## Signal path

```
8 × DCO (saw + square) ──┐
8 × square sub (-1 oct) ─┤── sum ──► SHARED resonant SVF low-pass ──► shared DEG env gate ──► soft clip ──► stereo chorus ──► out
```

- **DCO per voice**: blended saw (0.6) + square (0.4), free-running phase for
  that loose budget feel.
- **Sub**: square oscillator one octave down, level set by `Sub`.
- **Shared filter**: one state-variable low-pass for all voices. The envelope
  modulates its cutoff (`Env Amount`), so chords open and close as one.
- **Shared envelope**: fast attack, decay to sustain, `Release`-controlled tail.
- **Chorus**: two modulated delay lines (90° apart) for stereo width.

## Parameters

| Index | Name      | Default | Description |
|-------|-----------|---------|-------------|
| 0 | Cutoff    | 0.45 | Shared low-pass cutoff (the gurgle control) |
| 1 | Resonance | 0.40 | Shared filter resonance |
| 2 | Env Amount| 0.60 | How much the envelope pushes the shared cutoff |
| 3 | Sub       | 0.50 | Square sub-oscillator level |
| 4 | Chorus    | 0.50 | Stereo chorus depth / mix (lights the Chorus lamp) |
| 5 | Release   | 0.35 | Shared envelope release time |
| 6 | Level     | 0.70 | Output level |

## GUI

A self-contained HTML panel: a charcoal + mint membrane-button budget-poly look
with a numeric LCD, a large glowing **Shared Filter** dial, animated stacked
gurgly square/saw waves on the LCD scope, eight running voice lamps, and a
pulsing amber **Chorus** lamp. All controls are draggable (shift = fine,
scroll = nudge, double-click = reset) and wired to `window.vstai.setParam`.

## Build / verify

```sh
node compiler/asc-driver.mjs factory/plugins/thrift-poly/assembly.ts /tmp/thrift-poly.wasm
node factory/tools/wasm-runner.mjs /tmp/thrift-poly.wasm \
  --params /tmp/thrift-poly-params.json --wav factory/plugins/thrift-poly/preview.wav \
  --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/thrift-poly/spec.json
```

Verified **VERDICT: PASS** — audio present, finite, no clipping, all 7 params
reactive.

Theme: accent `#5ad0a0` (mint) / `#ffd24a` (amber).
