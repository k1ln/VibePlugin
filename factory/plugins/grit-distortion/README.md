# Grit Distortion

Hard-edged, high-gain diode distortion. A high-gain input stage drives an
asymmetric hard/diode clipper for an aggressive, cutting character. Its
signature **Filter** control is a *reversed* tone low-pass: turning it **up**
makes the sound **darker** (rolls off treble), the opposite of a normal tone
knob. A post Volume and dry/wet Mix finish the chain. Pure DSP algorithm — no
samples.

## Signal chain

1. Pre-clip DC/sub high-pass (~30 Hz) tightens the low end before clipping.
2. High-gain stage (1×–150×) with a small asymmetric bias for even-harmonic grit.
3. Asymmetric hard/diode clipper (hard pin blended with a tanh knee).
4. Gain compensation keeps perceived level steady as Distortion climbs.
5. Reversed-tone 2-pole low-pass "Filter" (bright ≈12 kHz → dark ≈500 Hz).
6. Output Volume, then dry/wet Mix.

## Parameters

| Index | Name       | Range | Default | Description                                              |
|-------|------------|-------|---------|----------------------------------------------------------|
| 0     | Distortion | 0–1   | 0.5     | Input gain into the clipper (1×–150×, exponential feel). |
| 1     | Filter     | 0–1   | 0.4     | Reversed tone — higher = darker (low-pass closes down).  |
| 2     | Volume     | 0–1   | 0.6     | Output level.                                            |
| 3     | Mix        | 0–1   | 1.0     | Dry/wet blend.                                           |

## Test result

```
output:   rms=0.17039  peak=0.28247  dc=-0.02892  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
params:   [0] Distortion ✓  [1] Filter ✓  [2] Volume ✓  [3] Mix ✓
VERDICT: PASS ✅
```
