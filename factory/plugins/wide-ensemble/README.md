# Wide Ensemble

A lush bucket-brigade (BBD) **stereo chorus ensemble** with a **vibrato** mode — an
original effect in the classic ensemble-pedal lineage, distinct from a Juno-style chorus or
a dimensional chorus.

A mono-summed input is **fanned into a wide stereo image** by two modulated delay lines
whose sweep runs in **anti-phase** on the left and right channels, so the two sides swirl
against each other for a big swirling ensemble. The **Mode** control morphs from chorus
(dry signal plus the modulated taps) to **vibrato** (pure modulated tap, so the whole
signal pitch-wobbles). A BBD-darkness **Tone** low-pass shapes the wet path and a soft
saturation emulates the BBD compander grit for warm analog character.

## DSP

- Two short modulated delay lines (~7 ms base, swept), L/R driven by the **same LFO in
  anti-phase** → wide stereo ensemble image.
- Linear-interpolated fractional reads for clean pitch modulation.
- Soft cubic saturation on the delay input models BBD compander grit.
- One-pole low-pass on the wet path for BBD darkness (Tone).
- Mode crossfades dry-in-wet (chorus) → wet-only (vibrato) and deepens the sweep.
- All `f32` (`Mathf.*`), no allocation in `process()`, planar stride 8192, params clamped,
  output peak well under 1.0.

## Parameters

| # | Name  | Default | Range | Function |
|---|-------|---------|-------|----------|
| 0 | Rate  | 0.32    | 0..1  | LFO speed (0.05 – 6 Hz) |
| 1 | Depth | 0.55    | 0..1  | Sweep depth of the ensemble |
| 2 | Mode  | 0.00    | 0..1  | Chorus ↔ vibrato blend (swirl → wobble) |
| 3 | Tone  | 0.45    | 0..1  | BBD darkness of the wet path |
| 4 | Mix   | 0.85    | 0..1  | Dry / wet |

## GUI

A self-contained vintage cream + chrome rack unit: a chorus/vibrato **mode rocker**, two
**anti-phase shimmering waveforms** swirling wide across a stereo scope, animated with real
`@keyframes`/rAF, and chrome dials with conic progress rings. Drag to adjust, double-click
to reset, mouse-wheel to nudge. Accent `#5ad0ff` / `#9a7bff`.

## Test

```
node compiler/asc-driver.mjs factory/plugins/wide-ensemble/assembly.ts out.wasm
node factory/tools/wasm-runner.mjs out.wasm --params params.json --wav preview.wav --seconds 3
```

VERDICT: PASS — every parameter affects the output; peak ≈ 0.54, finite, no clipping.
