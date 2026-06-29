# Bus Glue

A VCA-style stereo **bus compressor** — the classic mix "glue" character used to pull a
full mix together into a cohesive, punchy whole. Original DSP, not a clone of any product.

## DSP

`assembly.ts` implements the VibePlugin WASM ABI (planar f32, stride 8192, no allocation in
`process()`):

- **Feed-forward, stereo-linked detector** — a ~10 ms mean-square (RMS-ish) window of both
  channels drives a single gain element, so the stereo image stays put while the bus is
  compressed; it just gets tighter and punchier.
- **dB-domain gain computer** with a gentle **soft knee** (6 dB) and three switchable ratios.
  The over-threshold level is computed in dBFS and the resulting reduction is applied **equally
  to L and R** (linked).
- **Smooth gain-reduction envelope** — fast attack toward the target reduction, slower release
  back up, both as one-pole coefficients derived from the Attack/Release times.
- **Makeup gain** restores level, then a **parallel Mix** blends the compressed signal back with
  the dry input ("New York" glue). A gentle `tanh` output stage keeps the bus bounded to ±1
  without harsh clipping (rendered preview peaks ≈ 0.77).

Loud, dense material is gently pulled together more than quiet passages — the glue effect.

## Parameters

| Idx | Name      | Range             | Default | Notes |
|-----|-----------|-------------------|---------|-------|
| 0   | Threshold | 0..1 → −40..0 dB  | 0.45    | where compression begins |
| 1   | Ratio     | 0/1/2 (step 1)    | 1 (4:1) | 2:1 / 4:1 / 10:1 stepped selector |
| 2   | Attack    | 0..1 → 30..0.1 ms | 0.40    | higher = faster |
| 3   | Release   | 0..1 → 0.1..1.2 s | 0.40    | recovery time |
| 4   | Makeup    | 0..1 → 0..+24 dB  | 0.30    | output level |
| 5   | Mix       | 0..1 → 0..100%    | 1.00    | parallel dry/wet |

## GUI

`gui.html` is a single self-contained document (inline CSS/JS/SVG, no external assets): a charcoal
console module with rack screws, a large back-lit **gain-reduction VU meter** whose amber-on-charcoal
needle swings into the **red zone** in real time, a glowing vertical **GR bar meter**, a stepped
**2:1 / 4:1 / 10:1** chicken-head ratio switch, and machined chicken-head knobs for Threshold,
Attack, Release, Makeup and Mix. The needle and GR meter are driven by a live simulation of the
same gain computer the DSP uses, so they react to every knob. Controls are drag- and wheel-adjustable,
double-click resets to default, and every control is wired through `window.vstai.setParam`.
Accent `#ffb347` / `#ff6b6b`.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/bus-glue/assembly.ts /tmp/bus-glue.wasm
node factory/tools/wasm-runner.mjs /tmp/bus-glue.wasm \
  --params /tmp/bus-glue-params.json --wav factory/plugins/bus-glue/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/bus-glue/spec.json
```

Verdict: **PASS** — output present/finite/bounded, all 6 parameters affect the sound.
