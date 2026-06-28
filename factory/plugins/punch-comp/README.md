# Punch Comp

A punchy VCA-style dynamics compressor. A stereo-linked detector feeds a
dB-domain gain computer with an over-easy soft knee, giving clean, controlled
gain reduction that tightens loud transients while leaving quiet passages
untouched.

## Signal flow

1. **Detector** — a stereo-linked level detector takes the maximum of a fast
   peak follower and a ~5 ms RMS estimate. The peak path catches transients for
   punch; the RMS floor keeps the reduction stable on sustained material.
2. **Gain computer** — the detector level (in dBFS) is compared to the
   Threshold. An over-easy quadratic knee (6 dB wide) smoothly transitions from
   no reduction to the full Ratio slope, so there is no hard corner.
3. **Ballistics** — the target gain reduction is smoothed in the log (dB)
   domain with separate Attack and Release one-pole coefficients, so the VCA
   clamps down at the Attack rate and recovers at the Release rate.
4. **VCA + makeup** — the smoothed reduction is applied as a linear gain and the
   makeup Gain restores output level.

## Parameters

| # | Name      | Range        | Notes                                   |
|---|-----------|--------------|-----------------------------------------|
| 0 | Threshold | -48..0 dBFS  | Level above which compression begins    |
| 1 | Ratio     | 1:1..20:1    | Amount of reduction above threshold     |
| 2 | Attack    | 0.1..80 ms   | How fast gain reduction engages         |
| 3 | Release   | 20..1000 ms  | How fast gain reduction recovers        |
| 4 | Gain      | 0..+24 dB    | Makeup gain                             |

## Notes

- Pure algorithm, no samples. All processing is `f32`, allocation-free in
  `process()`, with module-scope `StaticArray` state and guarded divides.
- Stereo-linked: both channels share one gain-reduction value, so the stereo
  image stays stable under compression.
- Tested with `factory/tools/wasm-runner.mjs`: VERDICT PASS, output peak well
  under full scale, every parameter audibly reactive.

An original design — not a model or emulation of any specific hardware unit.
