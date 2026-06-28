# Lush Chorus

A lush, bucket-brigade-style stereo chorus. Each channel runs a short
modulated delay line read with linear interpolation, driven by two LFOs in
quadrature so the left and right images sweep 90 degrees apart for width. An
**Intensity** control sweeps the classic voicing — from a subtle shimmer to a
deep, faster ensemble — by scaling LFO rate and modulation depth together. A
dark one-pole low-pass on the wet path mimics the soft, smeared tone of an
analogue delay line. The dry signal is summed in for a thick, animated sound.

Pure algorithm — no samples.

## Parameters

| # | Name      | Range | Default | Description |
|---|-----------|-------|---------|-------------|
| 0 | Rate      | 0..1  | 0.35    | LFO speed (~0.05–6 Hz, biased by Intensity). |
| 1 | Depth     | 0..1  | 0.5     | Modulation sweep amount of the delay time. |
| 2 | Intensity | 0..1  | 0.4     | Voicing: subtle/slow up to wide/deep; scales rate and depth. |
| 3 | Mix       | 0..1  | 0.5     | Dry/wet balance. |
| 4 | Width     | 0..1  | 0.8     | Stereo spread of the two channel LFOs (0 = mono, 1 = full quadrature). |

## Test result

```
output:   rms=0.24339  peak=0.57546  dc=0.00036  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
VERDICT: PASS ✅
```

All five parameters verified as affecting the output; output modulates over
time given a steady input, peak stays well below clipping.
