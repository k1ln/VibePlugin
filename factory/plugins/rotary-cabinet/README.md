# Rotary Cabinet

A twin-rotor rotating-speaker simulator — the swirling, vibrato-and-tremolo
sound of a valve organ cabinet whose horn and bass rotor spin in front of the
listener.

## What it does

The input is summed to mono and split into two bands by an ~800 Hz
Linkwitz-Riley-style crossover:

- **Horn band** (highs) is spun through a faster virtual rotor.
- **Drum band** (lows / woofer) is spun through a slower, heavier rotor.

Each rotor produces, per band:

- **Amplitude tremolo** — the driver swings toward and away from the mics, so
  its level rises and falls with rotation.
- **Doppler vibrato** — a short modulated delay line shifts the pitch slightly
  as the driver moves toward/away from the mics.

The horn and drum run at slightly different rates and opposite phase. A
**Speed** control morphs from slow (chorale) to fast (tremolo); **Inertia**
sets how long the rotors take to ramp between speeds — they accelerate and
decelerate, they never jump. Two virtual mics, panned apart by **Width**, build
the stereo image, and the horn/drum pan in opposition so the field swirls.

## Parameters

| Index | Name    | Range | Default | Description |
|-------|---------|-------|---------|-------------|
| 0 | Speed   | 0–1 | 0.85 | Morphs slow chorale ↔ fast tremolo (sets the target rotor rates) |
| 1 | Inertia | 0–1 | 0.45 | Spin-up / spin-down ramp time (~0.15 s … ~3 s; drum is heavier) |
| 2 | Depth   | 0–1 | 0.70 | Amount of amplitude tremolo + Doppler vibrato |
| 3 | Mix     | 0–1 | 1.00 | Dry/wet blend |
| 4 | Width   | 0–1 | 0.70 | Stereo spread of the two virtual mics |

## DSP notes

- All state (crossover filters, rotor phases, smoothed rotor rates, delay
  lines) lives in module-level statics; `process()` allocates nothing.
- The rotor rates are one-pole–smoothed toward their Speed target, which is how
  Inertia produces the gradual spin-up/down ramp.
- Output is clamped to ±1.2 as a safety net; in practice it peaks well below
  full scale.

## Test result

`node factory/tools/wasm-runner.mjs … --seconds 3` → **VERDICT: PASS**

```
output:   rms=0.21409  peak=0.71666  dc=0.00021  nan=0
checks:   present=true  finite=true  noClip=true  paramsReactive=true
params:
  [0] Speed     ✓ affects  (rel Δ 1.33647)
  [1] Inertia   ✓ affects  (rel Δ 1.34675)
  [2] Depth     ✓ affects  (rel Δ 1.23386)
  [3] Mix       ✓ affects  (rel Δ 1.23294)
  [4] Width     ✓ affects  (rel Δ 0.55831)
```

A steady 220 Hz tone fed through the effect modulates ~214 % in block RMS over
time, confirming the rotary amplitude/Doppler modulation is active.
