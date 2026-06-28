# Ladder Filter

A 4-pole (24 dB/oct) resonant transistor-ladder low-pass filter, built as an
audio effect. The signal runs through four cascaded one-pole TPT low-pass
stages that share a global resonance feedback path. The feedback can be pushed
all the way to self-oscillation; a `tanh` saturation in the loop (and on the
driven input) tames the resonant peak and supplies the warm analog growl the
ladder topology is known for. Sweeping Cutoff clearly moves the spectrum, and
Resonance adds an increasingly sharp peak around the cutoff frequency.

## Parameters

| Index | Name      | Range | Default | Description |
|-------|-----------|-------|---------|-------------|
| 0     | Cutoff    | 0–1   | 0.60    | Filter cutoff, mapped exponentially over ~30 Hz – 18 kHz. |
| 1     | Resonance | 0–1   | 0.30    | Feedback amount; musical, reaching self-oscillation near the top. |
| 2     | Drive     | 0–1   | 0.25    | Input drive into the saturating ladder for extra warmth/grit. |
| 3     | Mix       | 0–1   | 1.00    | Dry/wet blend. |

## DSP notes

- Each stage is a zero-delay-feedback (TPT) one-pole low-pass; four in series
  give the 24 dB/oct slope.
- The resonance feedback subtracts a `tanh`-saturated, resonance-scaled copy of
  the previous 4-pole output, which keeps self-oscillation bounded and stable.
- A drive-dependent level compensation and a small resonance make-up keep the
  output musical without blowing up at extreme settings.

## Test result

```
output:   rms=0.09647  peak=0.44487  dc=0.00016  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
VERDICT: PASS ✅
```

All four parameters are reactive; output stays finite and well below clipping at
maximum resonance and high drive.
