# Crunch Distortion

A bright transistor-boost distortion with an aggressive, articulate midrange
and **asymmetric op-amp clipping** for even-harmonic grit. An **active Tone**
control tilts the spectrum — cutting lows while boosting highs, and vice-versa —
followed by output Level and a dry/wet Mix. Pure algorithm, no samples.

## Signal chain

1. **Pre-clip high-pass (~110 Hz)** — tightens the low end so the midrange stays
   articulate under heavy gain.
2. **Transistor boost** — a square-tapered input gain (1×…120×) drives the
   clipper hard.
3. **Asymmetric op-amp clipping** — biased `tanh` with a steeper positive lobe,
   giving the orange-box even-harmonic crunch; a post DC-blocker nulls the bias
   offset.
4. **Active Tone tilt** — a 720 Hz low/high split whose two bands are
   cross-faded (lows up + highs down at one extreme, the reverse at the other).
5. **Level + Mix** — output trim and dry/wet blend.

## Parameters

| Index | Name  | Range | Default | Description |
|-------|-------|-------|---------|-------------|
| 0 | Dist  | 0–1 | 0.50 | Input boost / clipping drive (1×…120×, square taper). |
| 1 | Tone  | 0–1 | 0.50 | Active tilt: 0 = dark (lows up), 1 = bright (highs up). |
| 2 | Level | 0–1 | 0.60 | Output level (0…1.2). |
| 3 | Mix   | 0–1 | 1.00 | Dry/wet blend. |

## Test result

```
output:   rms=0.28183  peak=0.39561  dc=-0.00010  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
VERDICT: PASS ✅
```
