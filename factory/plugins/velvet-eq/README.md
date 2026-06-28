# Velvet EQ

A passive **program equalizer** modelled on the behaviour of classic vintage
tube EQs. Built from stable RBJ shelving and bell biquads cascaded into a smooth,
broad, "expensive"-sounding curve.

## What it does

- **Low band** — a gentle low shelf **boost** plus a low shelf **cut** placed a
  little *above* the boost frequency. Dialling both at once reproduces the famous
  program-EQ trick: a fat low-end bump with a resonant dip just above it.
- **High band** — a broad **peak boost** with a selectable centre (presence/air),
  and an independent gentle **high-shelf attenuation** to tame the very top.

All curves are broad and musical. Output is gain-compensated so simultaneous
boosts never run hot.

## Parameters

| Index | Name            | Range | Default | Effect |
|-------|-----------------|-------|---------|--------|
| 0     | Low Freq        | 0..1  | 0.30    | Low-band centre, 20–160 Hz |
| 1     | Low Boost       | 0..1  | 0.00    | Low shelf boost, 0 to +14 dB |
| 2     | Low Atten       | 0..1  | 0.00    | Low shelf cut (just above the boost), 0 to −16 dB |
| 3     | High Boost Freq | 0..1  | 0.40    | High peak centre, 3–16 kHz |
| 4     | High Boost      | 0..1  | 0.00    | High bell boost, 0 to +16 dB |
| 5     | High Atten      | 0..1  | 0.00    | High shelf cut (~12 kHz), 0 to −16 dB |

## Test result

```
output:   rms=0.28850  peak=0.49988  dc=0.00030  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
VERDICT: PASS ✅
```

All six parameters verified as affecting the output.
