# Warm Flanger

A lush, warm analog-voiced flanger in the bucket-brigade (BBD) tradition — creamy
and musical rather than metallic. A short fractional delay line is swept by a slow
triangle LFO around a parked centre, and the feedback path is gently low-passed and
softly saturated so heavy feedback thickens and resonates without turning clangy.

This is an **original** effect modelled on the *lineage* of warm analog flangers; it
ships no trademarked names or sampled material.

## Sound

- BBD-flavoured short delay swept by a slow triangle LFO.
- Feedback ("Regen") is low-passed around ~4 kHz and softly cubic-saturated, giving
  a honeyed, swelling comb rather than a harsh metallic whistle.
- A quarter-cycle stereo LFO offset gives a gentle, moving stereo image.

## Parameters

| # | Name   | Range | Default | Function |
|---|--------|-------|---------|----------|
| 0 | Manual | 0–1   | 0.35    | Parks the comb — centre delay (~0.3–7 ms) |
| 1 | Width  | 0–1   | 0.55    | Sweep depth (how far the comb moves) |
| 2 | Rate   | 0–1   | 0.25    | LFO speed (~0.05–6 Hz, exponential) |
| 3 | Regen  | 0–1   | 0.45    | Feedback amount (warm, bounded to ~0.9) |
| 4 | Mix    | 0–1   | 0.50    | Dry/wet blend |

## GUI

Self-contained `gui.html`: a creamy orange + cream pedal face with soft honeycomb
screws, rounded analog knobs (drag vertically, double-click to reset, wheel to
fine-tune) and a smoothly drifting honeyed comb-sweep window animated with
`@keyframes` and `requestAnimationFrame`. Accent `#ffb86a` / `#6ad0ff`.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/warm-flanger/assembly.ts /tmp/warm-flanger.wasm
node factory/tools/wasm-runner.mjs /tmp/warm-flanger.wasm \
  --params /tmp/warm-flanger-params.json --wav factory/plugins/warm-flanger/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/warm-flanger/spec.json
```

Verdict: **PASS** — audio present, finite, peak ≈ 0.60 (headroom), all 5 params
`✓ affects`.
