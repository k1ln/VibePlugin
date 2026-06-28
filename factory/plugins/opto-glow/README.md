# Opto Glow

A gentle optical leveling amplifier — an original model of the classic
photocell leveling compressor. A program-driven light source illuminates a
resistive photocell whose lag produces a slow, program-dependent attack and the
characteristic **two-stage release**: a quick initial recovery summed with a
long, slow tail. A frequency-aware sidechain (gentle low-frequency
de-emphasis) keeps bass from pumping, and a soft knee makes the onset smooth, so
the compressor audibly levels dynamics while staying musical and transparent.

## How it works

- **Sidechain detector** — a peak detector across channels with a ~90 Hz
  high-pass de-emphasis, so low frequencies don't trigger pumping.
- **Soft knee** — a 6 dB quadratic knee around a threshold that drops as Peak
  Reduction rises.
- **Opto cell** — the gain-reduction amount is stored as a photocell that tracks
  the target with a slow attack and recovers with two release time-constants
  (fast ≈80–120 ms, slow tail ≈1.4–2.5 s), blended 65/35. The cell never fully
  closes, preserving the smooth optical character.
- **Emphasis** blends between a gentle Compress voicing (≈3:1, slower) and a
  firmer Limit voicing (≈10:1, quicker attack).

## Parameters

| Index | Name           | Range | Default | Description |
|-------|----------------|-------|---------|-------------|
| 0     | Peak Reduction | 0–1   | 0.50    | Compression amount; lowers the threshold from ~-6 to ~-34 dBFS. |
| 1     | Gain           | 0–1   | 0.35    | Makeup gain, 0 to +24 dB. |
| 2     | Emphasis       | 0–1   | 0.25    | Compress (gentle, slow) ↔ Limit (firm, fast). |
| 3     | Mix            | 0–1   | 1.00    | Dry/wet for parallel compression. |

## Test result

```
module:   opto-glow.wasm   (EFFECT, 4 params)
render:   3s @ 48000Hz, block 256
output:   rms=0.33163  peak=1.19449  dc=0.00063  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
params:
  [0] Peak Reduction   ✓ affects  (rel Δ 0.87136)
  [1] Gain             ✓ affects  (rel Δ 0.93963)
  [2] Emphasis         ✓ affects  (rel Δ 0.32651)
  [3] Mix              ✓ affects  (rel Δ 0.32859)
VERDICT: PASS ✅
```
