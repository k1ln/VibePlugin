# Master Glue

A classic British console-style **mix-bus "glue" compressor** — the console glue that pulls a
whole mix into one cohesive, punchy whole. Original DSP, not a clone of any product, and
deliberately distinct from the API-style **Bus Glue** in this factory: where Bus Glue uses
continuous controls, Master Glue is the stepped-switch, program-dependent **auto-release**
mix-bus character.

## DSP

`assembly.ts` implements the VibePlugin WASM ABI (planar f32, stride 8192, no allocation in
`process()`):

- **Stereo-LINKED detector** — a fast, peak-ish smoothed level of the summed program drives a
  single gain element, so the same reduction hits L and R and the stereo image stays put while
  the bus tightens and "glues".
- **dB-domain soft-knee gain computer** with **stepped ratios** 2:1 / 4:1 / 10:1.
- **Stepped attack** — four selectable attack feels (0.1 / 0.3 / 3 / 10 ms) mapped to one-pole
  coefficients.
- **Release with an AUTO position** — four fixed times (0.1 / 0.3 / 0.6 / 1.2 s) plus an **AUTO**
  setting whose program-dependent **dual time-constant** blends a fast and a slow release by the
  depth of gain reduction, so the compressor "breathes" with the music — quick on transients,
  slow under sustained loudness.
- **Makeup** restores level (0..+18 dB), **Mix** blends parallel dry for New-York glue, and a
  gentle `tanh` output stage keeps the bus bounded to ~±1.

A loud, dense mix is smoothly leveled and gelled; quiet passages pass more freely.

## Parameters

| # | Name | Range | Default | Notes |
|---|------|-------|---------|-------|
| 0 | Threshold | 0..1 (−30..0 dBFS) | 0.5 | where glue begins |
| 1 | Ratio | 0/1/2 → 2:1 / 4:1 / 10:1 | 4:1 | stepped |
| 2 | Attack | 0..3 (0.1/0.3/3/10 ms) | 0.3 ms | stepped |
| 3 | Release | 0..4 (0.1/0.3/0.6/1.2 s + AUTO) | AUTO | stepped, max = AUTO |
| 4 | Makeup | 0..1 (0..+18 dB) | 0.3 | output makeup |
| 5 | Mix | 0..1 | 1 | parallel dry/wet |

## GUI

`gui.html` is one self-contained document (inline CSS/JS/SVG, no external assets): a brushed
silver-grey British console module with corner screws, a **centre-zero gain-reduction VU**
needle, **chicken-head stepped knobs** in blue (Ratio/Release) and red (Attack), and a glowing
**AUTO badge** that breathes when the Release switch is on AUTO. Knobs are drag-to-turn (vertical),
double-click to reset, and scroll-wheel adjustable; every parameter is wired to
`window.vstai.setParam(index, value)` with real values and initialised to its default.

## Build / test

```
node compiler/asc-driver.mjs factory/plugins/master-glue/assembly.ts /tmp/master-glue.wasm
node factory/tools/wasm-runner.mjs /tmp/master-glue.wasm --params /tmp/master-glue-params.json --wav factory/plugins/master-glue/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/master-glue/spec.json
```

Verified **VERDICT: PASS** — audio present, finite, no clip (peak ≈ 0.70), every parameter ✓ affects.
