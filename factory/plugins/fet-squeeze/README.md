# FET Squeeze

A fast, FET-style peak compressor for punchy, glued, in-your-face dynamics.

A very fast peak detector feeds a dB-domain gain computer with a selectable
ratio and a soft knee. Release is program-dependent: a fast stage and a slower
trailing stage combine so recovery adapts to the material. The Input knob drives
the signal into a fixed threshold (so it determines how hard the compressor
hits), and Output is makeup gain. Stereo detection is linked off the peak across
both channels. Pure algorithm, no samples.

## Parameters

| # | Name    | Range | Default | Description |
|---|---------|-------|---------|-------------|
| 0 | Input   | 0..1  | 0.5     | Drive into the detector (-6..+30 dB). Higher = hits harder, more gain reduction. |
| 1 | Attack  | 0..1  | 0.7     | Attack speed. Higher = faster (~8 ms down to sub-0.1 ms). |
| 2 | Release | 0..1  | 0.5     | Release speed. Higher = faster (~800 ms down to ~30 ms fast stage). |
| 3 | Ratio   | 0..1  | 0.5     | Compression ratio, ~2:1 to 20:1. |
| 4 | Output  | 0..1  | 0.5     | Makeup gain (-12..+24 dB). Default near unity. |

## Test result

```
output:   rms=0.03181  peak=0.73910  dc=0.00006  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
VERDICT: PASS ✅
```

All five parameters confirmed reactive; output stays well below clipping on the
broadband test bed.
