# Loudness Meter

A real ITU-R BS.1770-4 / EBU R128 loudness meter for VibePlugin. Audio passes
through unaltered except Input Trim and Channel Mode's Mono-sum option.

Hand-authored `gui.html` rather than generated via `factory/tools/scaffold.mjs`
— this plugin's whole point is numeric LUFS readouts, and the scaffold
generator's built-in `viz` types (`"bars"` / `"wave"` / `"none"`) only draw a
canvas graph, no text readouts. `spec.json` points `guiFile` directly at the
hand-written GUI, the same pattern `granular-cloud`/`vowel-filter` use.

## What's real vs. approximated

- **K-weighting**: exact published 48kHz biquad coefficients (ITU-R
  BS.1770-4/5) — Stage 1 (shelf) `b0=1.53512485958697,
  b1=-2.69169618940638, b2=1.19839281085285, a1=-1.69065929318241,
  a2=0.73248077421585`; Stage 2 (RLB high-pass) `b0=1, b1=-2, b2=1,
  a1=-1.99004745483398, a2=0.99007225036621`. Used as-is at other sample
  rates rather than re-derived via bilinear transform from the analog
  prototype — narrows accuracy off 48kHz, a scoped simplification.
- **Gating**: real 400ms blocks / 100ms hop, Momentary/Short-term computed
  correctly. **Integrated** uses the standard's actual two-gate method
  (absolute gate at -70 LUFS, then a relative gate 10 LU below that mean),
  implemented as a 701-bin histogram (-70.0..0.0 LUFS, 0.1 steps) — the same
  approach the open-source reference `libebur128` (jiixyj/libebur128, MIT)
  uses.
- **True Peak**: an honest approximation — 4x linear interpolation between
  samples, not ITU-R BS.1770's specified polyphase-FIR oversampling filter.
  Can underestimate very sharp inter-sample peaks a proper oversampler would
  catch. Not oversold as a certified true-peak measurement.

## Correctness check (not just "it printed a number")

Fed known-level sine tones through a standalone compiled build and compared
against hand-calculated expected values:

| Test | Measured | Expectation | Match |
|---|---|---|---|
| 1kHz sine, -20dBFS RMS/ch, dual-mono | Integrated -16.98 LUFS, True Peak -16.99dBTP | True Peak should read the sine's actual peak: `20·log10(0.1414)=-16.99dB` | exact |
| 60Hz vs 1kHz, same -20dBFS RMS | -20.58 vs -16.98 LUFS | RLB high-pass should attenuate low frequencies relative to 1kHz | confirmed (3.6dB gap) |
| Dual-mono vs left-channel-only, same per-channel level | -16.98 vs -19.99 LUFS | Identical signal on both channels should read ~3dB *louder* than mono (BS.1770 sums `G_L+G_R=2`, not averages) — a well-known, easy-to-get-backwards property of the standard | confirmed (~3dB gap, single-channel reads at its own per-channel dBFS-equivalent level almost exactly) |

All three independent checks landed where the standard predicts — reasonable
confidence the gating/histogram/stereo-summing logic is correct, not just
"produces a plausible-looking number."

## Build / test

```sh
node compiler/asc-driver.mjs factory/plugins/loudness-meter/assembly.ts /tmp/loudness-meter.wasm
node factory/tools/wasm-runner.mjs /tmp/loudness-meter.wasm --params factory/plugins/loudness-meter/spec.json --seconds 3
node factory/tools/gui-check.mjs factory/plugins/loudness-meter --shot /tmp/loudness-meter.png
node factory/tools/pack-vstai.mjs factory/plugins/loudness-meter/spec.json
node factory/tools/persist-check.mjs factory/plugins/loudness-meter
```

Verdict: **PASS** (4/4 params, no clipping, no NaNs); gui-check PASS (0
console errors); persist-check PASS.
