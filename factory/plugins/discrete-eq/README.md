# Discrete EQ

A punchy, forward **discrete-electronics console equaliser** — an original VibePlugin
effect inspired by classic 500-series discrete-op-amp console EQs. Three cascaded
bands shape the spectrum, then a touch of discrete-stage drive adds forward weight.

## What it does

- **Low band** — switchable **shelf / bell**, corner ~80 Hz, ±12 dB.
- **Mid band** — sweepable **bell**, 200 Hz – 7 kHz, ±15 dB, with **reciprocal
  proportional-Q**: the bell sits **wide** at small boosts/cuts and **narrows** as you
  push it hard — the signature forward, musical proportional-Q behaviour.
- **High band** — switchable **shelf / bell**, corner ~12 kHz, ~±13.5 dB.
- **Drive** — a discrete-stage asymmetric soft saturation across the whole strip for
  punchy, class-A-style colour.

Each band is a stable RBJ biquad in Direct-Form I. The output is trimmed and clamped so
heavy simultaneous boosts plus drive stay below ~1.0 peak.

## Parameters

| # | Name       | Range            | Default | Notes |
|---|------------|------------------|---------|-------|
| 0 | Low Gain   | 0..1 (−12..+12 dB) | 0.5   | flat at 0.5 |
| 1 | Low Shape  | 0/1 (Shelf/Bell)  | 0      | discrete, step 1 |
| 2 | Mid Freq   | 0..1 (200 Hz..7 kHz, log) | 0.45 | |
| 3 | Mid Gain   | 0..1 (−15..+15 dB) | 0.5   | proportional-Q |
| 4 | High Gain  | 0..1 (−13.5..+13.5 dB) | 0.5 | |
| 5 | High Shape | 0/1 (Shelf/Bell)  | 0      | discrete, step 1 |
| 6 | Drive      | 0..1             | 0.25    | discrete-stage saturation |

## GUI

A bespoke, self-contained HTML/CSS/SVG editor (`gui.html`): a red/black console face
with chunky stepped concentric knobs, segmented shelf/bell switches, a pulsing power LED,
an animated scan-line response graph, and a **live proportional-Q bell** that visibly
widens at small boosts and tightens as you drive the mid gain. Knobs are drag (vertical),
scroll, and double-click-to-reset; switches toggle on click. Theme accents
`#ff5c5c` / `#ffb05c`.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via the bundled asc driver)
- `spec.json` — plugin manifest (name, params, theme, GUI file)
- `gui.html` — bespoke animated editor
- `discrete-eq.vstai` — packed, self-contained plugin document
- `preview.wav` — rendered test bench output

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/discrete-eq/assembly.ts /tmp/discrete-eq.wasm
node factory/tools/wasm-runner.mjs /tmp/discrete-eq.wasm \
  --params /tmp/discrete-eq-params.json --wav factory/plugins/discrete-eq/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/discrete-eq/spec.json
```

The test bench reports **VERDICT: PASS** with every parameter `✓ affects` and output
peak well below clipping.
