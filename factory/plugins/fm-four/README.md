# FM Four

A programmable **4-operator FM synth** in the DX21/DX100 lineage — an original
VibePlugin instrument, not a fixed tine electric-piano. Four sine operators are
wired by a selectable **algorithm** and modulated with an exposed ratio, depth
and operator feedback for everything from clangy basses to glassy bells and
evolving pads. Classic clangy/bright 80s digital FM.

## Engine

- **12-voice polyphony**, per-voice phase-modulation engine, pure sine operators.
- **Three algorithms** (stepped selector):
  - `0 STACK` — OP4 → OP3 → OP2 → OP1 (deep serial stack, gritty bass)
  - `1 PAIR` — (OP4 → OP3) + (OP2 → OP1), two FM pairs summed
  - `2 PARALLEL` — OP4, OP3, OP2 all modulate the OP1 carrier (rich, additive-ish)
- **Operator feedback** self-modulates the top operator for the gritty 80s edge.
- A single **attack/release** envelope (with a slow held-body decay) shapes
  **both** amplitude **and** modulation index, so the brightness evolves over
  each note like a real DX patch.
- Gain-staged with a gentle soft-clip; tested peak well under 1.0.

## Parameters

| # | Name      | Range        | Notes                                   |
|---|-----------|--------------|-----------------------------------------|
| 0 | Ratio     | 0..1         | modulator:carrier ratio, 0.5×..12×      |
| 1 | FM Depth  | 0..1         | modulation index (timbre brightness)    |
| 2 | Feedback  | 0..1         | top-operator self-feedback (grit)       |
| 3 | Algorithm | 0..2, step 1 | STACK / PAIR / PARALLEL                  |
| 4 | Attack    | 0..1         | 1 ms .. 400 ms                          |
| 5 | Release   | 0..1         | 40 ms .. ~4 s                           |
| 6 | Level     | 0..1         | output level                            |

## GUI

`gui.html` — a self-contained indigo + mint digital panel. The operator
**algorithm** is shown as a glowing animated node graph (4 operator boxes wired
by the current routing, carriers vs modulators colour-coded), beside a
fast-evolving **FM spectral readout** driven by the live parameter values.
Custom dials with vertical-drag, wheel and double-click-reset; every parameter
is wired to `window.vstai.setParam`.

## Files

- `assembly.ts` — AssemblyScript DSP (compiles to WASM via `compiler/asc-driver.mjs`)
- `spec.json` — plugin manifest (params, theme, GUI reference)
- `gui.html` — bespoke animated editor
- `preview.wav` — rendered audio preview
- `fm-four.vstai` — packed bundle

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/fm-four/assembly.ts /tmp/fm-four.wasm
node factory/tools/wasm-runner.mjs /tmp/fm-four.wasm --params /tmp/fm-four-params.json \
  --wav factory/plugins/fm-four/preview.wav --synth --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/fm-four/spec.json
```

Latest verdict: **PASS** — all 7 parameters affect the output.
