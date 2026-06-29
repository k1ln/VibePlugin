# Multiband

A three-band dynamics processor (mastering-style) for the VibePlugin factory.

Modeled as an original take on the classic multiband compressor — no trademarked
names ship in any file.

## What it does

The input is split into three frequency bands by two crossovers:

- **Low** — below ~220 Hz
- **Mid** — ~220 Hz to ~2.5 kHz
- **High** — above ~2.5 kHz

Each band is split with a cascaded one-pole low-pass pair (a Linkwitz-Riley-like
slope) and then compressed independently by its own peak-detecting compressor.
Each band has its own threshold and ballistics: the low band releases slowly so
it can pump, while the high band is snappy — so the bass can breathe and pump
without dulling the highs. A shared ratio sets how hard each band squeezes, and
the recombined signal passes through a makeup/output trim.

## Controls

| Index | Name        | Range | Default | Effect |
|------:|-------------|-------|---------|--------|
| 0 | Low Thresh  | 0..1 | 0.5 | Low-band threshold (1 = open, 0 = squash) |
| 1 | Mid Thresh  | 0..1 | 0.5 | Mid-band threshold |
| 2 | High Thresh | 0..1 | 0.5 | High-band threshold |
| 3 | Ratio       | 0..1 | 0.5 | Shared ratio, 1:1 .. ~12:1 |
| 4 | Output      | 0..1 | 0.6 | Output / makeup gain (0..1.6x) |

## DSP

`assembly.ts` — AssemblyScript, all `f32`, no allocation in `process()`, planar
stride 8192, params clamped. Exposes the standard ABI plus three optional
gain-reduction getters (`getGrLow/Mid/High`) for host-side meters. Gain-staged so
the output peak stays below ~1.0.

## GUI

`gui.html` — a single self-contained document (inline CSS/JS/SVG, no external
assets). A modern dark mastering layout: three stacked frequency-band lanes, each
with its own animated gain-reduction meter, spectrum bars and threshold knob that
pump independently, plus master Ratio and Output knobs. Every control is wired to
its parameter index via `window.vstai.setParam`, initialised to its default,
draggable (vertical), double-click to reset, wheel to fine-tune, with a live value
readout. Accent `#ff8a5a` / `#ffd166`.

## Build / verify

```sh
node compiler/asc-driver.mjs factory/plugins/multiband/assembly.ts /tmp/multiband.wasm
node factory/tools/wasm-runner.mjs /tmp/multiband.wasm \
  --params /tmp/multiband-params.json --wav factory/plugins/multiband/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/multiband/spec.json
```

The wasm-runner reports `VERDICT: PASS` with every parameter `✓ affects`.
