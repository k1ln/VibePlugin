# Console EQ

A class-A console channel equaliser — the broadcast-console strip sound, built as
an original VibePlugin module. No samples, no trademarks: pure DSP.

## What it is

Three musical bands cascaded through gentle transformer-style saturation:

- **Low Gain** — a broad low shelf around 100 Hz, -12..+12 dB. Adds weight and
  warmth or tightens the bottom end.
- **Mid Freq** — log-sweeps the mid bell's centre from 220 Hz to 7 kHz, the
  workhorse band for shaping body, honk and presence.
- **Mid Gain** — the mid bell, -15..+15 dB, with **proportional-Q**: the bell is
  broad at small moves and narrows as you push it, the way an inductor-coupled
  console band tightens with drive.
- **High Gain** — a high shelf around 10 kHz, -13.5..+13.5 dB, for "air" and sheen.
- **Drive** — a class-A style tanh saturation with a touch of even-harmonic
  asymmetry, applied across the whole strip for analog weight. Level-compensated
  so it adds colour, not just volume.

## DSP

Each band is a stable RBJ-cookbook biquad in Direct-Form I (low shelf → mid bell →
high shelf), coefficients recomputed once per block and run per-sample with
per-channel state. Everything is f32, allocation-free in `process()`, with clamped
params, guarded divides, a sub-Nyquist clamp on the mid/high corners, and an output
trim so even simultaneous large boosts plus drive stay under ~1.0 peak.

## Parameters

| Index | Name      | Range | Default | Maps to                          |
|-------|-----------|-------|---------|----------------------------------|
| 0     | Low Gain  | 0..1  | 0.5     | low shelf -12..+12 dB @ ~100 Hz  |
| 1     | Mid Freq  | 0..1  | 0.45    | mid bell centre 220 Hz..7 kHz    |
| 2     | Mid Gain  | 0..1  | 0.5     | mid bell -15..+15 dB (prop-Q)    |
| 3     | High Gain | 0..1  | 0.5     | high shelf -13.5..+13.5 dB @ ~10 kHz |
| 4     | Drive     | 0..1  | 0.25    | class-A saturation amount        |

0.5 is flat for all three gain bands.

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/console-eq/assembly.ts /tmp/console-eq.wasm
node factory/tools/wasm-runner.mjs /tmp/console-eq.wasm \
  --params factory/plugins/console-eq/spec.json --wav factory/plugins/console-eq/preview.wav --seconds 3
node factory/tools/pack-vstai.mjs factory/plugins/console-eq/spec.json
```

Verdict: **PASS** — audio present, finite, headroom intact (peak ≈ 0.85), and every
one of the five parameters audibly shapes the signal when swept.
