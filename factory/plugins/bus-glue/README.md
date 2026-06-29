# Bus Glue

A VCA-style stereo **bus compressor** — the classic mix "glue" character used to pull a
full mix together into a cohesive, punchy whole. Original DSP, not a clone of any product.

## DSP

`assembly.ts` implements the VibePlugin WASM ABI (planar f32, stride 8192, no allocation in
`process()`):

- **Stereo-linked RMS detector** — a ~10 ms mean-square window of both channels drives a
  single gain element, so the stereo image stays stable while the bus is compressed.
- **dB-domain gain computer** with a gentle **soft knee** (6 dB) and three switchable ratios.
- **Smooth gain-reduction envelope** — fast attack toward the target, slower release back up.
  The top of the Release range engages a **program-dependent auto-release** that blends a fast
  and a slow time constant by recent activity.
- **Makeup gain** restores level, followed by a gentle `tanh` output stage so the bus is
  bounded to ±1 without harsh clipping (rendered preview peaks ≈ 0.81).

Loud, dense material is gently pulled together more than quiet passages — the glue effect.

## Parameters

| Idx | Name      | Range            | Default | Notes |
|-----|-----------|------------------|---------|-------|
| 0   | Threshold | 0..1 → 0..−40 dB | 0.45    | where compression begins |
| 1   | Ratio     | 0/1/2 (step 1)   | 1 (4:1) | 2:1 / 4:1 / 10:1 stepped selector |
| 2   | Attack    | 0..1 → 30..0.1 ms| 0.40    | higher = faster |
| 3   | Release   | 0..1 → 0.1..1.2 s| 0.50    | top of range = AUTO |
| 4   | Makeup    | 0..1 → 0..+24 dB | 0.30    | output level |

## GUI

`gui.html` is a single self-contained document (inline CSS/JS/SVG, no external assets): a grey
console module with rack screws, a large back-lit **gain-reduction VU meter** whose needle sways
in real time, a stepped **2:1 / 4:1 / 10:1** ratio switch, and three machined knobs for Threshold,
Attack, Release and Makeup. Knobs are drag- and wheel-adjustable, double-click resets to default,
and every control is wired through `window.vstai.setParam`. Accent `#c0c8d0` / `#9aa6b4`.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/bus-glue/assembly.ts /tmp/bus-glue.wasm
node factory/tools/wasm-runner.mjs /tmp/bus-glue.wasm \
  --params /tmp/bus-glue-params.json --wav factory/plugins/bus-glue/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/bus-glue/spec.json
```

Verdict: **PASS** — output present/finite/bounded, all 5 parameters affect the sound.
